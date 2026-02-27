// Meta AI Publications 插件：抓取结果页中的 publication 条目（不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const PUBLICATION_PATH_RE = /^\/research\/publications\/[^?#]+\/?$/i;
const PUBLICATION_RESULTS_URL_RE =
  /^https?:\/\/ai\.meta\.com\/results\/?\?.*content_types(?:%5B0%5D|\[0\])=publication(?:&.*)?$/i;
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
  return (text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function toAbsolutePublicationUrl(rawHref, pageUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    const url = new URL(href, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (url.hostname !== "ai.meta.com") return null;
    if (!PUBLICATION_PATH_RE.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}


function parsePubDate(rawDate) {
  const normalized = normalizeText(rawDate);
  if (!normalized) return undefined;
  const m = normalized.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})$/i
  );
  if (!m) return undefined;
  const monthName = m[1]?.toLowerCase();
  const day = Number(m[2]);
  const year = Number(m[3]);
  const month = monthName ? MONTH_TO_INDEX[monthName] : undefined;
  if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;
  return new Date(Date.UTC(year, month, day, 0, 0, 0));
}


function decodeTitleFromLink(link) {
  try {
    const path = new URL(link).pathname;
    const slug = path.split("/").filter(Boolean).at(-1) ?? "";
    if (!slug) return "";
    const decoded = decodeURIComponent(slug).replace(/[-_]+/g, " ");
    return normalizeText(decoded.replace(/\b([a-z])/g, (m) => m.toUpperCase()));
  } catch {
    return "";
  }
}


function looksLikeCategory(text) {
  if (!text || text.length > 80) return false;
  if (/[.!?]/.test(text)) return false;
  if (/\d{4}/.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  const uppercase = letters.replace(/[^A-Z]/g, "").length;
  const ratio = uppercase / letters.length;
  return ratio >= 0.7 || text.includes("|");
}


function looksLikeAuthorLine(text) {
  if (!text) return false;
  if (text.length < 8 || text.length > 700) return false;
  if (!text.includes(",")) return false;
  if (/[.!?]/.test(text)) return false;
  return /[A-Za-z]/.test(text);
}


function collectUniqueTexts(nodes) {
  const out = [];
  const seen = new Set();
  for (const node of nodes) {
    const text = normalizeText(node.textContent);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}


function findCardRoot(anchor) {
  let cur = anchor;
  let fallback = null;
  for (let i = 0; i < 8 && cur; i += 1) {
    const headings = collectUniqueTexts(cur.querySelectorAll?.("h1, h2, h3, h4, h5, h6") ?? []);
    const paragraphs = collectUniqueTexts(cur.querySelectorAll?.("p") ?? []);
    const hasDate = paragraphs.some((p) => parsePubDate(p) != null);
    if (headings.length >= 2 && hasDate) return cur;
    if (headings.length >= 1 && paragraphs.length >= 3) fallback = cur;
    cur = cur.parentNode ?? null;
  }
  return fallback ?? anchor.parentNode ?? anchor;
}


function extractTitle(card, link) {
  const headings = collectUniqueTexts(card.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const candidates = headings
    .filter((text) => !/^(publication|read the paper)$/i.test(text))
    .filter((text) => !looksLikeCategory(text));
  const chosen = candidates.find((text) => text.length >= 8) ?? candidates.at(-1) ?? "";
  if (chosen) return chosen;
  return decodeTitleFromLink(link);
}


function extractPubDateFromCard(card) {
  const timeDatetime = card.querySelector("time[datetime]")?.getAttribute("datetime");
  if (timeDatetime) {
    const direct = new Date(timeDatetime);
    if (!Number.isNaN(direct.getTime())) return direct;
  }
  const paragraphs = collectUniqueTexts(card.querySelectorAll("p, span, div"));
  for (const text of paragraphs) {
    const parsed = parsePubDate(text);
    if (parsed) return parsed;
  }
  return undefined;
}


function extractSummary(card, title) {
  const paragraphs = collectUniqueTexts(card.querySelectorAll("p"));
  const candidates = paragraphs
    .filter((text) => !/^(publication|read the paper)$/i.test(text))
    .filter((text) => parsePubDate(text) == null)
    .filter((text) => !looksLikeAuthorLine(text))
    .filter((text) => !looksLikeCategory(text))
    .filter((text) => text !== title);
  const summary = candidates.find((text) => text.length >= 40) ?? "";
  return summary || undefined;
}


function extractCategories(card) {
  const headings = collectUniqueTexts(card.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const categoryLine = headings.find((text) => looksLikeCategory(text));
  if (!categoryLine) return undefined;
  const categories = categoryLine
    .split("|")
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return categories.length > 0 ? categories : undefined;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl, status } = await ctx.fetchHtml(sourceId, { waitMs: 3500, purify: false });
  if (status >= 400) {
    throw new Error(`[meta-ai-publications] 抓取失败: HTTP ${status}`);
  }

  const root = parse(html);
  const pageUrl = finalUrl || sourceId;
  const anchors = root.querySelectorAll('a[href*="/research/publications/"]');
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const link = toAbsolutePublicationUrl(anchor.getAttribute("href"), pageUrl);
    if (!link || seen.has(link)) continue;
    seen.add(link);

    const card = findCardRoot(anchor);
    const title = extractTitle(card, link);
    if (!title) continue;

    const pubDate = extractPubDateFromCard(card) ?? new Date();
    const summary = extractSummary(card, title);
    const categories = extractCategories(card);

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      author: "Meta AI",
      summary,
      categories,
      sourceId: "meta-ai-publications",
    });
  }

  if (items.length === 0) {
    throw new Error(
      "[meta-ai-publications] 未解析到 publication 条目，可能是页面结构变化，或需要更长等待时间/可用浏览器会话"
    );
  }
  return items;
}


export default {
  id: "meta-ai-publications",
  listUrlPattern: PUBLICATION_RESULTS_URL_RE,
  fetchItems,
};
