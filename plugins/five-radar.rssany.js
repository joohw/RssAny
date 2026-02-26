import { createHash } from "node:crypto";


const SITE_ID = "five-radar";
const DEFAULT_PAGE_SIZE = 30;
const THEME_PAGE_SIZE = 20;
const THEME_PAGE_SIZE_CANDIDATES = [20, 10, 5];
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_LIMIT = 10;
const THEME_PAGE_RE = /^\/([A-Za-z0-9_-]+)\/news\/?$/;
const ALL_TAB_KEYS = [
  "dataresourceregistration",
  "dataresources",
  "publicdatadevelop",
  "dataproducts",
  "dplists",
  "dataproperty",
  "dataintellectualproperty",
  "internationaldatamarket",
  "dataassets",
  "dataopensource",
];
const KNOWN_TITLE_EN = new Set([
  "classicproject",
  "dataassets",
  "dataassetvalue",
  "dataintellectualproperty",
  "dataopensource",
  "dataproducts",
  "dataproperty",
  "dataresourceregistration",
  "dataresources",
  "dplists",
  "internationaldatamarket",
  "latestbusiness",
  "latesttech",
  "latesttrend",
  "publicdatadevelop",
  "salon",
  "techforum",
]);
const TAB_ALIASES = new Map([
  ["公共数据", "dataresourceregistration"],
  ["公共数据资源登记", "dataresourceregistration"],
  ["资源入表", "dataresources"],
  ["数据资源入表", "dataresources"],
  ["授权运营", "publicdatadevelop"],
  ["公共数据授权运营", "publicdatadevelop"],
  ["产品交易", "dataproducts"],
  ["数据产品交易", "dataproducts"],
  ["产品上架", "dplists"],
  ["数据产品上架", "dplists"],
  ["推荐", "recommend"],
  ["产权登记", "dataproperty"],
  ["数据产权登记", "dataproperty"],
  ["知识产权", "dataintellectualproperty"],
  ["数据知识产权登记", "dataintellectualproperty"],
  ["商业市场", "internationaldatamarket"],
  ["商业数据市场", "internationaldatamarket"],
  ["资产融资", "dataassets"],
  ["数据资产融资", "dataassets"],
  ["开源市场", "dataopensource"],
  ["开源数据市场", "dataopensource"],
  ["全部", "all"],
  ["所有目录", "all"],
  ["all", "all"],
  ["alltabs", "all"],
  ["all-tabs", "all"],
  ["最新", "latest"],
  ["latest", "latest"],
  ["new", "latest"],
]);


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function parsePublishedAt(input) {
  const text = normalizeText(input);
  if (!text) return new Date();

  const m = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (m) {
    const [, y, mm, dd, hh = "0", mi = "0", ss = "0"] = m;
    const iso =
      `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T` +
      `${hh.padStart(2, "0")}:${mi.padStart(2, "0")}:${ss.padStart(2, "0")}+08:00`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}


function normalizeThemeToken(input) {
  return normalizeText(input).toLowerCase();
}


function isChineseToken(input) {
  return /[\u3400-\u9fff]/.test(input);
}


function decodeUrlToken(input) {
  const text = normalizeText(input);
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}


function resolveMaxPages(sourceUrl) {
  const hashToken = normalizeText(sourceUrl.hash.replace(/^#/, ""));
  const hashParams = new URLSearchParams(hashToken.startsWith("?") ? hashToken : `?${hashToken}`);

  const raw =
    sourceUrl.searchParams.get("pages") ||
    sourceUrl.searchParams.get("maxPages") ||
    hashParams.get("pages") ||
    hashParams.get("maxPages");
  const n = Number.parseInt(normalizeText(raw), 10);
  if (Number.isNaN(n)) return DEFAULT_MAX_PAGES;
  return Math.min(MAX_PAGES_LIMIT, Math.max(1, n));
}


function getThemeTokenFromHash(hash) {
  const raw = decodeUrlToken(hash.replace(/^#/, ""));
  if (!raw) return "";

  const maybeQuery = raw.startsWith("?") ? raw : `?${raw}`;
  const params = new URLSearchParams(maybeQuery);
  const queryToken =
    params.get("theme") ||
    params.get("title_en") ||
    params.get("tab") ||
    params.get("category");
  if (normalizeText(queryToken)) return normalizeText(queryToken);

  const fallbackToken = normalizeText(raw.split("&")[0] ?? "");
  return fallbackToken;
}


function getThemeTokenFromUrl(sourceUrl) {
  const queryToken =
    sourceUrl.searchParams.get("theme") ||
    sourceUrl.searchParams.get("title_en") ||
    sourceUrl.searchParams.get("tab") ||
    sourceUrl.searchParams.get("category");
  if (normalizeText(queryToken)) return normalizeText(queryToken);

  const hashToken = getThemeTokenFromHash(sourceUrl.hash || "");
  if (hashToken) return hashToken;

  const m = sourceUrl.pathname.match(THEME_PAGE_RE);
  return m?.[1] ? normalizeText(m[1]) : "";
}


function resolveThemeOptions(sourceUrl) {
  const tokenFromUrl = getThemeTokenFromUrl(sourceUrl);
  const tokenRaw = decodeUrlToken(tokenFromUrl);
  if (!tokenRaw) {
    return { mode: "all_tabs", label: "全部目录" };
  }

  const token = normalizeThemeToken(tokenRaw);
  const alias = TAB_ALIASES.get(tokenRaw) ?? TAB_ALIASES.get(normalizeText(tokenRaw));
  const resolved = alias ?? token;

  if (resolved === "recommend") {
    return {
      mode: "theme",
      titleEn: "",
      isRecommend: 1,
      label: "推荐",
    };
  }

  if (resolved === "all") {
    return {
      mode: "all_tabs",
      label: "全部目录",
    };
  }

  if (resolved === "latest") {
    return {
      mode: "latest",
      label: "latest",
    };
  }

  if (KNOWN_TITLE_EN.has(resolved)) {
    return {
      mode: "theme",
      titleEn: resolved,
      isRecommend: 0,
      label: tokenRaw,
    };
  }

  if (isChineseToken(tokenRaw)) {
    throw new Error(
      `[${SITE_ID}] 不支持的目录: ${tokenRaw}。` +
      "可用中文目录示例：公共数据、资源入表、授权运营、产品交易、产品上架、推荐、产权登记、知识产权、商业市场、资产融资、开源市场"
    );
  }

  return {
    mode: "theme",
    titleEn: resolved,
    isRecommend: 0,
    label: tokenRaw,
  };
}


function toAbsoluteLink(rawUrl, origin, row) {
  const text = normalizeText(rawUrl);
  if (text) {
    try {
      const url = new URL(text, origin);
      if (/^https?:$/i.test(url.protocol) && !isHomepageLink(url)) return url.href;
    } catch {
      // ignore malformed url from upstream API
    }
  }

  const idText = String(row?.id ?? "").trim();
  if (idText) {
    const detailUrl = new URL("/detail", origin);
    detailUrl.searchParams.set("id", idText);
    return detailUrl.href;
  }
  return null;
}


function isHomepageLink(url) {
  return url.pathname === "/" && !url.search && !url.hash;
}


function mapRowToFeedItem(row, origin) {
  const title = normalizeText(row?.title);
  const link = toAbsoluteLink(row?.url, origin, row);
  if (!title || !link) return null;

  const summary = normalizeText(row?.summary);
  const author = normalizeText(row?.source || row?.author);
  const category = normalizeText(row?.theme?.title);
  const idText = String(row?.id ?? "").trim();

  return {
    guid: idText ? `${SITE_ID}-${idText}` : hashGuid(link),
    title,
    link,
    pubDate: parsePublishedAt(row?.published_at),
    author: author || undefined,
    summary: summary || undefined,
    categories: category ? [category] : undefined,
  };
}


async function fetchNewsRows(origin, pageSize = DEFAULT_PAGE_SIZE) {
  const apiUrl = new URL("/api/news/list", origin);
  apiUrl.searchParams.set("page", "1");
  apiUrl.searchParams.set("page_size", String(pageSize));
  apiUrl.searchParams.set("key", "new");

  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`[${SITE_ID}] 拉取新闻接口失败: HTTP ${res.status}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`[${SITE_ID}] 新闻接口返回非 JSON 数据`);
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows;
}


async function fetchThemeRowsPage(origin, opts, page, pageSize = THEME_PAGE_SIZE) {
  const apiUrl = new URL("/api/themes/news-list", origin);
  apiUrl.searchParams.set("page", String(page));
  apiUrl.searchParams.set("page_size", String(pageSize));
  apiUrl.searchParams.set("title_en", opts.titleEn ?? "");
  apiUrl.searchParams.set("is_recommend", String(opts.isRecommend ?? 0));

  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(
      `[${SITE_ID}] 拉取目录接口失败: HTTP ${res.status} (title_en=${opts.titleEn || "recommend"})`
    );
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`[${SITE_ID}] 目录接口返回非 JSON 数据`);
  }

  if (payload?.status === 422 || payload?.success === false) {
    const message = normalizeText(payload?.error?.message || payload?.message || "unknown error");
    const err = new Error(
      `[${SITE_ID}] 目录接口返回错误 (title_en=${opts.titleEn || "recommend"}): ${message}`
    );
    if (isPageSizeValidationError(message)) err.name = "PageSizeValidationError";
    throw err;
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const currentPage = Number.parseInt(String(payload?.pagination?.current_page ?? page), 10) || page;
  const totalPages = Number.parseInt(String(payload?.pagination?.total_pages ?? currentPage), 10) || currentPage;

  return { rows, currentPage, totalPages };
}


async function fetchThemeRowsPaged(origin, opts, pageSize = THEME_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES) {
  const candidates = dedupeValidPageSizes([pageSize, ...THEME_PAGE_SIZE_CANDIDATES]);
  let lastError;

  for (const candidate of candidates) {
    try {
      return await fetchThemeRowsPagedWithPageSize(origin, opts, candidate, maxPages);
    } catch (err) {
      lastError = err;
      if (!isPageSizeValidationErr(err)) throw err;
    }
  }

  throw lastError ?? new Error(`[${SITE_ID}] 目录抓取失败: 未知错误`);
}


function dedupeValidPageSizes(sizes) {
  const out = [];
  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0) continue;
    if (!out.includes(size)) out.push(size);
  }
  return out.length > 0 ? out : [THEME_PAGE_SIZE];
}


function isPageSizeValidationError(message) {
  const text = normalizeText(message).toLowerCase();
  return text.includes("page_size") && text.includes("validation.max.numeric");
}


function isPageSizeValidationErr(err) {
  return err instanceof Error && err.name === "PageSizeValidationError";
}


async function fetchThemeRowsPagedWithPageSize(
  origin,
  opts,
  pageSize = THEME_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES
) {
  const out = [];
  const limit = Math.min(MAX_PAGES_LIMIT, Math.max(1, maxPages));

  for (let page = 1; page <= limit; page += 1) {
    const { rows, currentPage, totalPages } = await fetchThemeRowsPage(origin, opts, page, pageSize);
    out.push(...rows);
    if (rows.length === 0 || currentPage >= totalPages) break;
  }

  return out;
}


async function fetchAllThemeRows(origin, pageSize = THEME_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES) {
  const settled = await Promise.allSettled(
    ALL_TAB_KEYS.map((titleEn) =>
      fetchThemeRowsPaged(origin, { titleEn, isRecommend: 0, label: titleEn }, pageSize, maxPages)
    )
  );

  const rows = [];
  const failedKeys = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const key = ALL_TAB_KEYS[i];
    if (result.status === "fulfilled") {
      rows.push(...result.value);
    } else {
      failedKeys.push(`${key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }

  if (rows.length === 0) {
    throw new Error(
      `[${SITE_ID}] 全目录抓取失败：` +
      (failedKeys.length > 0 ? failedKeys.join(" | ") : "没有可用数据")
    );
  }
  return rows;
}


async function fetchItems(sourceId, _ctx) {
  let sourceUrl;
  try {
    sourceUrl = new URL(sourceId);
  } catch {
    throw new Error(`[${SITE_ID}] 无效 URL: ${sourceId}`);
  }
  if (!/^https?:$/i.test(sourceUrl.protocol)) {
    throw new Error(`[${SITE_ID}] 仅支持 http/https URL`);
  }

  const themeOptions = resolveThemeOptions(sourceUrl);
  const maxPages = resolveMaxPages(sourceUrl);
  let rows;
  if (themeOptions.mode === "theme") {
    rows = await fetchThemeRowsPaged(sourceUrl.origin, themeOptions, THEME_PAGE_SIZE, maxPages);
  } else if (themeOptions.mode === "all_tabs") {
    rows = await fetchAllThemeRows(sourceUrl.origin, THEME_PAGE_SIZE, maxPages);
  } else {
    rows = await fetchNewsRows(sourceUrl.origin);
  }
  const items = [];
  const seenLinks = new Set();

  for (const row of rows) {
    const item = mapRowToFeedItem(row, sourceUrl.origin);
    if (!item || seenLinks.has(item.link)) continue;
    seenLinks.add(item.link);
    items.push(item);
  }

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  if (items.length === 0) {
    if (themeOptions.mode === "theme") {
      throw new Error(`[${SITE_ID}] 目录 ${themeOptions.label} 未解析到条目`);
    }
    throw new Error(`[${SITE_ID}] 未解析到条目，接口结构可能已变化`);
  }
  return items;
}


export default {
  id: SITE_ID,
  refreshInterval: "10min",
  listUrlPattern: /^https?:\/\/(?:www\.)?5radar\.com(?:\/[A-Za-z0-9_-]+\/news)?\/?(?:[?#].*)?$/i,
  fetchItems,
};
