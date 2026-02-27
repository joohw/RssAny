// Hacker News newest 插件：解析 newest 列表页为 FeedItem（仅列表，不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const HN_ORIGIN = "https://news.ycombinator.com";


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function toAbsoluteUrl(rawHref, baseUrl) {
  const href = normalizeText(rawHref);
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    const url = new URL(href, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}


function parsePubDate(rawTitle) {
  const text = normalizeText(rawTitle);
  if (!text) return new Date();

  const parts = text.split(/\s+/);
  const epochPart = parts[1];
  if (epochPart && /^\d{10}$/.test(epochPart)) {
    return new Date(Number(epochPart) * 1000);
  }

  const date = new Date(parts[0]);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}


function parseTitleLink(row, pageUrl, itemId) {
  const anchors = row.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    if (!title) continue;
    const href = anchor.getAttribute("href") ?? "";
    if (/^vote\?/i.test(href) || /^from\?site=/i.test(href)) continue;
    const link = toAbsoluteUrl(href, pageUrl);
    if (!link) continue;
    return { title, link };
  }

  return {
    title: `HN Item ${itemId}`,
    link: new URL(`/item?id=${itemId}`, pageUrl).href,
  };
}


function parseMeta(root, row, itemId) {
  const itemHref = `item?id=${itemId}`;
  const ageAnchors = root.querySelectorAll(`a[href="${itemHref}"]`);

  let ageSpan = null;
  for (const anchor of ageAnchors) {
    const parent = anchor.parentNode;
    if (!parent || parent.tagName?.toLowerCase() !== "span") continue;
    const titleAttr = parent.getAttribute?.("title");
    if (!titleAttr) continue;
    ageSpan = parent;
    break;
  }

  const pubDate = parsePubDate(ageSpan?.getAttribute?.("title"));
  const metaContainer = ageSpan?.parentNode ?? null;
  const author = normalizeText(metaContainer?.querySelector?.('a[href^="user?id="]')?.textContent) || undefined;
  const scoreText = normalizeText(metaContainer?.querySelector?.(`span[id="score_${itemId}"]`)?.textContent);
  const commentLinks = metaContainer?.querySelectorAll?.(`a[href="${itemHref}"]`) ?? [];
  const commentText = normalizeText(commentLinks[commentLinks.length - 1]?.textContent);
  const siteText = normalizeText(row.querySelector?.('a[href^="from?site="]')?.textContent);

  const summaryParts = [siteText, scoreText, commentText].filter(Boolean);
  const summary = summaryParts.length > 0 ? summaryParts.join(" | ") : undefined;

  return { pubDate, author, summary };
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3000 });
  const root = parse(html);
  const pageUrl = new URL(finalUrl || sourceId, HN_ORIGIN);
  const items = [];
  const seen = new Set();

  for (const row of root.querySelectorAll("tr[id]")) {
    const itemId = normalizeText(row.getAttribute("id"));
    if (!/^\d+$/.test(itemId) || seen.has(itemId)) continue;

    const { title, link } = parseTitleLink(row, pageUrl, itemId);
    const { pubDate, author, summary } = parseMeta(root, row, itemId);
    seen.add(itemId);

    items.push({
      guid: createHash("sha256").update(`hn:${itemId}`).digest("hex"),
      title: title || "(无标题)",
      link,
      pubDate,
      author,
      summary,
    });
  }

  if (items.length === 0) {
    throw new Error("[hacker-news-newest] 未解析到条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "hacker-news-newest",
  listUrlPattern: /^https?:\/\/news\.ycombinator\.com\/newest\/?(\?.*)?$/i,
  refreshInterval: "10min",
  fetchItems,
};
