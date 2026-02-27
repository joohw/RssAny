// VentureBeat 插件：通过官方 RSS Feed 拉取列表，规避首页安全检查页

import Parser from "rss-parser";
import { createHash } from "node:crypto";


const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
    "Accept": "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
  },
});


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function stripHtml(text) {
  return normalizeText((text ?? "").replace(/<[^>]*>/g, " "));
}


function toValidDate(raw) {
  if (!raw) return new Date();
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}


function toFeedUrl(sourceId) {
  const url = new URL(sourceId);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/feed")) return url.href;
  url.pathname = path ? `${path}/feed/` : "/feed/";
  url.search = "";
  url.hash = "";
  return url.href;
}


function mapFeedItem(item) {
  const link = normalizeText(item.link ?? "");
  if (!/^https?:\/\//i.test(link)) return null;

  const title = normalizeText(item.title ?? "");
  const pubDate = toValidDate(item.isoDate ?? item.pubDate);
  const summary = normalizeText(item.contentSnippet ?? "") || stripHtml(item.summary ?? item.content ?? "");
  const author = normalizeText(item.creator ?? item.author ?? "") || undefined;
  const categories = Array.isArray(item.categories)
    ? item.categories.map((c) => normalizeText(String(c))).filter(Boolean)
    : undefined;

  return {
    guid: createHash("sha256").update(link).digest("hex"),
    title: title || "(无标题)",
    link,
    pubDate,
    author,
    summary: summary || undefined,
    categories: categories?.length ? categories : undefined,
  };
}


async function fetchItems(sourceId, _ctx) {
  const feedUrl = toFeedUrl(sourceId);
  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[venturebeat] 抓取 feed 失败: ${feedUrl} (${msg})`);
  }

  const seen = new Set();
  const items = [];
  for (const item of feed.items ?? []) {
    const mapped = mapFeedItem(item);
    if (!mapped) continue;
    if (seen.has(mapped.link)) continue;
    seen.add(mapped.link);
    items.push(mapped);
  }

  if (items.length === 0) {
    throw new Error(`[venturebeat] 未解析到条目: ${feedUrl}`);
  }

  return items;
}


export default {
  id: "venturebeat",
  listUrlPattern: /^https?:\/\/(www\.)?venturebeat\.com\/?(\?.*)?$/i,
  refreshInterval: "1h",
  fetchItems,
};
