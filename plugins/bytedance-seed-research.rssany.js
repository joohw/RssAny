// ByteDance Seed 研究页插件：抓取研究论文与动态条目（不含 enrich）

import { createHash } from "node:crypto";


const DEFAULT_ORIGIN = "https://seed.bytedance.com";
const ROUTER_DATA_MARKER = "window._ROUTER_DATA = ";
const RESEARCH_PAGE_KEY = "(locale$)/research/page";


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function toOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}


function detectLocale(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.startsWith("/en/")) return "en";
  } catch {
    // ignore
  }
  return "zh";
}


function pickLocalized(zhValue, enValue, locale) {
  const zh = normalizeText(zhValue);
  const en = normalizeText(enValue);
  if (locale === "zh") return zh || en;
  return en || zh;
}


function parsePublishDate(raw) {
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    const date = new Date(num);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const direct = new Date(String(raw ?? ""));
  if (!Number.isNaN(direct.getTime())) return direct;
  return new Date();
}


function extractBalancedJson(raw, marker) {
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return undefined;

  const start = raw.indexOf("{", markerIndex + marker.length);
  if (start < 0) return undefined;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < raw.length; i += 1) {
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
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return undefined;
}


function parseRouterData(html) {
  const raw = extractBalancedJson(html, ROUTER_DATA_MARKER);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}


function parseModernData(html) {
  const m = html.match(/<script[^>]*id="__MODERN_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}


function getResearchPayload(html) {
  const routerData = parseRouterData(html);
  const fromRouter = routerData?.loaderData?.[RESEARCH_PAGE_KEY];
  if (fromRouter && typeof fromRouter === "object") return fromRouter;

  const modernData = parseModernData(html);
  if (modernData?.data && typeof modernData.data === "object") return modernData.data;
  if (modernData && typeof modernData === "object") return modernData;

  return undefined;
}


function extractCategories(meta, locale) {
  const areas = Array.isArray(meta?.ResearchArea) ? meta.ResearchArea : [];
  const categories = [];
  const seen = new Set();

  for (const area of areas) {
    const name = locale === "zh"
      ? normalizeText(area?.ResearchAreaNameZh ?? area?.ResearchAreaName)
      : normalizeText(area?.ResearchAreaName ?? area?.ResearchAreaNameZh);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    categories.push(name);
  }

  return categories.length > 0 ? categories : undefined;
}


function buildItem(entry, kind, locale, origin) {
  const meta = entry?.ArticleMeta ?? {};
  const zh = entry?.ArticleSubContentZh ?? {};
  const en = entry?.ArticleSubContentEn ?? {};

  const title = pickLocalized(zh.Title ?? zh.ShortTitle, en.Title ?? en.ShortTitle, locale);
  if (!title) return null;

  const abstract = pickLocalized(zh.Abstract, en.Abstract, locale);
  const titleKey = pickLocalized(zh.TitleKey, en.TitleKey, locale);
  const articleId = String(meta.ArticleID ?? meta.ID ?? "").trim();

  let link;
  if (titleKey) {
    const path = kind === "public_papers"
      ? `/${locale}/public_papers/${encodeURIComponent(titleKey)}`
      : `/${locale}/blog/${encodeURIComponent(titleKey)}`;
    link = new URL(path, origin).href;
  } else {
    const fallback = articleId || title;
    link = `${origin}/${locale}/research#${encodeURIComponent(fallback)}`;
  }

  const author = normalizeText(meta.Author);
  const categories = extractCategories(meta, locale);
  const pubDate = parsePublishDate(meta.PublishDate);

  return {
    guid: hashGuid(`${kind}|${articleId || titleKey || title}`),
    title,
    link,
    pubDate,
    author: author || undefined,
    summary: abstract || undefined,
    categories,
  };
}


function dedupeAndSort(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.link || item.guid;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  out.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return out;
}


async function fetchItems(sourceId, ctx) {
  // 该站点条目核心数据在脚本 JSON 中，需关闭 purify 才能读取。
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 4500, purify: false });
  const pageUrl = finalUrl || sourceId;
  const locale = detectLocale(pageUrl);
  const origin = toOrigin(pageUrl);
  const payload = getResearchPayload(html);

  if (!payload) {
    throw new Error("[bytedance-seed-research] 未找到研究页数据块（window._ROUTER_DATA / __MODERN_DATA__）");
  }

  const articleList = Array.isArray(payload.article_list) ? payload.article_list : [];
  const feedList = Array.isArray(payload.feedList) ? payload.feedList : [];

  const parsed = [];
  for (const entry of articleList) {
    const item = buildItem(entry, "public_papers", locale, origin);
    if (item) parsed.push(item);
  }
  for (const entry of feedList) {
    const item = buildItem(entry, "blog", locale, origin);
    if (item) parsed.push(item);
  }

  const items = dedupeAndSort(parsed);
  if (items.length === 0) {
    throw new Error("[bytedance-seed-research] 研究页数据存在，但未解析到有效条目");
  }

  return items;
}


export default {
  id: "bytedance-seed-research",
  listUrlPattern: /^https?:\/\/seed\.bytedance\.com\/(zh|en)\/research(?:\/)?(\?.*)?$/i,
  fetchItems,
};
