// Google Research 首页插件：抓取 research.google 首页中的最新博客/论文条目（不做 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const BLOG_DETAIL_PATH_RE = /^\/blog\/(?!rss\/?$|label\/|\d{4}(?:\/|$))[^?#]+/i;
const PUBS_DETAIL_PATH_RE = /^\/pubs\/(?!$|\/?$)[^?#]+/i;
const CTA_TITLE_RE = /^(see|learn|explore|read|watch)\b/i;
const MONTH_NAME_RE =
  /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*|\s+)(\d{4})/i;
const MONTH_DAY_RE =
  /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i;
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
  return (text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function splitMeaningfulLines(text) {
  return (text ?? "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line !== "·");
}


function decodeSlug(slug) {
  return normalizeText(
    slug
      .replace(/[-_]+/g, " ")
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
  );
}


function toAbsoluteHttpUrl(rawHref, pageUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    const url = new URL(href, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}


function isResearchItemPath(pathname) {
  return BLOG_DETAIL_PATH_RE.test(pathname) || PUBS_DETAIL_PATH_RE.test(pathname);
}


function extractTitle(anchor, linkUrl) {
  const heading = anchor.querySelector("h1, h2, h3, h4, h5, h6");
  const headingText = normalizeText(heading?.textContent);
  if (headingText) return headingText;

  const spanText = normalizeText(anchor.querySelector("span")?.textContent);
  if (spanText && spanText.length >= 6 && !MONTH_DAY_RE.test(spanText)) return spanText;

  const lines = splitMeaningfulLines(anchor.textContent).filter((line) => {
    if (line.length < 3) return false;
    if (MONTH_NAME_RE.test(line) || MONTH_DAY_RE.test(line)) return false;
    if (line.toUpperCase() === "BLOG" || line.toUpperCase() === "PUBLICATIONS") return false;
    return true;
  });
  if (lines.length > 0) return lines[0];

  const segments = linkUrl.pathname.split("/").filter(Boolean);
  const slug = segments.at(-1) ?? "";
  return decodeSlug(slug);
}


function parseDateFromText(text) {
  const normalized = normalizeText(text);
  const monthWithYear = normalized.match(MONTH_NAME_RE);
  if (monthWithYear) {
    const monthName = monthWithYear[1]?.toLowerCase();
    const day = Number(monthWithYear[2]);
    const year = Number(monthWithYear[3]);
    const month = monthName ? MONTH_INDEX[monthName] : undefined;
    if (month != null && Number.isFinite(day) && Number.isFinite(year)) {
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }
  }

  const monthDayOnly = normalized.match(MONTH_DAY_RE);
  if (monthDayOnly) {
    const monthName = monthDayOnly[1]?.toLowerCase();
    const day = Number(monthDayOnly[2]);
    const year = new Date().getFullYear();
    const month = monthName ? MONTH_INDEX[monthName] : undefined;
    if (month != null && Number.isFinite(day)) {
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }
  }

  const yearMatch = normalized.match(/\((19|20)\d{2}\)/);
  if (yearMatch) {
    const year = Number(yearMatch[0].replace(/[()]/g, ""));
    if (year >= 1990 && year <= new Date().getFullYear() + 1) {
      return new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    }
  }
  return undefined;
}


function extractSummary(anchor, title) {
  const lines = splitMeaningfulLines(anchor.textContent).filter((line) => {
    if (!line) return false;
    if (line === title) return false;
    if (MONTH_NAME_RE.test(line) || MONTH_DAY_RE.test(line)) return false;
    return true;
  });
  if (lines.length === 0) return undefined;
  const summary = normalizeText(lines.slice(0, 2).join(" · "));
  return summary || undefined;
}


function collectContextText(anchor) {
  let cur = anchor;
  const chunks = [];
  for (let i = 0; i < 4 && cur; i += 1) {
    const text = normalizeText(cur.textContent);
    if (text) chunks.push(text);
    cur = cur.parentNode ?? null;
  }
  return chunks.join(" ");
}


function isCallToActionTitle(title) {
  const normalized = normalizeText(title);
  if (!normalized) return true;
  if (!CTA_TITLE_RE.test(normalized)) return false;
  return normalized.split(" ").length <= 8;
}


function parseItemsFromHome(html, pageUrl) {
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]");
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const linkUrl = toAbsoluteHttpUrl(anchor.getAttribute("href"), pageUrl);
    if (!linkUrl) continue;
    if (linkUrl.hostname !== "research.google") continue;
    if (!isResearchItemPath(linkUrl.pathname)) continue;

    const link = linkUrl.href;
    if (seen.has(link)) continue;
    seen.add(link);

    const title = extractTitle(anchor, linkUrl);
    if (!title) continue;
    if (isCallToActionTitle(title)) continue;

    const context = collectContextText(anchor);
    const pubDate = parseDateFromText(context) ?? new Date();
    const summary = extractSummary(anchor, title);

    items.push({
      guid: createHash("sha256").update(link).digest("hex"),
      title,
      link,
      pubDate,
      author: "Google Research",
      summary,
      sourceId: "google-research",
    });
  }

  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4000 });
  const pageUrl = new URL(finalUrl);
  const items = parseItemsFromHome(html, pageUrl);
  if (items.length === 0) {
    throw new Error("[google-research] 未解析到条目，页面结构可能已变化");
  }
  return items;
}


export default {
  id: "google-research",
  listUrlPattern: /^https?:\/\/research\.google\/?(?:\?.*)?$/i,
  fetchItems,
};
