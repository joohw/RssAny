import { createHash } from "node:crypto";
import { parse } from "node-html-parser";

const SITE_ID = "sensetime-tech-achievements";
const DATE_RE = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toAbsoluteUrl(rawHref, baseUrl) {
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

function parseDate(dateText) {
  const text = normalizeText(dateText);
  const m = text.match(DATE_RE);
  if (!m) return undefined;
  const [, y, mm, dd] = m;
  return new Date(`${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00.000Z`);
}

function extractDateText(anchor) {
  let current = anchor;
  for (let i = 0; i < 8 && current; i += 1) {
    const text = normalizeText(current.textContent);
    const m = text.match(DATE_RE);
    if (m) return m[0];
    current = current.parentNode ?? null;
  }
  return "";
}

function extractTags(anchor, title, dateText) {
  let current = anchor;
  for (let i = 0; i < 6 && current; i += 1) {
    const spans = current.querySelectorAll?.("span") ?? [];
    const tags = spans
      .map((s) => normalizeText(s.textContent))
      .filter(Boolean)
      .filter((x) => x !== title && x !== dateText)
      .filter((x) => !DATE_RE.test(x));
    if (tags.length > 0) return Array.from(new Set(tags));
    current = current.parentNode ?? null;
  }
  return [];
}

function parseItemsFromHtml(html, finalUrl) {
  const root = parse(html);
  const anchors = root.querySelectorAll('a[href*="/technology-new-detail/"]');
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const link = toAbsoluteUrl(anchor.getAttribute("href"), finalUrl);
    if (!link || seen.has(link)) continue;

    const title = normalizeText(anchor.textContent);
    if (!title) continue;

    seen.add(link);
    const dateText = extractDateText(anchor);
    const tags = extractTags(anchor, title, dateText);
    const summary = [dateText, tags.join(" / ")].filter(Boolean).join(" | ");
    const pubDate = parseDate(dateText) ?? new Date();

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      summary: summary || undefined,
      categories: tags.length > 0 ? tags : undefined,
    });
  }

  return items;
}

async function fetchItemsFromApi(finalUrl) {
  const origin = new URL(finalUrl).origin;
  const apiUrl = new URL("/rest/v1/contents/1/getlistbyparam/48/1/20/0/0?scene=1", origin);

  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const list = Array.isArray(data?.data?.lists) ? data.data.lists : [];
  const items = [];
  const seen = new Set();

  for (const row of list) {
    const contentId = String(row?.contentId ?? "").trim();
    const title = normalizeText(row?.title);
    if (!contentId || !title) continue;
    const link = new URL(`/cn/technology-new-detail/${contentId}?categoryId=48`, origin).href;
    if (seen.has(link)) continue;
    seen.add(link);

    const dateText = normalizeText(row?.createTime);
    const tags = Array.isArray(row?.tagnames)
      ? row.tagnames.map((x) => normalizeText(x)).filter(Boolean)
      : [];
    const summary = [dateText, tags.join(" / ")].filter(Boolean).join(" | ");
    const pubDate = parseDate(dateText) ?? new Date();

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      summary: summary || undefined,
      categories: tags.length > 0 ? tags : undefined,
    });
  }

  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const items = parseItemsFromHtml(html, finalUrl);
  if (items.length > 0) return items;

  const fallbackItems = await fetchItemsFromApi(finalUrl);
  if (fallbackItems.length > 0) return fallbackItems;

  throw new Error(`[${SITE_ID}] 未解析到学术成果条目，页面结构或接口可能已变化`);
}

export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?sensetime\.com\/cn\/technology-achievements(\?.*)?$/i,
  fetchItems,
};
