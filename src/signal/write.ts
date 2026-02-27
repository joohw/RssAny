// 将单条 FeedItem 写入 Signal 仓库为 Markdown 文件（不执行 git 操作）

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FeedItem } from "../types/feedItem.js";
import { loadSignalConfig } from "./config.js";
import { logger } from "../logger/index.js";


/** 由 link 生成稳定、仅作唯一标识的文件名（无元信息），16 位 hex */
export function itemToStableId(item: FeedItem): string {
  return createHash("sha256").update(item.link, "utf8").digest("hex").slice(0, 16);
}


/** 将 contentHtml 中常见块级标签转为换行，便于在 Markdown 中可读；不做完整 HTML→MD 转换 */
function htmlToMarkdownBody(html: string): string {
  if (!html || !html.trim()) return "";
  return html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/** 从已有 .md 文件中解析出的 frontmatter 的 sources 列表（简单实现，不依赖 YAML 库） */
async function readExistingSources(absPath: string): Promise<string[]> {
  try {
    const raw = await readFile(absPath, "utf-8");
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return [];
    const fm = fmMatch[1];
    const sourcesMatch = fm.match(/sources:\s*\[([\s\S]*?)\]/);
    if (!sourcesMatch) {
      const single = fm.match(/source_url:\s*["']?([^"'\n]+)["']?/);
      return single ? [single[1].trim()] : [];
    }
    const inner = sourcesMatch[1];
    const urls = inner.split(",").map((s) => s.replace(/["'\s]/g, "").trim()).filter(Boolean);
    return urls;
  } catch {
    return [];
  }
}


/** 根据 FeedItem 与 sourceUrl 生成符合约定的 Markdown 字符串 */
export function buildSignalMarkdown(item: FeedItem, sourceUrl: string, existingSources: string[] = []): string {
  const sources = Array.from(new Set([...existingSources, sourceUrl]));
  const pubDate = item.pubDate instanceof Date ? item.pubDate.toISOString() : (item.pubDate ?? "");
  const front: Record<string, unknown> = {
    id: item.guid,
    url: item.link,
    source_url: sourceUrl,
    sources,
    title: item.title ?? "",
    author: item.author ?? null,
    pub_date: pubDate,
    fetched_at: new Date().toISOString(),
  };
  const lines = ["---"];
  for (const [k, v] of Object.entries(front)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const u of v) lines.push(`  - "${String(u).replace(/"/g, '\\"')}"`);
    } else {
      const s = String(v);
      const needQuote = s.includes(":") || s.includes("\n") || s.includes('"');
      lines.push(`${k}: ${needQuote ? `"${s.replace(/"/g, '\\"')}"` : s}`);
    }
  }
  lines.push("---", "", `# ${(item.title ?? "").replace(/\n/g, " ")}`, "");
  if (item.summary?.trim()) {
    lines.push(item.summary.trim(), "");
  }
  if (item.contentHtml?.trim()) {
    lines.push(htmlToMarkdownBody(item.contentHtml));
  }
  return lines.join("\n");
}


/** 从条目取日期字符串 YYYY-MM-DD，用于按日分目录；无 pubDate 时用当天 */
function getDateSegment(item: FeedItem): string {
  const d = item.pubDate instanceof Date ? item.pubDate : item.pubDate ? new Date(item.pubDate) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


/** 将一条条目投递到 Signal 仓库（写入 items/YYYY-MM-DD/<id>.md）；若已启用则合并 sources */
export async function writeItem(item: FeedItem, sourceUrl: string): Promise<void> {
  const config = await loadSignalConfig();
  if (!config.enabled || !config.repoPath) return;
  const dateSegment = getDateSegment(item);
  const dir = join(config.repoPath, "items", dateSegment);
  await mkdir(dir, { recursive: true });
  const id = itemToStableId(item);
  const absPath = join(dir, `${id}.md`);
  let existingSources: string[] = [];
  try {
    existingSources = await readExistingSources(absPath);
  } catch {
    // 文件不存在或读取失败，当作新文件
  }
  const md = buildSignalMarkdown(item, sourceUrl, existingSources);
  await writeFile(absPath, md, "utf-8");
}


/** 批量投递；失败仅打日志，不抛错 */
export async function writeItems(items: FeedItem[], sourceUrl: string): Promise<void> {
  const config = await loadSignalConfig();
  if (!config.enabled || !config.repoPath) return;
  for (const item of items) {
    try {
      await writeItem(item, sourceUrl);
    } catch (err) {
      logger.warn("signal", "投递单条失败", {
        url: item.link,
        source_url: sourceUrl,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
