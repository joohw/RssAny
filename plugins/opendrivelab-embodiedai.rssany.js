import { createHash } from "node:crypto";
import { parse } from "node-html-parser";

const SITE_ID = "opendrivelab-embodiedai";
const DATE_RE = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/;
const ACTION_LINK_LABELS = new Set([
  "paper",
  "page",
  "blog",
  "github",
  "video",
  "dataset",
  "challenge",
  "hugging face",
  "hardware guide",
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
  const date = new Date(Date.UTC(Number(y), Number(mm) - 1, Number(dd), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isActionLabel(text) {
  const normalized = normalizeText(text).toLowerCase();
  return ACTION_LINK_LABELS.has(normalized);
}

function findTitleAnchor(liNode, finalUrl) {
  const anchors = liNode.querySelectorAll("a[href]");
  let fallback = null;

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    if (!title || isActionLabel(title)) continue;
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), finalUrl);
    if (!link) continue;
    if (!fallback) fallback = { anchor, link, title };
    if (title.length >= 12) return { anchor, link, title };
  }

  return fallback;
}

function buildItemsFromHtml(html, finalUrl) {
  const root = parse(html);
  const items = [];
  const seen = new Set();
  const liNodes = root.querySelectorAll("li");

  for (const li of liNodes) {
    const dateText = normalizeText(li.querySelector("time")?.textContent);
    if (!dateText) continue;

    const titleAnchor = findTitleAnchor(li, finalUrl);
    if (!titleAnchor) continue;
    if (seen.has(titleAnchor.link)) continue;

    const summary = normalizeText(li.querySelector("i")?.textContent);
    items.push({
      guid: hashGuid(titleAnchor.link),
      title: titleAnchor.title,
      link: titleAnchor.link,
      pubDate: parseDate(dateText) ?? new Date(),
      summary: summary || undefined,
    });
    seen.add(titleAnchor.link);
  }

  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const items = buildItemsFromHtml(html, finalUrl);
  if (items.length > 0) return items;

  const text = normalizeText(parse(html).textContent).toLowerCase();
  if (text.includes("just a moment") || text.includes("checking your browser")) {
    throw new Error(`[${SITE_ID}] 命中站点风控验证页，当前会话无法稳定抓取`);
  }
  throw new Error(`[${SITE_ID}] 未解析到 Embodied AI 条目，页面结构可能已变化`);
}

export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?opendrivelab\.com\/EmbodiedAI\/?(\?.*)?$/i,
  fetchItems,
};
