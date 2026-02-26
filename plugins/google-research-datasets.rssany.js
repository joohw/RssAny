import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const GOOGLE_RESEARCH_AUTHOR = "Google Research Datasets";
const DATASETS_URL = "https://research.google/resources/datasets/";
const MIN_SUMMARY_LENGTH = 24;


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function isGoogleHost(hostname) {
  return /^([a-z0-9-]+\.)*google\.[a-z.]+$/i.test(hostname);
}


function resolveHttpUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;

  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}


function resolveResultLink(rawHref, baseUrl) {
  const url = resolveHttpUrl(rawHref, baseUrl);
  if (!url) return null;

  if (isGoogleHost(url.hostname) && url.pathname === "/url") {
    const target = resolveHttpUrl(url.searchParams.get("q") ?? url.searchParams.get("url"), url.href);
    return target?.href ?? null;
  }
  return url.href;
}


function dedupeTexts(texts) {
  const out = [];
  const seen = new Set();
  for (const text of texts) {
    const normalized = normalizeText(text);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}


function extractLeafTexts(anchor) {
  const leaves = anchor
    .querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,div")
    .filter((node) => node.querySelector("h1,h2,h3,h4,h5,h6,p,span,div") == null)
    .map((node) => normalizeText(node.textContent))
    .filter(Boolean);
  return dedupeTexts(leaves);
}


function parseYearFromText(text) {
  if (!text) return undefined;
  const matches = text.match(/\b20\d{2}\b/g) ?? [];
  if (matches.length === 0) return undefined;
  const currentYear = new Date().getUTCFullYear();
  const years = matches
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .filter((x) => x >= 2000 && x <= currentYear + 1);
  if (years.length === 0) return undefined;
  return Math.max(...years);
}


function buildItem(title, link, summary, index) {
  const year = parseYearFromText(`${title} ${summary ?? ""}`);
  const pubDate = year == null
    ? new Date(Date.now() - index * 1000)
    : new Date(Date.UTC(year, 0, 1, 12, 0, 0));
  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    author: GOOGLE_RESEARCH_AUTHOR,
    summary: summary || undefined,
  };
}


function parseFromPurifiedHtml(html, finalUrl) {
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]");
  const seenLinks = new Set();
  const items = [];

  for (const anchor of anchors) {
    const link = resolveResultLink(anchor.getAttribute("href"), finalUrl);
    if (!link || seenLinks.has(link)) continue;

    const texts = extractLeafTexts(anchor);
    if (texts.length < 2) continue;
    const title = texts[0];
    const summary = texts.find((text) => text !== title && text.length >= MIN_SUMMARY_LENGTH);
    if (!title || !summary) continue;

    seenLinks.add(link);
    items.push(buildItem(title, link, summary, items.length));
  }

  return items;
}


function parseFromRawHtml(html, finalUrl) {
  const root = parse(html);
  const anchors = root.querySelectorAll("a.row-card[href]");
  const seenLinks = new Set();
  const items = [];

  for (const anchor of anchors) {
    const link = resolveResultLink(anchor.getAttribute("href"), finalUrl);
    if (!link || seenLinks.has(link)) continue;

    const title = normalizeText(anchor.querySelector(".row-card__heading")?.textContent);
    const summary = normalizeText(anchor.querySelector(".row-card__subheading__item")?.textContent);
    if (!title || !summary) continue;

    seenLinks.add(link);
    items.push(buildItem(title, link, summary, items.length));
  }

  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const fromPurified = parseFromPurifiedHtml(html, finalUrl || sourceId || DATASETS_URL);
  if (fromPurified.length > 0) return fromPurified;

  const raw = await ctx.fetchHtml(sourceId, { waitMs: 3500, purify: false });
  const fromRaw = parseFromRawHtml(raw.html, raw.finalUrl || sourceId || DATASETS_URL);
  if (fromRaw.length > 0) return fromRaw;

  throw new Error("[google-research-datasets] 未解析到数据集条目，页面结构可能已变化");
}


export default {
  id: "google-research-datasets",
  listUrlPattern: /^https?:\/\/research\.google\/resources\/datasets\/?(\?.*)?$/i,
  fetchItems,
};
