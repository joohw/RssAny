// 数据库模块：管理 SQLite 连接、schema 初始化与 FeedItem CRUD 操作

import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FeedItem } from "../types/feedItem.js";
import { DATA_DIR } from "../config/paths.js";
import { emitFeedUpdated } from "../events/index.js";


let _db: Database.Database | null = null;


/** 获取（或初始化）全局数据库单例，数据库位于 .rssany/data/rssany.db */
export async function getDb(): Promise<Database.Database> {
  if (_db) return _db;
  await mkdir(DATA_DIR, { recursive: true });
  _db = new Database(join(DATA_DIR, "rssany.db"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  initSchema(_db);
  return _db;
}


/** 建表：items 主表 + FTS5 全文检索虚拟表 */
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
      pub_date    TEXT,
      fetched_at  TEXT NOT NULL,
      pushed_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_items_source    ON items(source_url);
    CREATE INDEX IF NOT EXISTS idx_items_fetched   ON items(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_items_pushed    ON items(pushed_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, summary, content,
      content='items',
      content_rowid='rowid'
    );
  `);
}


/** 批量插入条目（已存在则跳过），返回实际新增数量，有新条目时广播 feed:updated 事件 */
export async function upsertItems(items: FeedItem[], sourceUrl: string): Promise<number> {
  const db = await getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO items (id, url, source_url, title, author, summary, pub_date, fetched_at)
    VALUES (@id, @url, @sourceUrl, @title, @author, @summary, @pubDate, @fetchedAt)
  `);
  const now = new Date().toISOString();
  let newCount = 0;
  const run = db.transaction((rows: FeedItem[]) => {
    for (const item of rows) {
      const info = stmt.run({
        id: item.guid,
        url: item.link,
        sourceUrl,
        title: item.title ?? null,
        author: item.author ?? null,
        summary: item.summary ?? null,
        pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? null),
        fetchedAt: now,
      });
      newCount += info.changes;
    }
  });
  run(items);
  if (newCount > 0) emitFeedUpdated({ sourceUrl, newCount });
  return newCount;
}


/** 更新单条目的正文内容（仅在 content 为空时写入，防止覆盖已有正文） */
export async function updateItemContent(item: FeedItem): Promise<void> {
  const db = await getDb();
  db.prepare(`
    UPDATE items
    SET content  = @content,
        author   = COALESCE(@author, author),
        pub_date = COALESCE(@pubDate, pub_date)
    WHERE url = @url AND content IS NULL
  `).run({
    url: item.link,
    content: item.contentHtml ?? null,
    author: item.author ?? null,
    pubDate: item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? null),
  });
}


/** 按单个信源 URL 查询最新条目，按发布时间降序，供 /api/feed 使用；since 限制只返回该时间点之后的条目 */
export async function queryItemsBySource(sourceUrl: string, limit = 50, since?: Date): Promise<DbItem[]> {
  const db = await getDb();
  const sinceClause = since ? "AND COALESCE(pub_date, fetched_at) >= @since" : "";
  return db.prepare(`
    SELECT * FROM items
    WHERE source_url = @sourceUrl ${sinceClause}
    ORDER BY COALESCE(pub_date, fetched_at) DESC
    LIMIT @limit
  `).all({ sourceUrl, limit, since: since?.toISOString() ?? null }) as DbItem[];
}


/** 查询条目列表，支持按 source_url 过滤、全文搜索与 since 时间过滤，返回分页结果 */
export async function queryItems(opts: {
  sourceUrl?: string;
  q?: string;
  limit?: number;
  offset?: number;
  since?: Date;
}): Promise<{ items: DbItem[]; total: number }> {
  const db = await getDb();
  const { sourceUrl, q, limit = 20, offset = 0, since } = opts;
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (sourceUrl) {
    conditions.push("i.source_url = @sourceUrl");
    params.sourceUrl = sourceUrl;
  }
  if (q) {
    conditions.push("i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH @q)");
    params.q = q;
  }
  if (since) {
    conditions.push("COALESCE(i.pub_date, i.fetched_at) >= @since");
    params.since = since.toISOString();
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT i.id, i.url, i.source_url, i.title, i.author, i.summary, i.content, i.pub_date, i.fetched_at, i.pushed_at
    FROM items i ${where}
    ORDER BY i.fetched_at DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as DbItem[];
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM items i ${where}`).get(params) as { count: number };
  return { items: rows, total: count };
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


/** 查询待推送条目（pushed_at 为空且 content 不为空） */
export async function getPendingPushItems(limit = 100): Promise<DbItem[]> {
  const db = await getDb();
  return db.prepare(`
    SELECT * FROM items
    WHERE pushed_at IS NULL AND content IS NOT NULL
    ORDER BY fetched_at ASC
    LIMIT @limit
  `).all({ limit }) as DbItem[];
}


/** 数据库行结构（snake_case，与 FeedItem 区分） */
export interface DbItem {
  id: string;
  url: string;
  source_url: string;
  title: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  pub_date: string | null;
  fetched_at: string;
  pushed_at: string | null;
}
