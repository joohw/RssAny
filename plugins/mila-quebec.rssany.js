// Mila (Quebec AI Institute) 新闻列表插件：支持首页 /en 与新闻页 /en/news

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const MILA_ORIGIN = "https://mila.quebec";
const NEWS_PATH_RE = /^\/en\/news\/[^/?#]+\/?$/i;
const NOISE_TITLE_RE = /^(read the (story|news)|see more news)$/i;
const MONTH_TO_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};


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


function isNewsArticleUrl(url) {
  try {
    return NEWS_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}


function extractDateFromText(text) {
  const normalized = normalizeText(text).replace(/,/g, " ");
  if (!normalized) return undefined;

  const m = normalized.match(
    /(?:^|\b)(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})(?:\b|$)/i
  );
  if (!m) return undefined;

  const day = Number(m[1]);
  const monthIdx = MONTH_TO_INDEX[m[2].slice(0, 3).toLowerCase()];
  const year = Number(m[3]);
  if (monthIdx == null || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;

  const d = new Date(Date.UTC(year, monthIdx, day, 12, 0, 0));
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}


function extractDateNearNode(node) {
  const timeDatetime = node.querySelector?.("time[datetime]")?.getAttribute("datetime");
  if (timeDatetime) {
    const d = new Date(timeDatetime);
    if (!Number.isNaN(d.getTime())) return d;
  }

  let current = node;
  for (let i = 0; i < 6 && current; i += 1) {
    const parsed = extractDateFromText(current.textContent);
    if (parsed) return parsed;
    current = current.parentNode ?? null;
  }
  return undefined;
}


function scoreTitle(text) {
  const normalized = normalizeText(text);
  if (!normalized) return 0;
  if (NOISE_TITLE_RE.test(normalized.toLowerCase())) return 1;
  if (normalized.length < 5) return 2;
  return 10 + Math.min(normalized.length, 120);
}


function titleFromUrl(link) {
  try {
    const slug = decodeURIComponent(new URL(link).pathname.split("/").filter(Boolean).pop() ?? "");
    return normalizeText(slug.replace(/[-_]+/g, " "));
  } catch {
    return "Mila News";
  }
}


function chooseSummary(node, title) {
  let current = node;
  for (let i = 0; i < 4 && current; i += 1) {
    const candidates = current
      .querySelectorAll?.("p")
      ?.map((p) => normalizeText(p.textContent))
      ?.filter(Boolean) ?? [];
    for (const text of candidates) {
      const lower = text.toLowerCase();
      if (lower === title.toLowerCase()) continue;
      if (NOISE_TITLE_RE.test(lower)) continue;
      return text;
    }
    current = current.parentNode ?? null;
  }
  return undefined;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4000 });
  const root = parse(html);
  const pageUrl = finalUrl || sourceId || MILA_ORIGIN;
  const byLink = new Map();

  for (const anchor of root.querySelectorAll("a[href]")) {
    const link = toAbsoluteHttpUrl(anchor.getAttribute("href"), pageUrl);
    if (!link || !isNewsArticleUrl(link)) continue;

    const rawTitle = normalizeText(anchor.textContent);
    const titleScore = scoreTitle(rawTitle);
    const pubDate = extractDateNearNode(anchor);
    const summary = chooseSummary(anchor, rawTitle || "");

    const existing = byLink.get(link) ?? {
      link,
      title: "",
      titleScore: 0,
      pubDate: undefined,
      summary: undefined,
    };

    if (titleScore > existing.titleScore) {
      existing.title = rawTitle;
      existing.titleScore = titleScore;
    }
    if (!existing.pubDate && pubDate) existing.pubDate = pubDate;
    if (!existing.summary && summary) existing.summary = summary;

    byLink.set(link, existing);
  }

  const items = Array.from(byLink.values()).map((entry) => {
    const title = entry.title && !NOISE_TITLE_RE.test(entry.title.toLowerCase())
      ? entry.title
      : titleFromUrl(entry.link);
    const summary = entry.summary && normalizeText(entry.summary) !== normalizeText(title)
      ? entry.summary
      : undefined;
    return {
      guid: hashGuid(entry.link),
      title,
      link: entry.link,
      pubDate: entry.pubDate ?? new Date(),
      author: "Mila",
      summary,
    };
  });

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  if (items.length === 0) {
    throw new Error("[mila-quebec] 未解析到新闻条目，页面结构可能已变化");
  }

  return items;
}


export default {
  id: "mila-quebec",
  listUrlPattern: /^https?:\/\/(www\.)?mila\.quebec\/en(?:\/news)?(?:\/)?(?:\?.*)?$/i,
  fetchItems,
};
