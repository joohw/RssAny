// 华为云社区博客插件：抓取 https://bbs.huaweicloud.com/blogs 列表条目（默认仅列表，不做 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const HUAWEICLOUD_ORIGIN = "https://bbs.huaweicloud.com";
const BLOG_PATH_RE = /^\/blogs\/\d+$/;
const DATE_RE = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/;


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function cleanTitle(text) {
  return normalizeText(text).replace(/\s+HOT$/i, "");
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function toAbsoluteUrl(href, baseUrl) {
  if (!href) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}


function getBlogPath(href, baseUrl) {
  const absolute = toAbsoluteUrl(href, baseUrl);
  if (!absolute) return null;
  try {
    const url = new URL(absolute);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    return BLOG_PATH_RE.test(normalizedPath) ? normalizedPath : null;
  } catch {
    return null;
  }
}


function parseDate(text) {
  const normalized = normalizeText(text);
  const m = normalized.match(DATE_RE);
  if (!m) return undefined;
  const [, year, month, day] = m;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}


function extractDate(card) {
  const allText = normalizeText(card?.textContent);
  return parseDate(allText);
}


function extractAuthor(card) {
  if (!card) return undefined;
  const authorAnchor = card.querySelector('a[id^="ydcomm_blog_author_"]') ??
    card.querySelector('a[href^="/community/usersnew/"]');
  return normalizeText(authorAnchor?.textContent) || undefined;
}


function extractCategories(card) {
  if (!card) return undefined;
  const categories = [];
  const seen = new Set();
  for (const anchor of card.querySelectorAll('a[href*="/tags/"]')) {
    const href = anchor.getAttribute("href") || "";
    if (!/\/tags\/.+\/blog(?:_|$)/.test(href)) continue;
    const label = normalizeText(anchor.textContent);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    categories.push(label);
  }
  return categories.length > 0 ? categories : undefined;
}


function extractSummary(card, title, linkPath, pageUrl) {
  if (!card) return undefined;
  let best = "";
  for (const anchor of card.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") || "";
    const path = getBlogPath(href, pageUrl);
    if (!path || path !== linkPath) continue;
    const text = normalizeText(anchor.textContent);
    if (!text) continue;
    if (text === title) continue;
    if (text.length > best.length) best = text;
  }
  return best || undefined;
}


function mapCardToFeedItem(card, pageUrl) {
  const titleAnchor = card?.querySelector('a[id^="ydcomm_blog_title_"][href]') ??
    card?.querySelector('a[title][href^="/blogs/"], a[title][href*="/blogs/"]');
  const href = titleAnchor?.getAttribute("href") ?? "";
  const linkPath = getBlogPath(href, pageUrl);
  if (!linkPath) return null;

  const link = toAbsoluteUrl(linkPath, pageUrl);
  if (!link) return null;

  const title = cleanTitle(titleAnchor?.getAttribute("title")) || cleanTitle(titleAnchor?.textContent);
  if (!title) return null;

  const pubDate = extractDate(card) ?? new Date();
  const summary = extractSummary(card, title, linkPath, pageUrl);
  const author = extractAuthor(card);
  const categories = extractCategories(card);

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    summary: summary || undefined,
    author,
    categories,
  };
}


function findCardRoot(node) {
  let current = node ?? null;
  for (let i = 0; i < 8 && current; i += 1) {
    if (typeof current.getAttribute === "function") {
      const id = current.getAttribute("id") || "";
      if (id.startsWith("ydcomm_blog_content_")) return current;
    }
    current = current.parentNode ?? null;
  }
  return null;
}


function parseFromCardBlocks(root, pageUrl) {
  const items = [];
  const seen = new Set();
  const cards = root.querySelectorAll('div[id^="ydcomm_blog_content_"]');
  for (const card of cards) {
    const item = mapCardToFeedItem(card, pageUrl);
    if (!item || seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }
  return items;
}


function parseFromTitleAnchors(root, pageUrl) {
  const items = [];
  const seen = new Set();
  const anchors = root.querySelectorAll('a[id^="ydcomm_blog_title_"][href]');
  for (const anchor of anchors) {
    const card = findCardRoot(anchor);
    const item = mapCardToFeedItem(card ?? anchor.parentNode, pageUrl);
    if (!item || seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }
  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);
  const pageUrl = new URL(finalUrl || sourceId, HUAWEICLOUD_ORIGIN);

  const itemsFromCards = parseFromCardBlocks(root, pageUrl);
  const items = itemsFromCards.length > 0 ? itemsFromCards : parseFromTitleAnchors(root, pageUrl);

  if (items.length === 0) {
    throw new Error("[huaweicloud-bbs-blogs] 未解析到博客条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "huaweicloud-bbs-blogs",
  listUrlPattern: /^https?:\/\/bbs\.huaweicloud\.com\/blogs\/?(\?.*)?$/i,
  refreshInterval: "1h",
  fetchItems,
};
