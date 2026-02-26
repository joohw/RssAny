import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

const UCI_ORIGIN = "https://archive.ics.uci.edu";

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function resolveDatasetLink(rawHref, baseUrl) {
  const href = normalizeText(rawHref);
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (url.hostname !== "archive.ics.uci.edu") return null;
    if (!/^\/dataset\/\d+\/[^/?#]+$/i.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function pickSummaryNearNode(node) {
  let cur = node;
  for (let i = 0; i < 6 && cur; i += 1) {
    const p = cur.querySelector?.("p");
    const summary = normalizeText(p?.textContent);
    if (summary) return summary;
    cur = cur.parentNode ?? null;
  }
  return "";
}

function buildItem({ title, link, summary, index }) {
  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: new Date(Date.now() - index * 1000),
    summary: summary || undefined,
    sourceId: "uci-ml-repository",
  };
}

function parseFromHeadingAnchors(root, baseUrl) {
  const anchors = root.querySelectorAll('h2 a[href^="/dataset/"]');
  const items = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const link = resolveDatasetLink(anchor.getAttribute("href"), baseUrl);
    if (!link || seen.has(link)) continue;

    const title = normalizeText(anchor.textContent);
    if (!title) continue;

    const summary = pickSummaryNearNode(anchor.parentNode ?? anchor);
    seen.add(link);
    items.push(buildItem({ title, link, summary, index: items.length }));
  }
  return items;
}

function parseFromGenericAnchors(root, baseUrl) {
  const anchors = root.querySelectorAll('a[href^="/dataset/"]');
  const items = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const link = resolveDatasetLink(anchor.getAttribute("href"), baseUrl);
    if (!link || seen.has(link)) continue;

    const titleFromText = normalizeText(anchor.textContent);
    const titleFromImage = normalizeText(anchor.querySelector("img")?.getAttribute("alt"));
    const title = titleFromText || titleFromImage;
    if (!title) continue;

    const summary = pickSummaryNearNode(anchor.parentNode ?? anchor);
    seen.add(link);
    items.push(buildItem({ title, link, summary, index: items.length }));
  }
  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4000 });
  const baseUrl = finalUrl || sourceId || UCI_ORIGIN;
  const root = parse(html);

  const byHeading = parseFromHeadingAnchors(root, baseUrl);
  if (byHeading.length > 0) return byHeading;

  const fallback = parseFromGenericAnchors(root, baseUrl);
  if (fallback.length > 0) return fallback;

  throw new Error("[uci-ml-repository] 未解析到数据集条目，页面结构可能已变化");
}

export default {
  id: "uci-ml-repository",
  listUrlPattern: /^https?:\/\/archive\.ics\.uci\.edu(?:\/(?:datasets\/?)?)?(?:\?.*)?$/i,
  fetchItems,
};
