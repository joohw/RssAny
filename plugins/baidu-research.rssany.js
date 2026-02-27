// Baidu Research 插件：抓取 Blog 列表条目（不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const BLOG_ITEM_PATH_RE = /^\/Blog\/index-view(?:\/)?$/i;
const MONTH_TO_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const TEXT_NODE_SELECTORS = "div, p, span, h1, h2, h3, h4, h5, h6, strong, em";
const MONTH_DAY_TEXT_RE = /^([A-Za-z]{3,9})\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*[，,]\s*\d{0,4})?$/i;


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


function inferYearFromTexts(texts) {
  for (const text of texts) {
    const m = normalizeText(text).match(/\b(19|20)\d{2}\b/);
    if (!m) continue;
    const year = Number(m[0]);
    if (year >= 1990 && year <= new Date().getUTCFullYear() + 1) {
      return year;
    }
  }
  return undefined;
}


function parsePubDate(rawText, fallbackTexts) {
  const text = normalizeText(rawText).replace("，", ",");
  if (!text) return undefined;

  const monthMatch = text.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*)?(?:(\d{4}))?$/
  );
  if (monthMatch) {
    const month = MONTH_TO_INDEX[monthMatch[1].slice(0, 3).toLowerCase()];
    if (month != null) {
      const day = Number(monthMatch[2]);
      const year = monthMatch[3] ? Number(monthMatch[3]) : inferYearFromTexts(fallbackTexts);
      if (!year) return undefined;
      const parsed = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  const numericMatch = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (numericMatch) {
    const year = Number(numericMatch[1]);
    const month = Number(numericMatch[2]) - 1;
    const day = Number(numericMatch[3]);
    const parsed = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return undefined;
}


function isDateLikeText(text) {
  return MONTH_DAY_TEXT_RE.test(normalizeText(text));
}


function getLeafTexts(anchor) {
  const all = anchor.querySelectorAll(TEXT_NODE_SELECTORS);
  const out = [];
  const seen = new Set();
  for (const el of all) {
    if (el.querySelector(TEXT_NODE_SELECTORS) != null) continue;
    const text = normalizeText(el.textContent);
    if (!text || text === "MORE") continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}


function parseAnchorItem(anchor, finalUrl) {
  const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
  if (!link) return null;

  const linkUrl = new URL(link);
  if (linkUrl.hostname !== "research.baidu.com") return null;
  if (!BLOG_ITEM_PATH_RE.test(linkUrl.pathname)) return null;
  if (!/^\d+$/.test(linkUrl.searchParams.get("id") ?? "")) return null;

  const texts = getLeafTexts(anchor);
  if (texts.length === 0) return null;

  const datedTexts = texts.map((text) => ({ text, date: parsePubDate(text, texts) }));
  const dateIndex = datedTexts.findIndex((x) => x.date != null);
  const pubDate = dateIndex >= 0 ? datedTexts[dateIndex].date : undefined;

  const nonDateTexts = datedTexts
    .filter((x) => x.date == null && !isDateLikeText(x.text))
    .map((x) => x.text);
  const titleCandidates = nonDateTexts.filter((text) => text.length >= 6);
  const looksLikeSummary = (text) => text.endsWith("...") || text.split(/\s+/).length >= 22;

  let title = "";
  if (titleCandidates.length > 0) {
    title = [...titleCandidates]
      .sort((a, b) => {
        const aPenalty = looksLikeSummary(a) ? 1 : 0;
        const bPenalty = looksLikeSummary(b) ? 1 : 0;
        if (aPenalty !== bPenalty) return aPenalty - bPenalty;
        return a.length - b.length;
      })[0];
  }
  if (!title && dateIndex > 0) {
    title = datedTexts.slice(0, dateIndex).map((x) => x.text).find((text) => text.length >= 6) ?? "";
  }
  if (!title) return null;

  const summary = nonDateTexts.find(
    (text) => text !== title && (text.endsWith("...") || text.length >= 40)
  );

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: pubDate ?? new Date(),
    author: "Baidu Research",
    summary: summary || undefined,
    sourceId: "baidu-research",
  };
}


function parseBlogItems(html, finalUrl) {
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]");
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const item = parseAnchorItem(anchor, finalUrl);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  return items;
}


function mergeByLink(itemsA, itemsB) {
  const byLink = new Map();
  for (const item of [...itemsA, ...itemsB]) {
    if (byLink.has(item.link)) continue;
    byLink.set(item.link, item);
  }
  return Array.from(byLink.values());
}


async function fetchItems(sourceId, ctx) {
  const primary = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  let items = parseBlogItems(primary.html, primary.finalUrl || sourceId);

  const primaryUrl = new URL(primary.finalUrl || sourceId);
  if (items.length < 5 && primaryUrl.hostname === "research.baidu.com") {
    const blogUrl = new URL("/Blog", primaryUrl).href;
    if (blogUrl !== primaryUrl.href) {
      const blogPage = await ctx.fetchHtml(blogUrl, { waitMs: 4500 });
      items = mergeByLink(items, parseBlogItems(blogPage.html, blogPage.finalUrl || blogUrl));
    }
  }

  if (items.length === 0) {
    throw new Error("[baidu-research] 未解析到 Blog 条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "baidu-research",
  listUrlPattern: /^https?:\/\/research\.baidu\.com\/(?:(?:Index|Blog)\/?)?(?:\?.*)?$/i,
  fetchItems,
};
