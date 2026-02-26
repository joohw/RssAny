// MIT CSAIL Research plugin: warm up via homepage, then parse /research list items.

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const SITE_ID = "mit-csail-research";
const CSAIL_HOME_URL = "https://www.csail.mit.edu/";
const CSAIL_RESEARCH_PATH = "/research";
const SUMMARY_SELECTOR = "div, p, span, h2, h3, h4, a";
const BLOCKED_HINTS = [
  "http error 403",
  "request to access",
  "access denied",
  "request denied",
  "body class=\"neterror\"",
  "\u60a8\u672a\u83b7\u6388\u6743\uff0c\u65e0\u6cd5\u67e5\u770b\u6b64\u7f51\u9875\u3002",
  "\u8bbf\u95ee <span>www.csail.mit.edu</span> \u7684\u8bf7\u6c42\u906d\u5230\u62d2\u7edd",
];


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


function normalizeCategoryToken(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9]+/g, "");
}


function matchesRequestedCategory(cardCategory, queryCategory) {
  const wanted = normalizeCategoryToken(queryCategory);
  if (!wanted) return true;
  const card = normalizeCategoryToken(cardCategory);
  if (!card) return false;

  if (wanted.includes("group")) return card.includes("group");
  if (wanted.includes("center")) return card.includes("center");
  if (wanted.includes("community")) return card.includes("community");
  return card.includes(wanted);
}


function looksLikeBlockedPage(status, html) {
  if (status >= 400) return true;
  const body = (html ?? "").toLowerCase();
  return BLOCKED_HINTS.some((hint) => body.includes(hint.toLowerCase()));
}


function resolveResearchUrlFromHome(homeHtml, homeUrl) {
  const root = parse(homeHtml);
  const anchors = root.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const text = normalizeText(anchor.textContent).toLowerCase();
    if (!text || !text.includes("research")) continue;
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), homeUrl);
    if (!link) continue;
    try {
      const url = new URL(link);
      if (!/(^|\.)csail\.mit\.edu$/i.test(url.hostname)) continue;
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (pathname !== CSAIL_RESEARCH_PATH) continue;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      // ignore malformed link
    }
  }
  return new URL(CSAIL_RESEARCH_PATH, homeUrl).href;
}


function getLeafTexts(node) {
  return node
    .querySelectorAll(SUMMARY_SELECTOR)
    .filter((el) => el.querySelector(SUMMARY_SELECTOR) == null)
    .map((el) => normalizeText(el.textContent))
    .filter(Boolean);
}


function extractSummary(card, title, category) {
  const texts = getLeafTexts(card)
    .filter((t) => t !== title && t !== category)
    .filter((t) => !/^lead$/i.test(t))
    .filter((t) => !/^\+\s*\d+$/i.test(t))
    .filter((t) => !/^\.{3}more$/i.test(t));

  return texts.find((t) => t.length >= 20 && t.length <= 600);
}


function extractAuthor(card) {
  const names = card.querySelectorAll("app-lead-bar a[href]")
    .map((a) => normalizeText(a.textContent))
    .filter(Boolean)
    .filter((name) => name !== "...more");
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique.join(", ") : undefined;
}


function parseCardItem(card, baseUrl, requestedCategory) {
  const bookmark =
    card.querySelector('a[rel="bookmark"][href]') ??
    card.querySelector('a[href*="/research/"]');
  if (!bookmark) return null;

  const title = normalizeText(bookmark.querySelector("h2")?.textContent || bookmark.textContent);
  if (!title) return null;

  const link = toAbsoluteHttpUrl(bookmark.getAttribute("href"), baseUrl);
  if (!link) return null;

  const category = normalizeText(card.querySelector("h4")?.textContent);
  if (!matchesRequestedCategory(category, requestedCategory)) return null;

  const summary = extractSummary(card, title, category);
  const author = extractAuthor(card);

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: new Date(),
    author,
    summary: summary || undefined,
    categories: category ? [category] : undefined,
  };
}


function parseItems(html, finalUrl, requestedCategory) {
  const root = parse(html);
  const cards = root.querySelectorAll("article");
  const seen = new Set();
  const items = [];

  for (const card of cards) {
    const item = parseCardItem(card, finalUrl, requestedCategory);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  return items;
}


async function fetchItems(sourceId, ctx) {
  const sourceUrl = new URL(sourceId);
  const requestedCategory = sourceUrl.searchParams.get("category") ?? "";

  const home = await ctx.fetchHtml(CSAIL_HOME_URL, { waitMs: 3000 });
  if (looksLikeBlockedPage(home.status, home.html)) {
    throw new Error(`[${SITE_ID}] \u8bbf\u95ee CSAIL \u9996\u9875\u88ab\u62d2\u7edd\uff08HTTP ${home.status}\uff09`);
  }

  const researchUrl = resolveResearchUrlFromHome(home.html, home.finalUrl || CSAIL_HOME_URL);
  const research = await ctx.fetchHtml(researchUrl, { waitMs: 4500 });
  if (looksLikeBlockedPage(research.status, research.html)) {
    throw new Error(`[${SITE_ID}] \u8bbf\u95ee research \u5217\u8868\u88ab\u62d2\u7edd\uff08HTTP ${research.status}\uff09`);
  }

  let items = parseItems(research.html, research.finalUrl || researchUrl, requestedCategory);
  if (items.length === 0) {
    const retry = await ctx.fetchHtml(researchUrl, { waitMs: 6500 });
    if (looksLikeBlockedPage(retry.status, retry.html)) {
      throw new Error(`[${SITE_ID}] \u8bbf\u95ee research \u5217\u8868\u88ab\u62d2\u7edd\uff08HTTP ${retry.status}\uff09`);
    }
    items = parseItems(retry.html, retry.finalUrl || researchUrl, requestedCategory);
  }
  if (items.length === 0) {
    const withCategory = requestedCategory ? ` (category=${requestedCategory})` : "";
    throw new Error(`[${SITE_ID}] \u672a\u89e3\u6790\u5230\u7814\u7a76\u6761\u76ee${withCategory}\uff0c\u9875\u9762\u7ed3\u6784\u53ef\u80fd\u5df2\u53d8\u5316`);
  }
  return items;
}


export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?csail\.mit\.edu\/research(?:\?.*)?$/i,
  fetchItems,
};
