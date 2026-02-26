// World Labs 博客插件：抓取 Research & Insights 列表页，输出 FeedItem（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const MONTH_NAME =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_RE = new RegExp(`\\b(${MONTH_NAME})\\s+\\d{1,2},\\s+\\d{4}\\b`, "i");
const MONTH_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};


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


function parseDateAndAuthor(metaText) {
  const text = normalizeText(metaText);
  const m = text.match(DATE_RE);
  if (!m) return { pubDate: new Date(), author: undefined };

  const dateText = m[0];
  const parts = dateText.match(/^(?<month>[A-Za-z]+)\s+(?<day>\d{1,2}),\s*(?<year>\d{4})$/);
  let date = new Date();
  if (parts?.groups) {
    const month = MONTH_INDEX[parts.groups.month.toLowerCase()];
    const day = Number(parts.groups.day);
    const year = Number(parts.groups.year);
    if (month != null && Number.isFinite(day) && Number.isFinite(year)) {
      // 统一用 UTC 中午，避免仅有日期时因时区导致前后一天偏移。
      date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
  }
  const authorText = normalizeText(text.slice(m.index + dateText.length)).replace(/^[|/\-•·,:]+/, "").trim();

  return {
    pubDate: Number.isNaN(date.getTime()) ? new Date() : date,
    author: authorText || undefined,
  };
}


function parseCard(anchor, finalUrl) {
  const title = normalizeText(anchor.querySelector("h2, h3")?.textContent);
  if (!title) return null;

  const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
  if (!link) return null;

  const paragraphTexts = anchor
    .querySelectorAll("p")
    .map((p) => normalizeText(p.textContent))
    .filter(Boolean);
  const metaText = paragraphTexts.find((t) => DATE_RE.test(t)) ?? paragraphTexts[0] ?? "";
  const { pubDate, author } = parseDateAndAuthor(metaText);
  const summary = paragraphTexts.find((t) => t !== metaText && !DATE_RE.test(t));

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    author,
    summary: summary || undefined,
  };
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const root = parse(html);

  const seen = new Set();
  const items = [];
  const anchors = root.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const item = parseCard(anchor, finalUrl);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("[worldlabs] 未解析到条目，页面结构可能已变化");
  }
  return items;
}


export default {
  id: "worldlabs",
  listUrlPattern: /^https?:\/\/(www\.)?worldlabs\.ai\/blog(\?.*)?$/i,
  fetchItems,
};
