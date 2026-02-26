// OpenDriveLab 首页插件：解析首页展示内容并输出 FeedItem（不含 enrich）

import { createHash } from "node:crypto";
import { NodeType, parse } from "node-html-parser";

const SITE_ID = "opendrivelab";
const NAVIGATION_TITLES = new Set([
  "news",
  "recruit",
  "research",
  "publication",
  "dataset",
  "event",
  "more",
  "team",
  "sponsor",
  "opendrivelab",
  "embodied ai",
  "autonomous driving",
]);
const ACTION_LABELS = new Set([
  "paper",
  "page",
  "blog",
  "code",
  "github",
  "dataset",
  "demo",
  "video",
  "poster",
  "slides",
  "community",
  "cite",
  "checkout at mmlab.hk/mm-hand",
]);
const NAVIGATION_PATHS = new Set([
  "/",
  "/embodiedai",
  "/autonomousdriving",
  "/publications",
  "/events",
  "/team",
  "/recruit",
  "/ccai9025",
]);

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toAbsoluteHttpUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizePath(pathname) {
  if (!pathname) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return (trimmed || "/").toLowerCase();
}

function isBlockedPage(root, html, finalUrl) {
  const text = normalizeText(root.textContent).toLowerCase();
  const body = (html ?? "").toLowerCase();
  const url = (finalUrl ?? "").toLowerCase();
  if (url.includes("/cdn-cgi/challenge")) return true;
  if (body.includes("__cf_chl_opt")) return true;
  if (body.includes("/cdn-cgi/challenge-platform")) return true;
  if (text.includes("just a moment")) return true;
  if (text.includes("checking your browser")) return true;
  if (text.includes("attention required")) return true;
  return text.includes("captcha");
}

function isNoiseTitle(text) {
  const title = normalizeText(text);
  if (!title) return true;
  const lower = title.toLowerCase();
  if (NAVIGATION_TITLES.has(lower)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(lower)) return true;
  if (title.length < 8) return true;
  return false;
}

function isActionLabel(text) {
  const lower = normalizeText(text).toLowerCase();
  if (!lower) return true;
  if (ACTION_LABELS.has(lower)) return true;
  if (/(best paper|award|finalist|position paper)/i.test(lower)) return true;
  return false;
}

function findContentContainer(node) {
  let current = node;
  for (let i = 0; i < 8 && current; i += 1) {
    if (current.nodeType !== NodeType.ELEMENT_NODE) {
      current = current.parentNode ?? null;
      continue;
    }
    const anchors = current.querySelectorAll?.("a[href]") ?? [];
    if (anchors.length >= 1 && anchors.length <= 20) return current;
    current = current.parentNode ?? null;
  }
  return node.parentNode ?? node;
}

function parseDateFromText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;

  let m = normalized.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (m) {
    const [, y, mm, dd] = m;
    const date = new Date(Date.UTC(Number(y), Number(mm) - 1, Number(dd), 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }

  m = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(20\d{2})\b/i);
  if (m) {
    const monthMap = {
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
    const monthIndex = monthMap[m[1].toLowerCase()];
    const year = Number(m[2]);
    const date = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }

  m = normalized.match(/\b(20\d{2})\b/);
  if (m) {
    const year = Number(m[1]);
    const date = new Date(Date.UTC(year, 0, 1, 12, 0, 0));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function parseDateFromLink(link) {
  try {
    const url = new URL(link);
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return undefined;
    const m = url.pathname.match(/\/abs\/(\d{2})(\d{2})\.\d+/);
    if (!m) return undefined;
    const year = 2000 + Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return undefined;
    const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
    return Number.isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

function pickPrimaryLink(container, title, baseUrl) {
  const anchors = container.querySelectorAll("a[href]");
  const candidates = [];

  for (const anchor of anchors) {
    const text = normalizeText(anchor.textContent);
    if (!text) continue;
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), baseUrl);
    if (!link) continue;
    const path = normalizePath(new URL(link).pathname);
    candidates.push({ text, textLower: text.toLowerCase(), link, path });
  }

  if (candidates.length === 0) return null;

  const normalizedTitle = normalizeText(title).toLowerCase();
  const titleMatch = candidates.find((item) => item.textLower === normalizedTitle);
  if (titleMatch) return titleMatch.link;

  const actionMatch = candidates.find((item) => ACTION_LABELS.has(item.textLower));
  if (actionMatch) return actionMatch.link;

  const nonNav = candidates.find((item) => !NAVIGATION_PATHS.has(item.path));
  return (nonNav ?? candidates[0]).link;
}

function pickSummary(container, title) {
  const texts = [];
  for (const selector of ["i", "p", "h2", "h3", "span"]) {
    for (const node of container.querySelectorAll(selector)) {
      const text = normalizeText(node.textContent);
      if (!text || text === title) continue;
      if (isActionLabel(text)) continue;
      if (/^\d+\s*\/\s*\d+$/.test(text)) continue;
      if (parseDateFromText(text) && text.length <= 24) continue;
      texts.push(text);
    }
  }

  const unique = [...new Set(texts)];
  return unique.find((text) => text.length >= 20 && text.length <= 400);
}

function extractPubDate(headingNode, container, link) {
  const texts = [];
  const aroundHeading = normalizeText(headingNode.parentNode?.textContent);
  if (aroundHeading) texts.push(aroundHeading);
  const containerText = normalizeText(container.textContent);
  if (containerText) texts.push(containerText);

  let cursor = container.parentNode ?? null;
  for (let i = 0; i < 3 && cursor; i += 1) {
    const t = normalizeText(cursor.textContent);
    if (t && t.length <= 3000) texts.push(t);
    cursor = cursor.parentNode ?? null;
  }

  for (const text of texts) {
    const date = parseDateFromText(text);
    if (date) return date;
  }

  return parseDateFromLink(link) ?? new Date();
}

function toFeedItem({ title, link, pubDate, summary }) {
  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    author: "OpenDriveLab",
    summary: summary || undefined,
    sourceId: SITE_ID,
  };
}

function parseFromHeadings(root, finalUrl, seen) {
  const items = [];
  const headings = root.querySelectorAll("h1, h2, h3");

  for (const heading of headings) {
    const title = normalizeText(heading.textContent);
    if (isNoiseTitle(title)) continue;

    const container = findContentContainer(heading);
    const link = pickPrimaryLink(container, title, finalUrl);
    if (!link || seen.has(link)) continue;

    seen.add(link);
    items.push(
      toFeedItem({
        title,
        link,
        summary: pickSummary(container, title),
        pubDate: extractPubDate(heading, container, link),
      }),
    );
  }

  return items;
}

function parseFromTitleAnchors(root, finalUrl, seen) {
  const items = [];
  const anchors = root.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    if (!title || title.length < 20) continue;
    if (isNoiseTitle(title) || isActionLabel(title)) continue;

    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
    if (!link || seen.has(link)) continue;

    const path = normalizePath(new URL(link).pathname);
    if (NAVIGATION_PATHS.has(path)) continue;

    const container = findContentContainer(anchor);
    seen.add(link);
    items.push(
      toFeedItem({
        title,
        link,
        summary: pickSummary(container, title),
        pubDate: extractPubDate(anchor, container, link),
      }),
    );
  }

  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);

  const seenLinks = new Set();
  const items = [
    ...parseFromHeadings(root, finalUrl, seenLinks),
    ...parseFromTitleAnchors(root, finalUrl, seenLinks),
  ];

  if (items.length > 0) return items;

  if (isBlockedPage(root, html, finalUrl)) {
    throw new Error(`[${SITE_ID}] 命中站点风控验证页，当前会话无法稳定抓取`);
  }
  throw new Error(`[${SITE_ID}] 未解析到首页条目，页面结构可能已变化`);
}

export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?opendrivelab\.com\/?(\?.*)?$/i,
  fetchItems,
};
