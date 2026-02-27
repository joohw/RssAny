// Moonshot 官方站插件：抓取首页“最新研究”列表，输出 FeedItem（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RESEARCH_HEADING_RE = /最新研究|latest\s+research/i;


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


function parseDate(dateText) {
  const normalized = normalizeText(dateText);
  const m = normalized.match(DATE_RE);
  if (!m) return undefined;
  const [, y, mm, dd] = m;
  const date = new Date(Date.UTC(Number(y), Number(mm) - 1, Number(dd), 12, 0, 0));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}


function extractTitleParts(anchor) {
  const parts = anchor
    .querySelectorAll("h2")
    .map((el) => normalizeText(el.textContent))
    .filter(Boolean);
  if (parts.length > 0) return parts;

  const fallback = normalizeText(anchor.textContent);
  return fallback ? [fallback] : [];
}


function parseResearchItem(anchor, finalUrl) {
  const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
  if (!link) return null;

  const titleParts = extractTitleParts(anchor);
  if (titleParts.length === 0) return null;

  const dateText = anchor
    .querySelectorAll("p")
    .map((p) => normalizeText(p.textContent))
    .find((t) => DATE_RE.test(t));
  if (!dateText) return null;

  const pubDate = parseDate(dateText) ?? new Date();
  const title = titleParts[0];
  const subtitle = titleParts.length > 1 ? titleParts.slice(1).join(" ") : "";

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate,
    summary: subtitle || undefined,
  };
}


function collectCandidateAnchors(root) {
  const heading = root
    .querySelectorAll("h1, h2, h3")
    .find((node) => RESEARCH_HEADING_RE.test(normalizeText(node.textContent)));

  if (heading?.parentNode && "querySelectorAll" in heading.parentNode) {
    return heading.parentNode.querySelectorAll("a[href]");
  }

  return root.querySelectorAll("a[href]");
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);

  const seen = new Set();
  const items = [];
  const anchors = collectCandidateAnchors(root);

  for (const anchor of anchors) {
    const item = parseResearchItem(anchor, finalUrl);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("[moonshot] 未解析到“最新研究”条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "moonshot",
  listUrlPattern: /^https?:\/\/(www\.)?moonshot\.ai(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/?(\?.*)?$/i,
  fetchItems,
};
