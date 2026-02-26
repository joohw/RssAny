import { createHash } from "node:crypto";

const DATAVERSE_ORIGIN = "https://dataverse.harvard.edu";
const DATAVERSE_SEARCH_API = `${DATAVERSE_ORIGIN}/api/search`;
const DEFAULT_QUERY = "*";
const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parseDate(value) {
  const text = normalizeText(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toSafeInteger(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(raw)) return fallback;
  if (raw < min || raw > max) return fallback;
  return raw;
}

function toHttpUrl(rawUrl, baseUrl = DATAVERSE_ORIGIN) {
  const text = normalizeText(rawUrl);
  if (!text) return null;
  try {
    const url = new URL(text, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeCategories(subjects) {
  if (!Array.isArray(subjects)) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of subjects) {
    const value = normalizeText(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

function extractAuthor(record) {
  if (Array.isArray(record?.authors)) {
    const authors = record.authors.map((x) => normalizeText(x)).filter(Boolean);
    if (authors.length > 0) return authors.join(", ");
  }
  const publisher = normalizeText(record?.publisher);
  if (publisher) return publisher;
  const dataverseName = normalizeText(record?.name_of_dataverse);
  return dataverseName || undefined;
}

function extractSubtree(sourceId) {
  try {
    const url = new URL(sourceId);
    const fromQuery = normalizeText(url.searchParams.get("subtree"));
    if (fromQuery) return fromQuery;

    const dataverseAlias = normalizeText(url.searchParams.get("alias"));
    if (url.pathname === "/dataverse.xhtml" && dataverseAlias) {
      return dataverseAlias;
    }

    const match = url.pathname.match(/^\/dataverse\/([^/?#]+)\/?$/i);
    if (!match) return undefined;
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function buildQuery(sourceId) {
  const params = new URLSearchParams();
  params.set("type", "dataset");
  params.set("sort", "date");
  params.set("order", "desc");

  try {
    const url = new URL(sourceId);
    const q = normalizeText(url.searchParams.get("q")) || DEFAULT_QUERY;
    const perPage = toSafeInteger(
      url.searchParams.get("per_page") ?? url.searchParams.get("perPage"),
      DEFAULT_PER_PAGE,
      { min: 1, max: MAX_PER_PAGE }
    );
    const start = toSafeInteger(url.searchParams.get("start"), 0, { min: 0 });
    const sort = normalizeText(url.searchParams.get("sort"));
    const order = normalizeText(url.searchParams.get("order"));

    params.set("q", q);
    params.set("per_page", String(perPage));
    params.set("start", String(start));
    if (/^[A-Za-z_]+$/.test(sort)) params.set("sort", sort);
    if (/^(asc|desc)$/i.test(order)) params.set("order", order.toLowerCase());
  } catch {
    params.set("q", DEFAULT_QUERY);
    params.set("per_page", String(DEFAULT_PER_PAGE));
    params.set("start", "0");
  }

  const subtree = extractSubtree(sourceId);
  if (subtree) params.set("subtree", subtree);
  return params;
}

function toFeedItem(record, index) {
  if (!record || typeof record !== "object") return null;

  const title = normalizeText(record.name);
  const link = toHttpUrl(record.url);
  if (!title || !link) return null;

  const guidSeed = normalizeText(record.global_id) || link;
  const pubDate =
    parseDate(record.published_at) ??
    parseDate(record.updatedAt) ??
    parseDate(record.createdAt) ??
    new Date(Date.now() - index * 1000);
  const summary = normalizeText(record.description);

  return {
    guid: hashGuid(guidSeed),
    title,
    link,
    pubDate,
    author: extractAuthor(record),
    summary: summary || undefined,
    categories: normalizeCategories(record.subjects),
    sourceId: "harvard-dataverse",
  };
}

async function fetchItems(sourceId) {
  const query = buildQuery(sourceId);
  const apiUrl = `${DATAVERSE_SEARCH_API}?${query.toString()}`;
  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`[harvard-dataverse] 请求搜索接口失败: HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  const records = payload?.data?.items;
  if (!Array.isArray(records)) {
    throw new Error("[harvard-dataverse] 搜索接口响应结构异常");
  }

  const items = records.map((record, index) => toFeedItem(record, index)).filter(Boolean);
  if (items.length === 0) {
    throw new Error("[harvard-dataverse] 未解析到条目，接口结构可能已变化");
  }
  return items;
}

export default {
  id: "harvard-dataverse",
  listUrlPattern:
    /^https?:\/\/dataverse\.harvard\.edu(?:\/?$|\/\?.*|\/dataverse\/[^/?#]+\/?(?:\?.*)?|\/dataverse\.xhtml(?:\?.*)?)$/i,
  fetchItems,
};
