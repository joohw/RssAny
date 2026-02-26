import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const SITE_ID = "pjlab-adg-publications";


function normalizeText(text) {
  return (text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function parseYear(raw) {
  const text = normalizeText(raw);
  const match = text.match(/\b(19|20)\d{2}\b/);
  if (!match) return undefined;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : undefined;
}


function toAbsoluteLink(rawHref, baseUrl) {
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


function pickBestLink(detailNode, pageUrl, entryId) {
  const linkNodes = detailNode.querySelectorAll(".links a[href], a[href]");
  const candidates = [];
  for (const node of linkNodes) {
    const link = toAbsoluteLink(node.getAttribute("href"), pageUrl);
    if (!link) continue;
    const label = normalizeText(node.textContent).toLowerCase();
    candidates.push({ link, label });
  }

  const preferHtml = candidates.find((x) => x.label === "html" || x.label === "arxiv" || x.label === "doi");
  if (preferHtml) return preferHtml.link;

  const preferPdf = candidates.find((x) => x.label === "pdf");
  if (preferPdf) return preferPdf.link;

  if (candidates.length > 0) return candidates[0].link;
  if (entryId) return `${pageUrl}#${encodeURIComponent(entryId)}`;
  return pageUrl;
}


function buildSummary(author, periodical) {
  const chunks = [author, periodical].map((x) => normalizeText(x)).filter(Boolean);
  if (chunks.length === 0) return undefined;
  return chunks.join(" | ");
}


function elementChildren(node) {
  return node.childNodes.filter((child) => child.tagName != null);
}


function directDivChildren(node) {
  return elementChildren(node).filter((child) => child.tagName?.toLowerCase() === "div");
}


function extractTitle(detailNode) {
  const fromClass = normalizeText(detailNode.querySelector(".title")?.textContent);
  if (fromClass) return fromClass;

  const divs = directDivChildren(detailNode);
  for (const div of divs) {
    if (div.querySelector("em")) continue;
    if (div.querySelector("a[href]")) continue;
    const text = normalizeText(div.textContent);
    if (!text) continue;
    if (text.length < 8) continue;
    return text;
  }
  return "";
}


function extractAuthor(detailNode, title) {
  const fromClass = normalizeText(detailNode.querySelector(".author")?.textContent);
  if (fromClass) return fromClass;

  const divs = directDivChildren(detailNode);
  const textDivs = divs
    .filter((div) => !div.querySelector("em"))
    .filter((div) => !div.querySelector("a[href]"))
    .map((div) => normalizeText(div.textContent))
    .filter(Boolean);
  const candidate = textDivs.find((text) => text !== title);
  return candidate || undefined;
}


function extractPeriodical(detailNode) {
  const fromClass = normalizeText(
    (detailNode.querySelector(".periodical em") ?? detailNode.querySelector(".periodical"))?.textContent
  );
  if (fromClass) return fromClass;

  const divs = directDivChildren(detailNode);
  for (const div of divs) {
    const emText = normalizeText(div.querySelector("em")?.textContent);
    if (emText) return emText;
  }
  return "";
}


function parseOneEntry(liNode, currentYear, pageUrl) {
  const detailNode = liNode.querySelector("div[id]") ?? liNode.querySelector("div");
  if (!detailNode) return null;

  const entryId = normalizeText(detailNode.getAttribute("id"));
  const title = extractTitle(detailNode);
  if (!title) return null;

  const author = extractAuthor(detailNode, title);
  const periodical = extractPeriodical(detailNode);
  const fallbackYear = parseYear(`${periodical} ${detailNode.textContent}`);
  const finalYear = currentYear ?? fallbackYear;
  const pubDate = finalYear != null ? new Date(Date.UTC(finalYear, 0, 1, 0, 0, 0)) : new Date();
  const badge = normalizeText((liNode.querySelector(".abbr .badge") ?? liNode.querySelector("abbr"))?.textContent) || undefined;
  const link = pickBestLink(detailNode, pageUrl, entryId);
  const guidSeed = entryId || link || `${title}|${author ?? ""}|${finalYear ?? ""}`;

  return {
    guid: hashGuid(guidSeed),
    title,
    link,
    pubDate,
    author,
    summary: buildSummary(author, periodical),
    categories: badge ? [badge] : undefined,
    sourceId: SITE_ID,
  };
}


function parseItems(html, finalUrl) {
  const root = parse(html);
  const container = root.querySelector("article") ?? root;
  const items = [];
  const seenGuid = new Set();
  let currentYear;

  const stream = container.querySelectorAll("h2, li");
  for (const node of stream) {
    const tag = node.tagName?.toLowerCase();
    if (tag === "h2") {
      const year = parseYear(node.textContent);
      if (year != null) currentYear = year;
      continue;
    }
    if (tag !== "li") continue;

    const item = parseOneEntry(node, currentYear, finalUrl);
    if (!item) continue;
    if (seenGuid.has(item.guid)) continue;
    seenGuid.add(item.guid);
    items.push(item);
  }
  return items;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const pageUrl = finalUrl || sourceId;
  const items = parseItems(html, pageUrl);
  if (items.length === 0) {
    throw new Error("[pjlab-adg-publications] 未解析到论文条目，页面结构可能已变化");
  }
  return items;
}


export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/pjlab-adg\.github\.io\/publications\/?(\?.*)?$/i,
  fetchItems,
};
