// Anthropic Research 插件：抓取研究页列表条目（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const ANTHROPIC_ORIGIN = "https://www.anthropic.com";
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


function isResearchArticlePath(pathname) {
  if (!pathname.startsWith("/research/")) return false;
  if (pathname.startsWith("/research/team/")) return false;
  return pathname.length > "/research/".length;
}


function parsePubDate(dateText) {
  const normalized = normalizeText(dateText);
  if (!normalized) return undefined;

  const m = normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const month = MONTH_TO_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (month != null) {
      const day = Number(m[2]);
      const year = Number(m[3]);
      const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;
  return undefined;
}


function extractTitle(anchor) {
  const heading =
    anchor.querySelector("h2") ??
    anchor.querySelector("h3") ??
    anchor.querySelector("h4");
  const headingText = normalizeText(heading?.textContent);
  if (headingText) return headingText;

  const spans = anchor
    .querySelectorAll("span")
    .map((s) => normalizeText(s.textContent))
    .filter(Boolean);
  if (spans.length > 0) return spans[spans.length - 1];

  return normalizeText(anchor.textContent);
}


function extractSummary(anchor, title) {
  const summary = normalizeText(anchor.querySelector("p")?.textContent);
  if (summary && summary !== title) return summary;
  return undefined;
}


function extractCategories(anchor, title) {
  const candidates = anchor
    .querySelectorAll("span")
    .map((s) => normalizeText(s.textContent))
    .filter(Boolean)
    .filter((text) => text !== title)
    .filter((text) => parsePubDate(text) == null)
    .filter((text) => text.length <= 40);

  if (candidates.length === 0) return undefined;
  return Array.from(new Set(candidates));
}


function parseAnchorItem(anchor, finalUrl) {
  const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
  if (!link) return null;

  const pathname = new URL(link).pathname;
  if (!isResearchArticlePath(pathname)) return null;

  const title = extractTitle(anchor);
  if (!title) return null;

  const dateText = normalizeText(anchor.querySelector("time")?.textContent);
  const pubDate = parsePubDate(dateText) ?? new Date();
  const summary = extractSummary(anchor, title);
  const categories = extractCategories(anchor, title);

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    author: "Anthropic",
    summary,
    categories,
  };
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);

  const seen = new Set();
  const items = [];
  const anchors = root.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const item = parseAnchorItem(anchor, finalUrl || ANTHROPIC_ORIGIN);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("[anthropic-research] 未解析到研究条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "anthropic-research",
  listUrlPattern: /^https?:\/\/(www\.)?anthropic\.com\/research(?:\/)?(\?.*)?$/i,
  fetchItems,
};
