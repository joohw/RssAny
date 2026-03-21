// 数据库模块：管理 SQLite 连接、schema 初始化与 FeedItem CRUD、日志写入

import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, openSync, closeSync, writeSync, unlinkSync, readFileSync } from "node:fs";

/** 主库是否使用 WAL；设为 "delete" 可改用 DELETE 模式，在 Windows 热重载/多进程场景下更不易损坏 */
const MAIN_DB_JOURNAL = (process.env.RSSANY_DB_JOURNAL ?? "wal").toLowerCase() === "delete" ? "DELETE" : "WAL";
import type { FeedItem } from "../types/feedItem.js";
import { normalizeAuthor } from "../types/feedItem.js";
import type { LogEntry } from "../core/logger/types.js";
import { DATA_DIR, TASKS_CONFIG_PATH, TAGS_CONFIG_PATH } from "../config/paths.js";

let _db: Database.Database | null = null;

/** 初始化串行化：避免多请求/多模块同时调用 getDb() 时重复执行 new Database() + initSchema，导致同一文件被多个连接打开（易引发 SQLITE_CORRUPT_VTAB / database disk image is malformed）。 */
let _dbInit: Promise<Database.Database> | null = null;

/** 写操作串行化：避免 Enrich 并发、多信源同时触发 updateItemContent/upsertItems 等导致的竞态写入（减轻 WAL 竞态或 transient 错误）。 */
let _writeLock: Promise<void> = Promise.resolve();

/** 主库锁文件路径，用于多进程防护；关闭或重置时删除 */
const MAIN_DB_LOCK_PATH = join(DATA_DIR, "rssany.db.lock");

/** 向 stderr 输出损坏诊断，便于排查根因（不依赖已损坏的 db） */
function logCorruptDiagnostic(operation: string, err: unknown): void {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  const lines = [
    "[rssany db] 数据库损坏诊断",
    `  操作: ${operation}`,
    `  错误: ${code ?? "unknown"} - ${msg}`,
    "  常见原因:",
    "    1. 多进程/多连接同时写同一库（如 tsx --watch 热重载时旧进程未完全退出就启动新进程）",
    "    2. 进程被强杀、断电，WAL 未正常 checkpoint",
    "    3. 杀毒/网盘/同步软件锁文件或改写文件",
    "  建议:",
    "    - 开发时尽量不用 --watch，或改代码前先停服务再启动",
    "    - 设置环境变量 RSSANY_DB_JOURNAL=delete 改用 DELETE 模式（更稳、略慢）",
    "    - 删除 .rssany/data/rssany.db 及其 -wal、-shm、rssany.db.lock 后重启",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

/** 尝试获取主库锁文件（独占创建）；若已存在则检查是否为僵死进程，是则删锁并重试。 */
function acquireDbLock(dbDir: string): void {
  const lockPath = join(dbDir, "rssany.db.lock");
  const pid = process.pid;
  const tryCreate = (): void => {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(pid), 0, "utf8");
      closeSync(fd);
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw e;
    }
    if (!existsSync(lockPath)) {
      tryCreate();
      return;
    }
    let oldPid: number | null = null;
    try {
      const buf = readFileSync(lockPath, "utf8");
      const n = parseInt(buf.trim(), 10);
      if (!Number.isNaN(n)) oldPid = n;
    } catch {
      /* 无法读取则视为僵死锁 */
    }
    if (oldPid !== null && oldPid !== pid) {
      const stillRunning = ((): boolean => {
        try {
          process.kill(oldPid!, 0);
          return true;
        } catch {
          return false;
        }
      })();
      if (stillRunning) {
        throw new Error(
          `数据库可能正被其他进程占用（PID ${oldPid}）。若是 tsx --watch 热重载，请先停止再启动，或删除 ${lockPath} 后重试。`
        );
      }
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    tryCreate();
  };
  tryCreate();
}

/** 释放主库锁文件（重置或关闭时调用） */
function releaseDbLock(): void {
  if (!existsSync(MAIN_DB_LOCK_PATH)) return;
  try {
    unlinkSync(MAIN_DB_LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _writeLock;
  let resolveOut!: (v: T) => void;
  let rejectOut!: (e: unknown) => void;
  const out = new Promise<T>((res, rej) => {
    resolveOut = res;
    rejectOut = rej;
  });
  _writeLock = prev
    .then(() => fn())
    .then(
      (v) => { resolveOut(v); },
      (e: unknown) => {
        if (isCorruptError(e)) {
          logCorruptDiagnostic("写操作（如 updateItemContent/upsertItems）", e);
        }
        rejectOut(e);
        throw e;
      },
    );
  return out;
}

const DATE_ONLY_TITLE_RE =
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b[\s\d,，./-]*(?:st|nd|rd|th)?[\s\d,，./-]*$/i;


function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function isDateOnlyTitle(title: string | null | undefined): boolean {
  const normalized = normalizeText(title);
  if (!normalized) return false;
  return DATE_ONLY_TITLE_RE.test(normalized);
}


function toMs(input: string | null | undefined): number | null {
  if (!input) return null;
  const ms = Date.parse(input);
  return Number.isNaN(ms) ? null : ms;
}


/** 从 DB 的 author 列解析为 string[]（支持 JSON 数组与旧版纯字符串） */
export function parseAuthorFromDb(raw: string | null | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const p = JSON.parse(raw) as unknown;
    if (Array.isArray(p)) return p.filter((s) => typeof s === "string").map((s) => String(s).trim()).filter(Boolean);
    return [String(p).trim()];
  } catch {
    return [raw.trim()];
  }
}

/** 将 raw DB row 转为 DbItem（解析 author / tags / translations 等 JSON 列） */
function toDbItem(row: Record<string, unknown>): DbItem {
  const author = parseAuthorFromDb(row.author as string) ?? null;
  const parseJsonArr = (v: unknown): string[] | null => {
    try { return v ? (JSON.parse(v as string) as string[]) : null; } catch { return null; }
  };
  const tags = parseJsonArr(row.tags);
  let translations: Record<string, { title?: string; summary?: string; content?: string }> | null = null;
  try {
    if (row.translations && typeof row.translations === "string") {
      const p = JSON.parse(row.translations) as unknown;
      if (p && typeof p === "object") translations = p as Record<string, { title?: string; summary?: string; content?: string }>;
    }
  } catch {
    /* ignore */
  }
  return { ...row, author, tags, translations } as DbItem;
}

function mapRowsToDbItems(rows: Record<string, unknown>[]): DbItem[] {
  return rows.map(toDbItem);
}


/** 检测是否为「库/FTS 损坏」类错误 */
function isCorruptError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_CORRUPT_VTAB" ||
    msg.includes("database disk image is malformed")
  );
}

/** 获取（或初始化）全局数据库单例，数据库位于 .rssany/data/rssany.db。 */
export async function getDb(): Promise<Database.Database> {
  if (_db) return _db;
  if (_dbInit) return _dbInit;
  const dbPath = join(DATA_DIR, "rssany.db");
  _dbInit = (async (): Promise<Database.Database> => {
    await mkdir(DATA_DIR, { recursive: true });
    acquireDbLock(DATA_DIR);
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath);
      db.pragma(`journal_mode = ${MAIN_DB_JOURNAL}`);
      db.pragma("synchronous = NORMAL");
      initSchema(db);
      _db = db;
      return db;
    } catch (err: unknown) {
      _dbInit = null;
      releaseDbLock();
      if (db) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        db = null;
      }
      if (isCorruptError(err)) {
        logCorruptDiagnostic("打开/初始化主库 (getDb)", err);
      }
      throw err;
    }
  })();
  return _dbInit;
}

/** 运行 PRAGMA integrity_check，返回结果字符串（ok 或错误信息）。用于排查「database disk image is malformed」。若已损坏可能抛错，调用方需 catch。 */
export async function runIntegrityCheck(): Promise<string> {
  const db = await getDb();
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    return row?.integrity_check ?? "unknown";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `integrity_check 执行失败: ${msg}`;
  }
}


/** 日志库路径：独立于主库，主库损坏时仍可写日志 */
const LOGS_DB_PATH = join(DATA_DIR, "logs.db");

let _logsDb: Database.Database | null = null;
let _logsDbInit: Promise<Database.Database> | null = null;

function initLogsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      level       TEXT NOT NULL,
      category    TEXT NOT NULL,
      message     TEXT NOT NULL,
      payload     TEXT,
      source_url  TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level_created ON logs(level, created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_source_created ON logs(source_url, created_at);
  `);
}

/** 获取日志库单例（独立文件 .rssany/data/logs.db），与主库分离，主库损坏不影响日志写入。 */
export async function getLogsDb(): Promise<Database.Database> {
  if (_logsDb) return _logsDb;
  if (_logsDbInit) return _logsDbInit;
  _logsDbInit = (async (): Promise<Database.Database> => {
    await mkdir(DATA_DIR, { recursive: true });
    const db = new Database(LOGS_DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    initLogsSchema(db);
    _logsDb = db;
    return db;
  })();
  return _logsDbInit;
}

/** 建表：items 主表 + FTS5 全文检索（视图 items_fts_src + 中文译文 zh-CN）。可随时删除 .rssany/data/rssany.db 及 -wal、-shm 后重启以完全重置。日志在独立库 logs.db。 */
function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id          TEXT PRIMARY KEY,
      url         TEXT UNIQUE NOT NULL,
      source_url  TEXT NOT NULL,
      title       TEXT,
      author      TEXT,
      summary     TEXT,
      content     TEXT,
      image_url   TEXT,
      tags        TEXT,
      translations TEXT,
      pub_date    TEXT,
      fetched_at  TEXT NOT NULL,
      pushed_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_source    ON items(source_url);
    CREATE INDEX IF NOT EXISTS idx_items_fetched   ON items(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_items_pushed    ON items(pushed_at);
  `);

  db.exec(`
    CREATE VIEW IF NOT EXISTS items_fts_src AS
    SELECT rowid, title, summary, content,
      json_extract(translations, '$."zh-CN".title') AS title_zh,
      json_extract(translations, '$."zh-CN".summary') AS summary_zh,
      json_extract(translations, '$."zh-CN".content') AS content_zh
    FROM items;
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, summary, content, title_zh, summary_zh, content_zh,
      content='items_fts_src',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS items_fts_after_insert AFTER INSERT ON items
    BEGIN
      INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
      VALUES (
        NEW.rowid, NEW.title, NEW.summary, NEW.content,
        json_extract(NEW.translations, '$."zh-CN".title'),
        json_extract(NEW.translations, '$."zh-CN".summary'),
        json_extract(NEW.translations, '$."zh-CN".content')
      );
    END;
    CREATE TRIGGER IF NOT EXISTS items_fts_after_update AFTER UPDATE ON items
    BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, content, title_zh, summary_zh, content_zh)
      VALUES (
        'delete', OLD.rowid, OLD.title, OLD.summary, OLD.content,
        json_extract(OLD.translations, '$."zh-CN".title'),
        json_extract(OLD.translations, '$."zh-CN".summary'),
        json_extract(OLD.translations, '$."zh-CN".content')
      );
      INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
      VALUES (
        NEW.rowid, NEW.title, NEW.summary, NEW.content,
        json_extract(NEW.translations, '$."zh-CN".title'),
        json_extract(NEW.translations, '$."zh-CN".summary'),
        json_extract(NEW.translations, '$."zh-CN".content')
      );
    END;
    CREATE TRIGGER IF NOT EXISTS items_fts_after_delete AFTER DELETE ON items
    BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, content, title_zh, summary_zh, content_zh)
      VALUES (
        'delete', OLD.rowid, OLD.title, OLD.summary, OLD.content,
        json_extract(OLD.translations, '$."zh-CN".title'),
        json_extract(OLD.translations, '$."zh-CN".summary'),
        json_extract(OLD.translations, '$."zh-CN".content')
      );
    END;
  `);

  // 迁移：已有库若缺少 image_url 列则追加（不删库升级）
  try {
    const info = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
    if (info && !info.some((c) => c.name === "image_url")) {
      db.exec("ALTER TABLE items ADD COLUMN image_url TEXT");
    }
  } catch {
    /* ignore */
  }
}


/** 批量插入条目（已存在则跳过），返回实际新增数量与新增条目 ID 集合。source_url 取自 item.sourceRef（同批需一致）；若传入了 sourceUrl 则覆盖，用于兼容。 */
export async function upsertItems(items: FeedItem[], sourceUrlOverride?: string): Promise<{ newCount: number; newIds: Set<string> }> {
  if (items.length === 0) return { newCount: 0, newIds: new Set() };
  const sourceUrl = sourceUrlOverride ?? items[0].sourceRef;
  if (!sourceUrl) {
    throw new Error("upsertItems: 需在每条 item 上设置 sourceRef，或传入 sourceUrlOverride");
  }
  return withWriteLock(async () => {
  const db = await getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO items (id, url, source_url, title, author, summary, image_url, tags, pub_date, fetched_at)
    VALUES (@id, @url, @sourceUrl, @title, @author, @summary, @imageUrl, @tags, @pubDate, @fetchedAt)
  `);
  const selectExistingStmt = db.prepare(`
    SELECT id, title, author, summary, image_url, pub_date, fetched_at
    FROM items
    WHERE id = @id
  `);
  const repairExistingStmt = db.prepare(`
    UPDATE items
    SET title = @title,
        author = @author,
        summary = @summary,
        image_url = @imageUrl,
        pub_date = @pubDate,
        fetched_at = @fetchedAt
    WHERE id = @id
  `);
  const now = new Date().toISOString();
  let newCount = 0;
  const newIds = new Set<string>();
  const run = db.transaction((rows: FeedItem[]) => {
    for (const item of rows) {
      const nextTitle = normalizeText(item.title) || null;
      const nextSummary = normalizeText(item.summary) || null;
      const nextAuthorArr = normalizeAuthor(item.author);
      const nextAuthor = nextAuthorArr?.length ? JSON.stringify(nextAuthorArr) : null;
      const nextPubDate =
        item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? null);
      const nextTags = item.tags?.length ? JSON.stringify(item.tags) : null;
      const nextImageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim() ? item.imageUrl.trim() : null;
      const info = stmt.run({
        id: item.guid,
        url: item.link,
        sourceUrl,
        title: nextTitle,
        author: nextAuthor,
        summary: nextSummary,
        imageUrl: nextImageUrl,
        tags: nextTags,
        pubDate: nextPubDate,
        fetchedAt: now,
      });
      newCount += info.changes;
      if (info.changes > 0) newIds.add(item.guid);

      if (info.changes > 0) continue;
      const existing = selectExistingStmt.get({ id: item.guid }) as {
        title: string | null;
        author: string | null;
        summary: string | null;
        image_url: string | null;
        pub_date: string | null;
        fetched_at: string | null;
      } | undefined;
      if (!existing) continue;

      const shouldRepairTitle =
        !!nextTitle && !isDateOnlyTitle(nextTitle) &&
        (isDateOnlyTitle(existing.title) || !normalizeText(existing.title));
      const shouldRepairSummary =
        !!nextSummary && normalizeText(existing.summary).length < nextSummary.length;
      const shouldRepairImageUrl = !!nextImageUrl && !(existing.image_url?.trim());
      const existingAuthorArr = parseAuthorFromDb(existing.author);
      const shouldRepairAuthor = !!nextAuthorArr?.length && !existingAuthorArr?.length;

      const existingPubDateMs = toMs(existing.pub_date);
      const existingFetchedAtMs = toMs(existing.fetched_at);
      const nextPubDateMs = toMs(nextPubDate);
      const existingPubDateLooksFallback =
        existingPubDateMs != null &&
        existingFetchedAtMs != null &&
        Math.abs(existingPubDateMs - existingFetchedAtMs) <= 5 * 60 * 1000;
      const shouldRepairPubDate =
        nextPubDateMs != null &&
        (
          existingPubDateMs == null ||
          (existingPubDateLooksFallback && nextPubDateMs < existingPubDateMs - 24 * 60 * 60 * 1000)
        );

      if (!(shouldRepairTitle || shouldRepairSummary || shouldRepairImageUrl || shouldRepairAuthor || shouldRepairPubDate)) {
        continue;
      }

      repairExistingStmt.run({
        id: item.guid,
        title: shouldRepairTitle ? nextTitle : existing.title,
        author: shouldRepairAuthor ? nextAuthor : (existing.author ?? null),
        summary: shouldRepairSummary ? nextSummary : existing.summary,
        imageUrl: shouldRepairImageUrl ? nextImageUrl : (existing.image_url ?? null),
        pubDate: shouldRepairPubDate ? nextPubDate : existing.pub_date,
        fetchedAt: now,
      });
    }
  });
  run(items);
  return { newCount, newIds };
  });
}


/** 批量查询哪些 GUID 已存在于数据库，返回已存在 ID 的集合；用于在 pipeline 前过滤重复条目 */
export async function getExistingIds(guids: string[]): Promise<Set<string>> {
  if (guids.length === 0) return new Set();
  const db = await getDb();
  const placeholders = guids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id FROM items WHERE id IN (${placeholders})`).all(...guids) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}


/** 更新单条目的正文内容（按主键 id 更新，避免同一 url 多 id 时更新错行）；content/translations 用 COALESCE 避免覆盖已有。 */
export async function updateItemContent(item: FeedItem): Promise<void> {
  return withWriteLock(async () => {
  const db = await getDb();
  db.prepare(`
    UPDATE items
    SET content      = COALESCE(content, @content),
        image_url   = COALESCE(@imageUrl, image_url),
        author      = COALESCE(@author, author),
        pub_date    = COALESCE(@pubDate, pub_date),
        tags        = @tags,
        translations = COALESCE(@translations, translations)
    WHERE id = @id
  `).run({
    id: item.guid,
    content: item.content ?? null,
    imageUrl: typeof item.imageUrl === "string" && item.imageUrl.trim() ? item.imageUrl.trim() : null,
    author: (() => {
      const arr = normalizeAuthor(item.author);
      return arr?.length ? JSON.stringify(arr) : null;
    })(),
    pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? null),
    tags: item.tags?.length ? JSON.stringify(item.tags) : null,
    translations: item.translations && Object.keys(item.translations).length > 0 ? JSON.stringify(item.translations) : null,
  });
  });
}


/** 跨多信源分页查询条目，按发布时间降序，供首页信息流分页使用；since/until 为日期范围（YYYY-MM-DD 或 ISO 字符串） */
export async function queryFeedItems(
  sourceUrls: string[],
  limit: number,
  offset: number,
  opts?: { since?: string; until?: string },
): Promise<{ items: DbItem[]; hasMore: boolean }> {
  if (sourceUrls.length === 0) return { items: [], hasMore: false };
  const db = await getDb();
  const placeholders = sourceUrls.map((_, i) => `@u${i}`).join(", ");
  const conditions: string[] = [`source_url IN (${placeholders})`];
  const params: Record<string, unknown> = { lim: limit + 1, off: offset };
  sourceUrls.forEach((url, i) => { params[`u${i}`] = url; });
  if (opts?.since) {
    conditions.push("COALESCE(pub_date, fetched_at) >= @since");
    params.since = opts.since.length === 10 ? `${opts.since}T00:00:00.000Z` : opts.since;
  }
  if (opts?.until) {
    conditions.push("COALESCE(pub_date, fetched_at) < @until");
    if (opts.until.length === 10) {
      const d = new Date(opts.until + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      params.until = d.toISOString();
    } else {
      params.until = opts.until;
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT * FROM items
    ${where}
    ORDER BY COALESCE(pub_date, fetched_at) DESC
    LIMIT @lim OFFSET @off
  `).all(params) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const items = mapRowsToDbItems(hasMore ? rows.slice(0, limit) : rows);
  return { items, hasMore };
}


/** 按条目 id（guid）查询单条，供 MCP/API 获取详情 */
export async function getItemById(id: string): Promise<DbItem | null> {
  const db = await getDb();
  const row = db.prepare("SELECT * FROM items WHERE id = @id").get({ id }) as Record<string, unknown> | undefined;
  return row ? toDbItem(row) : null;
}


/** 按单个信源 URL 查询最新条目，按发布时间降序，供 /api/feed 使用；since 限制只返回该时间点之后的条目 */
export async function queryItemsBySource(sourceUrl: string, limit = 50, since?: Date): Promise<DbItem[]> {
  const db = await getDb();
  const sinceClause = since ? "AND COALESCE(pub_date, fetched_at) >= @since" : "";
  const rows = db.prepare(`
    SELECT * FROM items
    WHERE source_url = @sourceUrl ${sinceClause}
    ORDER BY COALESCE(pub_date, fetched_at) DESC
    LIMIT @limit
  `).all({ sourceUrl, limit, since: since?.toISOString() ?? null }) as Record<string, unknown>[];
  return mapRowsToDbItems(rows);
}


/** 查询条目列表，支持按 source_url、sourceUrls、author、tags 过滤、全文搜索与 since 时间过滤，返回分页结果 */
export async function queryItems(opts: {
  sourceUrl?: string;
  sourceUrls?: string[];
  author?: string;
  q?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  since?: Date;
  until?: Date;
}): Promise<{ items: DbItem[]; total: number }> {
  const db = await getDb();
  const { sourceUrl, sourceUrls, author, q, tags: tagsFilter, limit = 20, offset = 0, since, until } = opts;
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (sourceUrl) {
    conditions.push("i.source_url = @sourceUrl");
    params.sourceUrl = sourceUrl;
  } else if (sourceUrls && sourceUrls.length > 0) {
    const placeholders = sourceUrls.map((_, i) => `@src${i}`).join(", ");
    conditions.push(`i.source_url IN (${placeholders})`);
    sourceUrls.forEach((s, i) => ((params as Record<string, unknown>)[`src${i}`] = s));
  }
  if (author && author.trim().length >= 2) {
    conditions.push("instr(i.author, @author) > 0");
    params.author = author.trim();
  }
  if (q) {
    conditions.push("i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH @q)");
    params.q = q;
  }
  if (tagsFilter && tagsFilter.length > 0) {
    const trimmed = tagsFilter.filter((t) => typeof t === "string" && t.trim()).map((t) => (t as string).trim());
    if (trimmed.length > 0) {
      const tagConds = trimmed
        .map((_, i) => `LOWER(TRIM(json_each.value)) = LOWER(@tag${i})`)
        .join(" OR ");
      conditions.push(
        `i.tags IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(i.tags) WHERE ${tagConds})`
      );
      trimmed.forEach((t, i) => {
        (params as Record<string, unknown>)[`tag${i}`] = t;
      });
    }
  }
  if (since) {
    conditions.push("COALESCE(i.pub_date, i.fetched_at) >= @since");
    params.since = since.toISOString();
  }
  if (until) {
    conditions.push("COALESCE(i.pub_date, i.fetched_at) < @until");
    params.until = until.toISOString();
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT i.id, i.url, i.source_url, i.title, i.author, i.summary, i.content, i.tags, i.translations, i.pub_date, i.fetched_at, i.pushed_at
    FROM items i ${where}
    ORDER BY COALESCE(i.pub_date, i.fetched_at) DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as Record<string, unknown>[];
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM items i ${where}`).get(params) as { count: number };
  return { items: mapRowsToDbItems(rows), total: count };
}


/** 从所有条目的 tags 中移除指定标签（不区分大小写），返回更新的条目数 */
export async function removeTagFromAllItems(tag: string): Promise<number> {
  const trimmed = String(tag ?? "").trim();
  if (!trimmed) return 0;
  const targetLower = trimmed.toLowerCase();

  return withWriteLock(async () => {
  const db = await getDb();
  const rows = db
    .prepare("SELECT id, tags FROM items WHERE tags IS NOT NULL AND tags != ''")
    .all() as { id: string; tags: string }[];

  const updateStmt = db.prepare("UPDATE items SET tags = @tags WHERE id = @id");
  let count = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      let itemTags: string[];
      try {
        itemTags = JSON.parse(row.tags) as string[];
      } catch {
        continue;
      }
      const filtered = itemTags.filter((t) => String(t).trim().toLowerCase() !== targetLower);
      if (filtered.length === itemTags.length) continue;
      const nextTags = filtered.length > 0 ? JSON.stringify(filtered) : null;
      updateStmt.run({ id: row.id, tags: nextTags });
      count += 1;
    }
  });
  run();
  return count;
  });
}


/** 标记条目已推送给 OpenWebUI（更新 pushed_at 字段） */
export async function markPushed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  return withWriteLock(async () => {
  const db = await getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE items SET pushed_at = @now WHERE id = @id");
  const run = db.transaction((list: string[]) => {
    for (const id of list) stmt.run({ now, id });
  });
  run(ids);
  });
}


/** 按 id（guid）删除单条条目；先删 FTS 索引再删主表（FTS 使用 items_fts_src 视图，含 title_zh 等列） */
export async function deleteItem(id: string): Promise<boolean> {
  if (!id?.trim()) return false;
  return withWriteLock(async () => {
  const db = await getDb();
  const run = db.transaction(() => {
    const row = db.prepare("SELECT rowid FROM items WHERE id = @id").get({ id: id.trim() }) as { rowid: number } | undefined;
    if (!row) return 0;
    db.prepare("DELETE FROM items_fts WHERE rowid = @rowid").run({ rowid: row.rowid });
    const info = db.prepare("DELETE FROM items WHERE id = @id").run({ id: id.trim() });
    return info.changes;
  });
  return run() > 0;
  });
}

/** 按 source_url 删除该信源下所有条目（FTS 由触发器自动清理），返回删除条数 */
export async function deleteItemsBySourceUrl(sourceUrl: string): Promise<number> {
  if (!sourceUrl?.trim()) return 0;
  return withWriteLock(async () => {
    const db = await getDb();
    const info = db.prepare("DELETE FROM items WHERE source_url = @sourceUrl").run({ sourceUrl: sourceUrl.trim() });
    return info.changes;
  });
}


/** 查询待推送条目（pushed_at 为空且 content 不为空） */
export async function getPendingPushItems(limit = 100): Promise<DbItem[]> {
  const db = await getDb();
  const rows = db.prepare(`
    SELECT * FROM items
    WHERE pushed_at IS NULL AND content IS NOT NULL
    ORDER BY fetched_at ASC
    LIMIT @limit
  `).all({ limit }) as Record<string, unknown>[];
  return mapRowsToDbItems(rows);
}


/** 查询指定日期（YYYY-MM-DD，本地时区）当日入库的所有条目，按 fetched_at 降序，最多 300 条 */
export async function getItemsForDate(date: string): Promise<DbItem[]> {
  const db = await getDb();
  const start = new Date(`${date}T00:00:00`).toISOString();
  const end = new Date(`${date}T23:59:59.999`).toISOString();
  const rows = db.prepare(`
    SELECT * FROM items
    WHERE fetched_at >= @start AND fetched_at <= @end
    ORDER BY fetched_at DESC
    LIMIT 300
  `).all({ start, end }) as Record<string, unknown>[];
  return mapRowsToDbItems(rows);
}


/** 返回每个 source_url 的条目数量与最近更新日期，用于信源列表页展示 */
export async function getSourceStats(): Promise<{ source_url: string; count: number; latest_at: string | null }[]> {
  const db = await getDb();
  return db.prepare(
    "SELECT source_url, COUNT(*) as count, MAX(COALESCE(pub_date, fetched_at)) as latest_at FROM items GROUP BY source_url ORDER BY count DESC"
  ).all() as { source_url: string; count: number; latest_at: string | null }[];
}


/** 写入一条日志（由 logger 模块调用）；使用独立库 logs.db，主库损坏时仍可写入。 */
export async function insertLog(entry: LogEntry): Promise<void> {
  const db = await getLogsDb();
  db.prepare(`
    INSERT INTO logs (level, category, message, payload, source_url, created_at)
    VALUES (@level, @category, @message, @payload, NULL, @created_at)
  `).run({
    level: entry.level,
    category: entry.category,
    message: entry.message,
    payload: entry.payload != null ? JSON.stringify(entry.payload) : null,
    created_at: entry.created_at,
  });
}


/** 查询日志：按级别、时间范围筛选，分页（读自独立库 logs.db） */
export async function queryLogs(opts: {
  level?: LogEntry["level"];
  category?: LogEntry["category"];
  limit?: number;
  offset?: number;
  since?: Date;
}): Promise<{ items: DbLog[]; total: number }> {
  const db = await getLogsDb();
  const { level, category, limit = 50, offset = 0, since } = opts;
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (level) {
    conditions.push("level = @level");
    params.level = level;
  }
  if (category) {
    conditions.push("category = @category");
    params.category = category;
  }
  if (since) {
    conditions.push("created_at >= @since");
    params.since = since.toISOString();
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT id, level, category, message, payload, created_at
    FROM logs ${where}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as DbLog[];
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM logs ${where}`).get(params) as { count: number };
  return { items: rows, total: count };
}


/** 定时 Agent 任务：title 必填；prompt 供 Agent；description 仅展示；refresh 为周期（天） */
export interface AgentTask {
  title: string;
  prompt?: string;
  description?: string;
  refresh?: number;
}

/** 读取任务列表（.rssany/tasks.json） */
export async function getAgentTasks(): Promise<AgentTask[]> {
  try {
    const raw = await readFile(TASKS_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { tasks?: unknown[] };
    if (!Array.isArray(parsed?.tasks)) return [];
    const rawTasks = parsed.tasks.filter(
      (t): t is Record<string, unknown> => t != null && typeof t === "object" && typeof (t as { title?: unknown }).title === "string"
    );
    const tasks: AgentTask[] = [];
    for (const t of rawTasks) {
      const title = String((t as { title: string }).title).trim();
      if (!title) continue;
      const prompt = typeof (t as { prompt?: unknown }).prompt === "string" ? (t as { prompt: string }).prompt : "";
      const description = typeof (t as { description?: unknown }).description === "string" ? (t as { description: string }).description : "";
      const r = (t as { refresh?: unknown }).refresh;
      const refresh = typeof r === "number" && !Number.isNaN(r) && r >= 1 ? Math.floor(r) : 1;
      tasks.push({ title, prompt, description, refresh });
    }
    return tasks;
  } catch {
    return [];
  }
}

/** 保存任务列表到 .rssany/tasks.json */
export async function saveAgentTasks(tasks: AgentTask[]): Promise<void> {
  const list = tasks
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .map((t) => ({
      title: t.title.trim(),
      prompt: typeof t.prompt === "string" ? t.prompt : "",
      description: typeof t.description === "string" ? t.description : "",
      refresh: typeof t.refresh === "number" && t.refresh >= 1 ? Math.floor(t.refresh) : 1,
    }));
  await writeFile(TASKS_CONFIG_PATH, JSON.stringify({ tasks: list }, null, 2), "utf-8");
}

/** 返回用户管理的系统标签（来自 .rssany/tags.json），供 pipeline tagger 参考 */
export async function getSystemTags(): Promise<string[]> {
  try {
    const raw = await readFile(TAGS_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { tags?: unknown[] };
    if (!Array.isArray(parsed?.tags)) return [];
    return parsed.tags
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
  } catch {
    return [];
  }
}

/** 保存系统标签到 .rssany/tags.json */
export async function saveSystemTagsToFile(tags: string[]): Promise<void> {
  const list = tags
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.trim());
  await writeFile(TAGS_CONFIG_PATH, JSON.stringify({ tags: list }, null, 2), "utf-8");
}

/** 返回系统标签及其统计（文章数量、热度），基于 tags.json + DB */
export async function getSystemTagStats(): Promise<TagStat[]> {
  const systemTags = await getSystemTags();
  if (systemTags.length === 0) return [];

  const db = await getDb();
  const rows = db
    .prepare("SELECT tags, pub_date, fetched_at FROM items WHERE tags IS NOT NULL AND tags != ''")
    .all() as { tags: string; pub_date: string | null; fetched_at: string }[];

  const now = Date.now();
  const tagMap = new Map<string, { count: number; hotness: number }>();
  for (const name of systemTags) {
    tagMap.set(name.toLowerCase(), { count: 0, hotness: 0 });
  }

  for (const row of rows) {
    let itemTags: string[];
    try {
      itemTags = JSON.parse(row.tags) as string[];
    } catch {
      continue;
    }
    const pubMs = row.pub_date ? Date.parse(row.pub_date) : null;
    const fetchedMs = Date.parse(row.fetched_at);
    const factor = recencyFactor(pubMs, fetchedMs, now);

    for (const t of itemTags) {
      const key = String(t).trim().toLowerCase();
      const entry = tagMap.get(key);
      if (entry) {
        entry.count += 1;
        entry.hotness += factor;
      }
    }
  }

  return systemTags.map((name) => {
    const entry = tagMap.get(name.toLowerCase()) ?? { count: 0, hotness: 0 };
    return {
      name,
      count: entry.count,
      hotness: Math.round(entry.hotness * 100) / 100,
    };
  });
}

/** 返回每个任务的 refresh 周期（天），key 为 task.title，默认 1 */
export async function getTagPeriods(): Promise<Record<string, number>> {
  const tasks = await getAgentTasks();
  const out: Record<string, number> = {};
  for (const t of tasks) {
    out[t.title] = Math.max(1, Math.floor(Number(t.refresh)) || 1);
  }
  return out;
}


/** 每个系统标签的统计：文章数量 + 热度 + track 周期（天） */
export interface TagStat {
  name: string;
  count: number;
  hotness: number;
  period?: number;
}

/** 热度公式：每条带该 tag 的文章贡献 1/(1 + days_ago/7)，越新贡献越大 */
function recencyFactor(pubDateMs: number | null, fetchedAtMs: number, nowMs: number): number {
  const ref = pubDateMs ?? fetchedAtMs;
  const daysAgo = (nowMs - ref) / (24 * 60 * 60 * 1000);
  return 1 / (1 + Math.max(0, daysAgo) / 7);
}

/** 建议聚类标签：文章中出现但不在系统标签库中的话题，按热度排序，取前 5 个且热度 > 20 */
export async function getSuggestedTags(): Promise<TagStat[]> {
  const systemTags = await getSystemTags();
  const systemLower = new Set(systemTags.map((t) => t.toLowerCase().trim()));

  const db = await getDb();
  const rows = db
    .prepare("SELECT tags, pub_date, fetched_at FROM items WHERE tags IS NOT NULL AND tags != ''")
    .all() as { tags: string; pub_date: string | null; fetched_at: string }[];

  const tagMap = new Map<string, { name: string; count: number; hotness: number }>();
  const now = Date.now();

  for (const row of rows) {
    let tags: string[];
    try {
      tags = JSON.parse(row.tags) as string[];
    } catch {
      continue;
    }
    const pubMs = row.pub_date ? Date.parse(row.pub_date) : null;
    const fetchedMs = Date.parse(row.fetched_at);
    const factor = recencyFactor(pubMs, fetchedMs, now);

    for (const t of tags) {
      const trimmed = String(t).trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (systemLower.has(key)) continue;

      const existing = tagMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.hotness += factor;
      } else {
        tagMap.set(key, { name: trimmed, count: 1, hotness: factor });
      }
    }
  }

  return Array.from(tagMap.values())
    .filter((s) => s.hotness > 20)
    .sort((a, b) => b.hotness - a.hotness)
    .slice(0, 5)
    .map((s) => ({ name: s.name, count: s.count, hotness: Math.round(s.hotness * 100) / 100 }));
}

/** 数据库行结构（snake_case，与 FeedItem 区分）；author / tags 等已解析为数组 */
export interface DbItem {
  id: string;
  url: string;
  source_url: string;
  title: string | null;
  author: string[] | null;
  summary: string | null;
  content: string | null;
  image_url: string | null;
  tags: string[] | null;
  translations: Record<string, { title?: string; summary?: string; content?: string }> | null;
  pub_date: string | null;
  fetched_at: string;
  pushed_at: string | null;
}

/** 日志表行结构 */
export interface DbLog {
  id: number;
  level: string;
  category: string;
  message: string;
  payload: string | null;
  created_at: string;
}
