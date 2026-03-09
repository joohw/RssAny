// 数据库模块：管理 SQLite 连接、schema 初始化与 FeedItem CRUD、日志写入

import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeedItem } from "../types/feedItem.js";
import { normalizeAuthor } from "../types/feedItem.js";
import type { LogEntry } from "../core/logger/types.js";
import { DATA_DIR, TOPICS_CONFIG_PATH, TAGS_CONFIG_PATH } from "../config/paths.js";

let _db: Database.Database | null = null;
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


/** 获取（或初始化）全局数据库单例，数据库位于 .rssany/data/rssany.db */
export async function getDb(): Promise<Database.Database> {
  if (_db) return _db;
  await mkdir(DATA_DIR, { recursive: true });
  _db = new Database(join(DATA_DIR, "rssany.db"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  initSchema(_db);
  migrateSchema(_db);
  return _db;
}


/** 增量迁移：为已存在的旧表补充新列 */
function migrateSchema(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((r) => r.name);
  if (!cols.includes("tags")) {
    db.exec("ALTER TABLE items ADD COLUMN tags TEXT");
  }
  if (cols.includes("tag_suggestions")) {
    try {
      db.exec("ALTER TABLE items DROP COLUMN tag_suggestions");
    } catch {
      // SQLite < 3.35 不支持 DROP COLUMN，忽略
    }
  }
  if (!cols.includes("translations")) {
    db.exec("ALTER TABLE items ADD COLUMN translations TEXT");
  }
  // FTS 升级：增加 zh-CN 译文列，支持中英文全文检索
  const versionRow = db.prepare("SELECT version FROM _schema_version LIMIT 1").get() as { version: number } | undefined;
  const version = versionRow?.version ?? 1;
  if (version < 2) {
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_insert");
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_update");
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_delete");
    db.exec("DROP TABLE IF EXISTS items_fts");
    db.exec(`
      CREATE VIRTUAL TABLE items_fts USING fts5(
        title, summary, content, title_zh, summary_zh, content_zh,
        content='items',
        content_rowid='rowid'
      );
      CREATE TRIGGER items_fts_after_insert AFTER INSERT ON items
      BEGIN
        INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
        VALUES (
          NEW.rowid, NEW.title, NEW.summary, NEW.content,
          json_extract(NEW.translations, '$."zh-CN".title'),
          json_extract(NEW.translations, '$."zh-CN".summary'),
          json_extract(NEW.translations, '$."zh-CN".content')
        );
      END;
      CREATE TRIGGER items_fts_after_update AFTER UPDATE ON items
      BEGIN
        DELETE FROM items_fts WHERE rowid = OLD.rowid;
        INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
        VALUES (
          NEW.rowid, NEW.title, NEW.summary, NEW.content,
          json_extract(NEW.translations, '$."zh-CN".title'),
          json_extract(NEW.translations, '$."zh-CN".summary'),
          json_extract(NEW.translations, '$."zh-CN".content')
        );
      END;
      CREATE TRIGGER items_fts_after_delete AFTER DELETE ON items
      BEGIN
        DELETE FROM items_fts WHERE rowid = OLD.rowid;
      END;
    `);
    db.exec(`
      INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
      SELECT rowid, title, summary, content,
        json_extract(translations, '$."zh-CN".title'),
        json_extract(translations, '$."zh-CN".summary'),
        json_extract(translations, '$."zh-CN".content')
      FROM items
    `);
    db.prepare("INSERT OR REPLACE INTO _schema_version (version) VALUES (2)").run();
  }
  // FTS 升级 v3：用视图作为 content，使 FTS5 能正确读取 title_zh 等列（DELETE/delete 命令会查询 content 表）
  if (version < 3) {
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_insert");
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_update");
    db.exec("DROP TRIGGER IF EXISTS items_fts_after_delete");
    db.exec("DROP TABLE IF EXISTS items_fts");
    db.exec(`
      CREATE VIEW IF NOT EXISTS items_fts_content AS
      SELECT rowid, title, summary, content,
        json_extract(translations, '$."zh-CN".title') AS title_zh,
        json_extract(translations, '$."zh-CN".summary') AS summary_zh,
        json_extract(translations, '$."zh-CN".content') AS content_zh
      FROM items
    `);
    db.exec(`
      CREATE VIRTUAL TABLE items_fts USING fts5(
        title, summary, content, title_zh, summary_zh, content_zh,
        content='items_fts_content',
        content_rowid='rowid'
      );
      CREATE TRIGGER items_fts_after_insert AFTER INSERT ON items
      BEGIN
        INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
        VALUES (
          NEW.rowid, NEW.title, NEW.summary, NEW.content,
          json_extract(NEW.translations, '$."zh-CN".title'),
          json_extract(NEW.translations, '$."zh-CN".summary'),
          json_extract(NEW.translations, '$."zh-CN".content')
        );
      END;
      CREATE TRIGGER items_fts_after_update AFTER UPDATE ON items
      BEGIN
        DELETE FROM items_fts WHERE rowid = OLD.rowid;
        INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
        VALUES (
          NEW.rowid, NEW.title, NEW.summary, NEW.content,
          json_extract(NEW.translations, '$."zh-CN".title'),
          json_extract(NEW.translations, '$."zh-CN".summary'),
          json_extract(NEW.translations, '$."zh-CN".content')
        );
      END;
      CREATE TRIGGER items_fts_after_delete AFTER DELETE ON items
      BEGIN
        DELETE FROM items_fts WHERE rowid = OLD.rowid;
      END;
    `);
    db.exec(`
      INSERT INTO items_fts(rowid, title, summary, content, title_zh, summary_zh, content_zh)
      SELECT rowid, title, summary, content, title_zh, summary_zh, content_zh FROM items_fts_content
    `);
    db.prepare("INSERT OR REPLACE INTO _schema_version (version) VALUES (3)").run();
  }
}


/** 建表：items 主表 + FTS5 全文检索虚拟表（英文原文 + 中文译文 zh-CN） */
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
      tags        TEXT,
      pub_date    TEXT,
      fetched_at  TEXT NOT NULL,
      pushed_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_source    ON items(source_url);
    CREATE INDEX IF NOT EXISTS idx_items_fetched   ON items(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_items_pushed    ON items(pushed_at);
    CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY);
    INSERT OR IGNORE INTO _schema_version VALUES (1);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, summary, content, title_zh, summary_zh, content_zh,
      content='items',
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
      DELETE FROM items_fts WHERE rowid = OLD.rowid;
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
      DELETE FROM items_fts WHERE rowid = OLD.rowid;
    END;
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


/** 批量插入条目（已存在则跳过），返回实际新增数量与新增条目 ID 集合。source_url 取自 item.sourceRef（同批需一致）；若传入了 sourceUrl 则覆盖，用于兼容。 */
export async function upsertItems(items: FeedItem[], sourceUrlOverride?: string): Promise<{ newCount: number; newIds: Set<string> }> {
  if (items.length === 0) return { newCount: 0, newIds: new Set() };
  const sourceUrl = sourceUrlOverride ?? items[0].sourceRef;
  if (!sourceUrl) {
    throw new Error("upsertItems: 需在每条 item 上设置 sourceRef，或传入 sourceUrlOverride");
  }
  const db = await getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO items (id, url, source_url, title, author, summary, tags, pub_date, fetched_at)
    VALUES (@id, @url, @sourceUrl, @title, @author, @summary, @tags, @pubDate, @fetchedAt)
  `);
  const selectExistingStmt = db.prepare(`
    SELECT id, title, author, summary, pub_date, fetched_at
    FROM items
    WHERE id = @id
  `);
  const repairExistingStmt = db.prepare(`
    UPDATE items
    SET title = @title,
        author = @author,
        summary = @summary,
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
      const info = stmt.run({
        id: item.guid,
        url: item.link,
        sourceUrl,
        title: nextTitle,
        author: nextAuthor,
        summary: nextSummary,
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
        pub_date: string | null;
        fetched_at: string | null;
      } | undefined;
      if (!existing) continue;

      const shouldRepairTitle =
        !!nextTitle && !isDateOnlyTitle(nextTitle) &&
        (isDateOnlyTitle(existing.title) || !normalizeText(existing.title));
      const shouldRepairSummary =
        !!nextSummary && normalizeText(existing.summary).length < nextSummary.length;
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

      if (!(shouldRepairTitle || shouldRepairSummary || shouldRepairAuthor || shouldRepairPubDate)) {
        continue;
      }

      repairExistingStmt.run({
        id: item.guid,
        title: shouldRepairTitle ? nextTitle : existing.title,
        author: shouldRepairAuthor ? nextAuthor : (existing.author ?? null),
        summary: shouldRepairSummary ? nextSummary : existing.summary,
        pubDate: shouldRepairPubDate ? nextPubDate : existing.pub_date,
        fetchedAt: now,
      });
    }
  });
  run(items);
  return { newCount, newIds };
}


/** 批量查询哪些 GUID 已存在于数据库，返回已存在 ID 的集合；用于在 pipeline 前过滤重复条目 */
export async function getExistingIds(guids: string[]): Promise<Set<string>> {
  if (guids.length === 0) return new Set();
  const db = await getDb();
  const placeholders = guids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id FROM items WHERE id IN (${placeholders})`).all(...guids) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}


/** 更新单条目的正文内容（仅在 content 为空时写入，防止覆盖已有正文）；translations 有则更新、无则保留 */
export async function updateItemContent(item: FeedItem): Promise<void> {
  const db = await getDb();
  db.prepare(`
    UPDATE items
    SET content      = COALESCE(content, @content),
        author       = COALESCE(@author, author),
        pub_date     = COALESCE(@pubDate, pub_date),
        tags         = @tags,
        translations = COALESCE(@translations, translations)
    WHERE url = @url
  `).run({
    url: item.link,
    content: item.content ?? null,
    author: (() => {
      const arr = normalizeAuthor(item.author);
      return arr?.length ? JSON.stringify(arr) : null;
    })(),
    pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? null),
    tags: item.tags?.length ? JSON.stringify(item.tags) : null,
    translations: item.translations && Object.keys(item.translations).length > 0 ? JSON.stringify(item.translations) : null,
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
}


/** 标记条目已推送给 OpenWebUI（更新 pushed_at 字段） */
export async function markPushed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE items SET pushed_at = @now WHERE id = @id");
  const run = db.transaction((list: string[]) => {
    for (const id of list) stmt.run({ now, id });
  });
  run(ids);
}


/** 按 id（guid）删除单条条目；先删 FTS 索引再删主表（content 为 items_fts_content 视图，含 title_zh 等列） */
export async function deleteItem(id: string): Promise<boolean> {
  if (!id?.trim()) return false;
  const db = await getDb();
  const run = db.transaction(() => {
    const row = db.prepare("SELECT rowid FROM items WHERE id = @id").get({ id: id.trim() }) as { rowid: number } | undefined;
    if (!row) return 0;
    db.prepare("DELETE FROM items_fts WHERE rowid = @rowid").run({ rowid: row.rowid });
    const info = db.prepare("DELETE FROM items WHERE id = @id").run({ id: id.trim() });
    return info.changes;
  });
  return run() > 0;
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


/** 返回每个 source_url 的条目数量，用于信源列表页展示 */
export async function getSourceStats(): Promise<{ source_url: string; count: number }[]> {
  const db = await getDb();
  return db.prepare(
    "SELECT source_url, COUNT(*) as count FROM items GROUP BY source_url ORDER BY count DESC"
  ).all() as { source_url: string; count: number }[];
}


/** 写入一条日志（由 logger 模块调用） */
export async function insertLog(entry: LogEntry): Promise<void> {
  const db = await getDb();
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


/** 查询日志：按级别、时间范围筛选，分页 */
export async function queryLogs(opts: {
  level?: LogEntry["level"];
  category?: LogEntry["category"];
  limit?: number;
  offset?: number;
  since?: Date;
}): Promise<{ items: DbLog[]; total: number }> {
  const db = await getDb();
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


/** 话题配置：title 必选，tags 用于匹配，prompt 供 Agent 参考，refresh 为报告刷新周期（天） */
export interface Topic {
  title: string;
  tags?: string[];
  prompt?: string;
  refresh?: number;
}

/** 读取话题列表（来自 .rssany/topics.json）；无文件或解析失败返回 [] */
export async function getTopics(): Promise<Topic[]> {
  try {
    const raw = await readFile(TOPICS_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { topics?: unknown[] };
    if (!Array.isArray(parsed?.topics)) return [];
    const rawTopics = parsed.topics.filter(
      (t): t is Record<string, unknown> => t != null && typeof t === "object" && typeof (t as { title?: unknown }).title === "string"
    );
    const topics: Topic[] = [];
    for (const t of rawTopics) {
      const title = String((t as { title: string }).title).trim();
      if (!title) continue;
      const tags = Array.isArray((t as { tags?: unknown }).tags)
        ? (t as { tags: unknown[] }).tags.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
        : [title];
      const prompt = typeof (t as { prompt?: unknown }).prompt === "string" ? (t as { prompt: string }).prompt : "";
      const r = (t as { refresh?: unknown }).refresh;
      const refresh = typeof r === "number" && !Number.isNaN(r) && r >= 1 ? Math.floor(r) : 1;
      topics.push({ title, tags, prompt, refresh });
    }
    return topics;
  } catch {
    return [];
  }
}

/** 保存话题列表到 .rssany/topics.json */
export async function saveTopics(topics: Topic[]): Promise<void> {
  const list = topics
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .map((t) => ({
      title: t.title.trim(),
      tags: Array.isArray(t.tags) && t.tags.length > 0
        ? t.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
        : [t.title.trim()],
      prompt: typeof t.prompt === "string" ? t.prompt : "",
      refresh: typeof t.refresh === "number" && t.refresh >= 1 ? Math.floor(t.refresh) : 1,
    }));
  await writeFile(TOPICS_CONFIG_PATH, JSON.stringify({ topics: list }, null, 2), "utf-8");
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

/** 返回每个话题的 refresh 周期（天），key 为 topic.title，默认 1 */
export async function getTagPeriods(): Promise<Record<string, number>> {
  const topics = await getTopics();
  const out: Record<string, number> = {};
  for (const t of topics) {
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

/** 话题统计（含配置字段） */
export interface TopicStat extends Topic {
  count: number;
  hotness: number;
}

/** 热度公式：每条带该 tag 的文章贡献 1/(1 + days_ago/7)，越新贡献越大 */
function recencyFactor(pubDateMs: number | null, fetchedAtMs: number, nowMs: number): number {
  const ref = pubDateMs ?? fetchedAtMs;
  const daysAgo = (nowMs - ref) / (24 * 60 * 60 * 1000);
  return 1 / (1 + Math.max(0, daysAgo) / 7);
}

/** 判断文章 tags 是否与话题的 tags 有交集 */
function itemMatchesTopic(itemTags: string[], topicTags: string[]): boolean {
  const itemLower = new Set(itemTags.map((t) => String(t).trim().toLowerCase()));
  for (const t of topicTags) {
    if (itemLower.has(t.trim().toLowerCase())) return true;
  }
  return false;
}

/** 返回话题列表及其统计（文章数量、热度，基于话题 tags 匹配） */
export async function getTopicStats(): Promise<TopicStat[]> {
  const topics = await getTopics();
  if (topics.length === 0) return [];

  const db = await getDb();
  const rows = db
    .prepare("SELECT tags, pub_date, fetched_at FROM items WHERE tags IS NOT NULL AND tags != ''")
    .all() as { tags: string; pub_date: string | null; fetched_at: string }[];

  const now = Date.now();
  const topicStats = topics.map((t) => {
    const tagsForMatch = Array.isArray(t.tags) && t.tags.length > 0 ? t.tags : [t.title];
    const displayTags = Array.isArray(t.tags) ? t.tags : [];
    let count = 0;
    let hotness = 0;
    for (const row of rows) {
      let itemTags: string[];
      try {
        itemTags = JSON.parse(row.tags) as string[];
      } catch {
        continue;
      }
      if (!itemMatchesTopic(itemTags, tagsForMatch)) continue;
      count += 1;
      const pubMs = row.pub_date ? Date.parse(row.pub_date) : null;
      const fetchedMs = Date.parse(row.fetched_at);
      hotness += recencyFactor(pubMs, fetchedMs, now);
    }
    return {
      ...t,
      tags: displayTags,
      refresh: t.refresh ?? 1,
      count,
      hotness: Math.round(hotness * 100) / 100,
    };
  });

  return topicStats;
}

/** @deprecated 使用 getTopicStats；返回兼容 TagStat 格式（按 topic.title） */
export async function getTagStats(): Promise<TagStat[]> {
  const stats = await getTopicStats();
  return stats.map((s) => ({
    name: s.title,
    count: s.count,
    hotness: s.hotness,
    period: s.refresh ?? 1,
  }));
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
