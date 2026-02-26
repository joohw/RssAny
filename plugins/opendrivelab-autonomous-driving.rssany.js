// OpenDriveLab Autonomous Driving 插件：抓取时间线条目并输出 FeedItem（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toAbsoluteHttpUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parsePubDate(dateText) {
  const normalized = normalizeText(dateText);
  const m = normalized.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!m) return new Date();
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date();
  }
  // 统一使用 UTC 中午，避免仅日期时的时区偏移问题。
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

const AUX_LINK_TEXTS = new Set([
  "paper",
  "page",
  "github",
  "dataset",
  "hugging face",
  "video",
  "blog",
  "poster",
  "slides",
  "arxiv",
  "code",
  "demo",
  "解讀",
]);

function findTitleAnchor(li, finalUrl) {
  const anchors = li.querySelectorAll("a[href]");
  let fallback = null;

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
    if (!title || !link) continue;

    if (!fallback) fallback = { title, link };
    if (AUX_LINK_TEXTS.has(title.toLowerCase())) continue;
    if (title.length < 8) continue;
    return { title, link };
  }

  return fallback;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const root = parse(html);

  const seenLinks = new Set();
  const items = [];
  const rows = root.querySelectorAll("li");
  for (const row of rows) {
    const dateText = normalizeText(row.querySelector("time")?.textContent);
    if (!dateText) continue;

    const titleAnchor = findTitleAnchor(row, finalUrl);
    if (!titleAnchor) continue;
    if (seenLinks.has(titleAnchor.link)) continue;
    seenLinks.add(titleAnchor.link);

    const summaryText = normalizeText(row.querySelector("i")?.textContent);
    items.push({
      guid: hashGuid(titleAnchor.link),
      title: titleAnchor.title,
      link: titleAnchor.link,
      pubDate: parsePubDate(dateText),
      author: "OpenDriveLab",
      summary: summaryText || undefined,
      sourceId: "opendrivelab-autonomous-driving",
    });
  }

  if (items.length === 0) {
    throw new Error("[opendrivelab-autonomous-driving] 未解析到条目，页面结构可能已变化");
  }
  return items;
}

export default {
  id: "opendrivelab-autonomous-driving",
  listUrlPattern: /^https?:\/\/(www\.)?opendrivelab\.com\/AutonomousDriving\/?(\?.*)?$/i,
  fetchItems,
};
