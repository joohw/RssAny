import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

const APPEN_ORIGIN = "https://www.appen.com";
const IGNORED_TEXTS = new Set([
  "learn more",
  "view all",
  "browse catalog",
  "blog",
  "case studies",
  "white papers, reports and ebooks",
  "white papers, reports and ebooks",
]);

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function resolveHttpUrl(href, baseUrl) {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function getResourceType(pathname) {
  if (/^\/blog\/[^/?#]+\/?$/i.test(pathname)) return { label: "Blog", author: "Appen Blog" };
  if (/^\/case-studies\/[^/?#]+\/?$/i.test(pathname)) return { label: "Case Study", author: "Appen Case Studies" };
  if (/^\/whitepapers\/[^/?#]+\/?$/i.test(pathname)) return { label: "Whitepaper", author: "Appen Whitepapers" };
  return null;
}

function dedupeTexts(texts) {
  const out = [];
  const seen = new Set();
  for (const text of texts) {
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function extractLeafTexts(anchor) {
  const nodes = anchor.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,div");
  const leafs = nodes
    .filter((node) => node.querySelector("h1,h2,h3,h4,h5,h6,p,span,div") == null)
    .map((node) => normalizeText(node.textContent))
    .filter(Boolean)
    .filter((text) => !IGNORED_TEXTS.has(text.toLowerCase()));
  return dedupeTexts(leafs);
}

function pickTitle(anchor, leafTexts) {
  const heading = normalizeText(anchor.querySelector("h1,h2,h3,h4,h5,h6")?.textContent);
  if (heading && !IGNORED_TEXTS.has(heading.toLowerCase())) return heading;
  const longEnough = leafTexts.filter((text) => text.length >= 12);
  if (longEnough.length > 0) {
    return longEnough.slice().sort((a, b) => b.length - a.length)[0];
  }
  return leafTexts[0] ?? "";
}

function pickSummary(leafTexts, title) {
  const summaryCandidates = leafTexts
    .filter((text) => text !== title)
    .filter((text) => text.length >= 24);
  if (summaryCandidates.length === 0) return undefined;
  return summaryCandidates.slice().sort((a, b) => b.length - a.length)[0];
}

function parsePagePublishedDate(html) {
  const match = html.match(/Last Published:\s*([^-<]+GMT\+0000)/i);
  if (!match) return undefined;
  const date = new Date(match[1].trim());
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateFromSlug(pathname) {
  const match = pathname.match(/(?:^|[-/])(20\d{2})(?:[-/]|$)/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return undefined;
  return new Date(Date.UTC(year, 0, 1));
}

function upsertItem(itemsByLink, candidate) {
  const previous = itemsByLink.get(candidate.link);
  if (!previous) {
    itemsByLink.set(candidate.link, candidate);
    return;
  }
  const score = (item) => (item.summary ? 2 : 0) + (item.title.length >= 20 ? 1 : 0);
  if (score(candidate) > score(previous)) {
    itemsByLink.set(candidate.link, candidate);
  }
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500 });
  const root = parse(html);
  const baseUrl = finalUrl || sourceId || APPEN_ORIGIN;
  const pagePublishedDate = parsePagePublishedDate(html);
  const fallbackDate = pagePublishedDate ?? new Date();
  const itemsByLink = new Map();

  const anchors = root.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const url = resolveHttpUrl(anchor.getAttribute("href"), baseUrl);
    if (!url) continue;

    const resourceType = getResourceType(url.pathname);
    if (!resourceType) continue;

    const leafTexts = extractLeafTexts(anchor);
    const title = pickTitle(anchor, leafTexts);
    if (!title) continue;

    const summary = pickSummary(leafTexts, title);
    const inferredDate = parseDateFromSlug(url.pathname);
    upsertItem(itemsByLink, {
      guid: hashGuid(url.href),
      title,
      link: url.href,
      pubDate: inferredDate ?? fallbackDate,
      author: resourceType.author,
      summary,
      categories: [resourceType.label],
    });
  }

  const items = Array.from(itemsByLink.values());
  if (items.length === 0) {
    throw new Error("[appen-resources] 未解析到资源条目，页面结构可能已变化");
  }
  return items;
}

export default {
  id: "appen-resources",
  listUrlPattern: /^https?:\/\/(www\.)?appen\.com\/resources\/?(\?.*)?$/i,
  fetchItems,
};
