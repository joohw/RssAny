// Bright Data 博客插件：优先解析站点 RSS feed，失败时回退解析列表页（不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const BRIGHTDATA_ORIGIN = "https://brightdata.com";
const LIST_URL_RE =
  /^https?:\/\/(?:www\.)?brightdata\.com\/blog(?:\/(?:page\/\d+|[a-z0-9-]+(?:\/page\/\d+)?)?)?\/?(?:\?.*)?$/i;
const ARTICLE_PATH_RE = /^\/blog\/([^/?#/]+)\/([^/?#/]+)\/?$/i;
const MIN_READ_RE = /^\d+\s*min\s*read$/i;


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


function parsePubDate(raw) {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}


function isBrightDataArticleUrl(urlText) {
  try {
    const url = new URL(urlText);
    if (!/(^|\.)brightdata\.com$/i.test(url.hostname)) return false;
    const m = url.pathname.match(ARTICLE_PATH_RE);
    if (!m) return false;
    return m[1].toLowerCase() !== "page" && m[1].toLowerCase() !== "feed";
  } catch {
    return false;
  }
}


function formatCategory(raw) {
  return raw
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
    .filter(Boolean)
    .join(" ");
}


function extractCategoryFromLink(link) {
  try {
    const url = new URL(link);
    const m = url.pathname.match(ARTICLE_PATH_RE);
    if (!m) return undefined;
    const category = formatCategory(m[1]);
    return category || undefined;
  } catch {
    return undefined;
  }
}


function uniqueTexts(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}


function queryText(node, selectors) {
  for (const selector of selectors) {
    try {
      const text = normalizeText(node.querySelector(selector)?.textContent);
      if (text) return text;
    } catch {
      // ignore unsupported selectors
    }
  }
  return "";
}


function deriveFeedUrlFromListUrl(sourceId) {
  try {
    const url = new URL(sourceId, BRIGHTDATA_ORIGIN);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "blog") return new URL("/blog/feed/", url.origin).href;

    if (parts.length >= 2 && parts[1].toLowerCase() !== "page") {
      return new URL(`/blog/${parts[1]}/feed/`, url.origin).href;
    }
    return new URL("/blog/feed/", url.origin).href;
  } catch {
    return null;
  }
}


function resolveFeedUrl(root, pageUrl) {
  const feedHref = root
    .querySelector('link[rel="alternate"][type="application/rss+xml"][href], link[href*="/feed/"][type="application/rss+xml"]')
    ?.getAttribute("href");
  return toAbsoluteHttpUrl(feedHref, pageUrl);
}


async function fetchFeedItems(feedUrl) {
  const res = await fetch(feedUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`[brightdata-blog] 获取 RSS feed 失败: ${res.status}`);
  }

  const xml = await res.text();
  const root = parse(xml);
  const items = [];
  const seen = new Set();

  for (const entry of root.querySelectorAll("item")) {
    const title = queryText(entry, ["title"]);
    const link = toAbsoluteHttpUrl(queryText(entry, ["link"]), feedUrl);
    if (!title || !link || !isBrightDataArticleUrl(link) || seen.has(link)) continue;
    seen.add(link);

    const summary = queryText(entry, ["description"]);
    const author = queryText(entry, ["dc\\:creator", "creator", "author"]);
    const pubDateRaw = queryText(entry, ["pubDate", "published", "updated", "dc\\:date"]);
    const pubDate = parsePubDate(pubDateRaw) ?? new Date();

    const categories = entry
      .querySelectorAll("category")
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);
    const fallbackCategory = extractCategoryFromLink(link);
    const finalCategories = categories.length > 0
      ? uniqueTexts(categories)
      : (fallbackCategory ? [fallbackCategory] : undefined);

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      author: author || undefined,
      summary: summary || undefined,
      categories: finalCategories,
    });
  }
  return items;
}


function collectLeafTexts(anchor) {
  const nodes = anchor.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span, div");
  const texts = [];
  for (const node of nodes) {
    if (node.querySelector("h1, h2, h3, h4, h5, h6, p, span, div")) continue;
    const text = normalizeText(node.textContent);
    if (/<[^>]+>/.test(text)) continue;
    if (text) texts.push(text);
  }
  return uniqueTexts(texts);
}


function isMetaText(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return true;
  if (MIN_READ_RE.test(normalized)) return true;
  return (
    normalized === "editor's pick" ||
    normalized === "latest articles" ||
    normalized === "all categories" ||
    normalized.includes("min read")
  );
}


function extractTitle(anchor, texts, category) {
  const categoryText = normalizeText(category).toLowerCase();
  const heading = normalizeText(anchor.querySelector("h1, h2, h3, h4, h5, h6")?.textContent);
  if (heading && !isMetaText(heading) && heading.toLowerCase() !== categoryText) return heading;

  for (const text of texts) {
    if (isMetaText(text)) continue;
    if (categoryText && text.toLowerCase() === categoryText) continue;
    if (text.length < 12) continue;
    return text;
  }
  return "";
}


function extractSummary(title, texts) {
  for (const text of texts) {
    if (!text || text === title || isMetaText(text)) continue;
    if (text.length < 20) continue;
    return text;
  }
  return "";
}


function extractAuthor(anchor) {
  const images = anchor.querySelectorAll("img[alt]");
  for (const image of images) {
    const alt = normalizeText(image.getAttribute("alt"));
    if (!alt) continue;
    if (/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2}$/.test(alt)) return alt;
  }
  return "";
}


function parseHtmlItems(root, baseUrl) {
  const items = [];
  const seen = new Set();
  for (const anchor of root.querySelectorAll("a[href]")) {
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), baseUrl);
    if (!link || !isBrightDataArticleUrl(link) || seen.has(link)) continue;
    const category = extractCategoryFromLink(link);

    const texts = collectLeafTexts(anchor);
    const title = extractTitle(anchor, texts, category);
    if (!title) continue;

    seen.add(link);
    const summary = extractSummary(title, texts);
    const author = extractAuthor(anchor);

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate: new Date(),
      author: author || undefined,
      summary: summary || undefined,
      categories: category ? [category] : undefined,
    });
  }
  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const root = parse(html);
  const pageUrl = finalUrl || sourceId || BRIGHTDATA_ORIGIN;

  const discoveredFeedUrl = resolveFeedUrl(root, pageUrl);
  const fallbackFeedUrl = deriveFeedUrlFromListUrl(pageUrl);
  const feedUrls = uniqueTexts([discoveredFeedUrl, fallbackFeedUrl]);
  for (const feedUrl of feedUrls) {
    try {
      const fromFeed = await fetchFeedItems(feedUrl);
      if (fromFeed.length > 0) return fromFeed;
    } catch {
      // feed 失败时回退 HTML 解析
    }
  }

  const fromHtml = parseHtmlItems(root, pageUrl);
  if (fromHtml.length === 0) {
    throw new Error("[brightdata-blog] 未解析到文章条目，页面结构可能已变化");
  }
  return fromHtml;
}


export default {
  id: "brightdata-blog",
  listUrlPattern: LIST_URL_RE,
  fetchItems,
};
