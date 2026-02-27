import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

const ARTICLE_PATH_RE = /^\/([0-9a-f]{24})\.html$/i;
const DATE_RE = /(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toAbsoluteUrl(rawHref, pageUrl) {
  if (!rawHref) return null;
  try {
    const url = new URL(rawHref, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parsePubDate(rawText) {
  const text = normalizeText(rawText);
  const match = text.match(DATE_RE);
  if (!match) return new Date();
  const [, y, mm, dd, hh, min, sec] = match;
  const iso = `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${(hh ?? "00").padStart(2, "0")}:${(min ?? "00").padStart(2, "0")}:${(sec ?? "00").padStart(2, "0")}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function findNearbyDateText(anchor) {
  let current = anchor;
  for (let i = 0; i < 6 && current; i += 1) {
    const text = normalizeText(current.textContent);
    if (DATE_RE.test(text)) return text;
    current = current.parentNode ?? null;
  }
  return "";
}

function isNoiseTitle(title) {
  const text = normalizeText(title);
  if (!text) return true;
  if (text === "暂无图片" || text === "登录" || text === "加入社区") return true;
  return false;
}

function pickBestTitle(candidates) {
  const normalized = [...new Set(candidates.map((x) => normalizeText(x)).filter(Boolean))];
  const preferred = normalized
    .filter((text) => !isNoiseTitle(text))
    .filter((text) => text.length >= 6 && text.length <= 80)
    .sort((a, b) => a.length - b.length);
  if (preferred.length > 0) return preferred[0];

  const fallback = normalized
    .filter((text) => !isNoiseTitle(text))
    .filter((text) => text.length >= 6)
    .sort((a, b) => a.length - b.length);
  if (fallback.length > 0) return fallback[0];

  return "";
}

function parseDomItems(html, finalUrl) {
  const root = parse(html);
  const grouped = new Map();
  const items = [];
  const anchors = root.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const href = toAbsoluteUrl(anchor.getAttribute("href"), finalUrl);
    if (!href) continue;
    const url = new URL(href);
    if (url.hostname !== "baaidata.csdn.net") continue;
    if (!ARTICLE_PATH_RE.test(url.pathname)) continue;

    const canonicalLink = `${url.origin}${url.pathname}`;
    const group = grouped.get(canonicalLink) ?? { anchors: [], titles: [] };
    group.anchors.push(anchor);
    group.titles.push(anchor.textContent ?? "");
    grouped.set(canonicalLink, group);
  }

  for (const [canonicalLink, group] of grouped) {
    const title = pickBestTitle(group.titles);
    if (!title) continue;

    let dateText = "";
    for (const anchor of group.anchors) {
      const found = findNearbyDateText(anchor);
      if (found) {
        dateText = found;
        break;
      }
    }

    items.push({
      guid: hashGuid(canonicalLink),
      title,
      link: canonicalLink,
      pubDate: parsePubDate(dateText),
      author: "智源数据社区",
      sourceId: "baaidata-csdn",
    });
  }

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return items;
}

function findJsonObjectEnd(raw, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractInitialState(html) {
  const marker = "window.__INITIAL_STATE__=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  const objStart = html.indexOf("{", markerIndex + marker.length);
  if (objStart < 0) return null;

  const objEnd = findJsonObjectEnd(html, objStart);
  if (objEnd < 0) return null;

  const jsonRaw = html.slice(objStart, objEnd + 1);
  try {
    const parsed = JSON.parse(jsonRaw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toItemFromState(raw, finalUrl) {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw.content && typeof raw.content === "object" ? raw.content : raw;

  const id = normalizeText(entry.id ?? "");
  const title = normalizeText(entry.name ?? entry.title ?? "");
  if (!title) return null;

  const rawLink = normalizeText(raw.contentUrl ?? entry.contentUrl ?? entry.pagePath ?? "");
  const fallbackLink = id ? `/${id}.html` : "";
  const link = toAbsoluteUrl(rawLink || fallbackLink, finalUrl);
  if (!link) return null;

  const canonical = new URL(link);
  const canonicalLink = `${canonical.origin}${canonical.pathname}`;

  const summary = normalizeText(entry.desc ?? raw.desc ?? "");
  const author = normalizeText(raw.nickname ?? raw.username ?? raw.user?.nickname ?? "");
  const pubDate = parsePubDate(entry.createdTime ?? raw.createdTime ?? "");

  return {
    guid: hashGuid(canonicalLink),
    title,
    link: canonicalLink,
    pubDate,
    author: author || "智源数据社区",
    summary: summary || undefined,
    sourceId: "baaidata-csdn",
  };
}

function parseStateItems(html, finalUrl) {
  const state = extractInitialState(html);
  if (!state) return [];

  const latest = Array.isArray(state?.articleContent?.latest) ? state.articleContent.latest : [];
  const hot = Array.isArray(state?.articleContent?.hot) ? state.articleContent.hot : [];
  const headlines = Array.isArray(state?.headlines) ? state.headlines : [];

  const merged = [...latest, ...hot, ...headlines];
  const seen = new Set();
  const items = [];

  for (const raw of merged) {
    const item = toItemFromState(raw, finalUrl);
    if (!item) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return items;
}

async function fetchItems(sourceId, ctx) {
  const rendered = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const fromDom = parseDomItems(rendered.html, rendered.finalUrl);
  if (fromDom.length > 0) return fromDom;

  const raw = await ctx.fetchHtml(sourceId, { waitMs: 3500, purify: false });
  const fromState = parseStateItems(raw.html, raw.finalUrl);
  if (fromState.length > 0) return fromState;

  throw new Error("[baaidata-csdn] 未解析到条目，页面结构可能已变化");
}

export default {
  id: "baaidata-csdn",
  listUrlPattern: /^https?:\/\/baaidata\.csdn\.net\/?(?:\?.*)?$/i,
  fetchItems,
};
