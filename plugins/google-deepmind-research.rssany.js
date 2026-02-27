// Google DeepMind Research 插件：抓取 research 页面中的最新研究条目（不做 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const DEEPMIND_RESEARCH_URL = "https://deepmind.google/research/";
const DEEPMIND_ORIGIN = "https://deepmind.google";
const MONTH_TO_INDEX = {
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


function parsePubDate(rawDate) {
  const normalized = normalizeText(rawDate);
  if (!normalized) return undefined;

  const monthYear = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const monthName = monthYear[1]?.toLowerCase();
    const year = Number(monthYear[2]);
    const month = monthName ? MONTH_TO_INDEX[monthName] : undefined;
    if (month != null && Number.isFinite(year)) {
      return new Date(Date.UTC(year, month, 1, 12, 0, 0));
    }
  }

  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;
  return undefined;
}


function isResearchLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return false;
  }

  if (url.hostname === "deepmind.google") {
    if (/^\/research\/publications\/\d+\/?$/i.test(url.pathname)) return true;
    if (/^\/blog\/[^?#]+/i.test(url.pathname)) return true;
    return false;
  }

  if (url.hostname === "blog.google") {
    return /^\/technology\/google-deepmind\/[^?#]+/i.test(url.pathname);
  }

  return false;
}


function categoryFromLink(link) {
  try {
    const url = new URL(link);
    if (/^\/research\/publications\//i.test(url.pathname)) return ["Publications"];
  } catch {
    // ignore
  }
  return ["News"];
}


function extractTitle(container) {
  const heading =
    container.querySelector("h1") ??
    container.querySelector("h2") ??
    container.querySelector("h3") ??
    container.querySelector("h4");
  const title = normalizeText(heading?.textContent);
  if (title) return title;
  return "";
}


function extractSummary(container, title) {
  const summary = normalizeText(container.querySelector("p")?.textContent);
  if (!summary) return undefined;
  if (summary === title) return undefined;
  return summary;
}


function isCallToActionTitle(title) {
  return /^(learn|view|see|read|watch)\b/i.test(title);
}


function parseItemsFromArticles(root, baseUrl) {
  const items = [];
  const seen = new Set();
  const articles = root.querySelectorAll("article");

  for (const article of articles) {
    const title = extractTitle(article);
    if (!title || isCallToActionTitle(title)) continue;

    const anchor = article.querySelector("a[href]");
    const link = toAbsoluteHttpUrl(anchor?.getAttribute("href"), baseUrl);
    if (!link || !isResearchLink(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);

    const dateRaw =
      article.querySelector("time")?.getAttribute("datetime") ??
      article.querySelector("time")?.textContent ??
      "";
    const pubDate = parsePubDate(dateRaw) ?? new Date();
    const summary = extractSummary(article, title);
    const categories = categoryFromLink(link);

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      author: "Google DeepMind",
      summary,
      categories,
      sourceId: "google-deepmind-research",
    });
  }

  return items;
}


function findTitleAroundAnchor(anchor) {
  const inlineHeading =
    anchor.querySelector("h1, h2, h3, h4") ??
    anchor.parentNode?.querySelector?.("h1, h2, h3, h4");
  const title = normalizeText(inlineHeading?.textContent);
  if (title) return title;

  const text = normalizeText(anchor.textContent);
  if (text && text.length >= 8 && !isCallToActionTitle(text)) return text;
  return "";
}


function parseItemsFromAnchors(root, baseUrl) {
  const items = [];
  const seen = new Set();
  const anchors = root.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), baseUrl);
    if (!link || !isResearchLink(link)) continue;
    if (seen.has(link)) continue;

    const title = findTitleAroundAnchor(anchor);
    if (!title) continue;

    const container = anchor.parentNode ?? anchor;
    const dateRaw =
      container.querySelector?.("time")?.getAttribute?.("datetime") ??
      container.querySelector?.("time")?.textContent ??
      "";
    const pubDate = parsePubDate(dateRaw) ?? new Date();
    const summary = extractSummary(container, title);
    const categories = categoryFromLink(link);

    seen.add(link);
    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      author: "Google DeepMind",
      summary,
      categories,
      sourceId: "google-deepmind-research",
    });
  }

  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);
  const baseUrl = finalUrl || DEEPMIND_ORIGIN;

  const fromArticles = parseItemsFromArticles(root, baseUrl);
  if (fromArticles.length > 0) return fromArticles;

  const fromAnchors = parseItemsFromAnchors(root, baseUrl);
  if (fromAnchors.length > 0) return fromAnchors;

  throw new Error("[google-deepmind-research] 未解析到研究条目，页面结构可能已变化");
}


export default {
  id: "google-deepmind-research",
  listUrlPattern: /^https?:\/\/deepmind\.google\/research\/?(?:\?.*)?$/i,
  fetchItems,
};
