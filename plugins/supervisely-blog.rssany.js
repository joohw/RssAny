// Supervisely Blog 插件：抓取列表页并解析为 FeedItem（不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const SUPERVISELY_ORIGIN = "https://supervisely.com";
const MONTH_INDEX = {
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


function parsePubDate(rawText) {
  const text = normalizeText(rawText);
  const m = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return undefined;
  const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
  if (month == null) return undefined;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!Number.isInteger(day) || !Number.isInteger(year)) return undefined;
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
}


function looksLikeBlogLink(link) {
  try {
    const u = new URL(link);
    return /^\/blog\/[^/]+\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}


function findAncestor(node, maxDepth) {
  let current = node?.parentNode ?? null;
  for (let i = 0; i < maxDepth && current; i += 1) {
    if (current.querySelector?.("time")) return current;
    current = current.parentNode ?? null;
  }
  return node?.parentNode ?? null;
}


function buildFeedItem({ title, link, summary, author, pubDate }) {
  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: pubDate ?? new Date(),
    author: author || undefined,
    summary: summary || undefined,
  };
}


function parseFromCards(root, baseUrl) {
  const seen = new Set();
  const items = [];
  const cards = root.querySelectorAll("div.blog-card");

  for (const card of cards) {
    const titleAnchor = card.querySelector("h4 a[href]");
    const title = normalizeText(titleAnchor?.textContent);
    const link = toAbsoluteUrl(titleAnchor?.getAttribute("href"), baseUrl);
    if (!title || !link || !looksLikeBlogLink(link) || seen.has(link)) continue;

    const summary = normalizeText(card.querySelector("p")?.textContent);
    const author = normalizeText(card.querySelector('b[rel="author"], address b')?.textContent);
    const pubDateText = normalizeText(card.querySelector("time")?.textContent);
    const pubDate = parsePubDate(pubDateText);

    seen.add(link);
    items.push(buildFeedItem({ title, link, summary, author, pubDate }));
  }

  return items;
}


function parseFromHeadingFallback(root, baseUrl) {
  const seen = new Set();
  const items = [];
  const anchors = root.querySelectorAll('h4 a[href*="/blog/"]');

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    const link = toAbsoluteUrl(anchor.getAttribute("href"), baseUrl);
    if (!title || !link || !looksLikeBlogLink(link) || seen.has(link)) continue;

    const container = findAncestor(anchor, 7);
    const summary = normalizeText(container?.querySelector("p")?.textContent);
    const author = normalizeText(container?.querySelector('b[rel="author"], address b')?.textContent);
    const pubDateText = normalizeText(container?.querySelector("time")?.textContent);
    const pubDate = parsePubDate(pubDateText);

    seen.add(link);
    items.push(buildFeedItem({ title, link, summary, author, pubDate }));
  }

  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const root = parse(html);
  const baseUrl = finalUrl || SUPERVISELY_ORIGIN;

  const fromCards = parseFromCards(root, baseUrl);
  const items = fromCards.length > 0 ? fromCards : parseFromHeadingFallback(root, baseUrl);

  if (items.length === 0) {
    throw new Error("[supervisely-blog] 未解析到文章条目，页面结构可能已变化");
  }
  return items;
}


export default {
  id: "supervisely-blog",
  listUrlPattern: /^https?:\/\/(www\.)?supervisely\.com\/blog\/?(?:\?.*)?$/i,
  fetchItems,
};
