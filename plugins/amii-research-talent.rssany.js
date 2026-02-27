// Amii Research & Talent 插件：抓取人物卡片列表（不做正文 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

const PEOPLE_PATH_RE = /^\/people\/[^/?#]+\/?$/i;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function resolvePeopleLink(rawHref, pageUrl) {
  if (!rawHref) return null;
  try {
    const url = new URL(rawHref, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!PEOPLE_PATH_RE.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function extractPeopleItems(root, pageUrl) {
  const anchors = root.querySelectorAll('a[href*="/people/"]');
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const link = resolvePeopleLink(anchor.getAttribute("href"), pageUrl);
    if (!link || seen.has(link)) continue;

    const title = normalizeText(anchor.querySelector("h3")?.textContent);
    if (!title) continue;

    const summary = normalizeText(anchor.querySelector("p")?.textContent);
    seen.add(link);
    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate: new Date(),
      author: "Amii",
      summary: summary || undefined,
    });
  }

  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3000 });
  const root = parse(html);
  const pageUrl = new URL(finalUrl);

  const items = extractPeopleItems(root, pageUrl);
  if (items.length === 0) {
    throw new Error("[amii-research-talent] 未解析到人物条目，页面结构可能已变化");
  }

  return items;
}

export default {
  id: "amii-research-talent",
  listUrlPattern: /^https?:\/\/(www\.)?amii\.ca\/research-talent\/?(\?.*)?$/i,
  fetchItems,
};
