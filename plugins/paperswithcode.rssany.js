import { createHash } from "node:crypto";


const SITE_ID = "paperswithcode";
const API_ORIGIN = "https://paperswithcode.co";
const DEFAULT_TRENDING_LIMIT = 30;
const DEFAULT_MAX_AGE_DAYS = 180;
const DEFAULT_LATEST_PAGE_SIZE = 30;


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function toValidDate(raw) {
  const text = normalizeText(raw);
  if (!text) return new Date();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}


function parsePositiveInt(raw, fallback, { min = 1, max = 200 } = {}) {
  const n = Number.parseInt(normalizeText(raw), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}


function resolveMode(sourceUrl) {
  const sort = normalizeText(sourceUrl.searchParams.get("sort")).toLowerCase();
  if (["latest", "new", "date", "date_published"].includes(sort)) return "latest";
  if (["trending", "hot", "popular"].includes(sort)) return "trending";
  return "trending";
}


function toPaperLink(arxivId) {
  const id = normalizeText(arxivId);
  if (!id) return null;
  return `${API_ORIGIN}/paper/${encodeURIComponent(id)}`;
}


function joinCategories(tasks) {
  if (!Array.isArray(tasks)) return undefined;
  const values = tasks
    .map((task) => {
      if (typeof task === "string") return normalizeText(task);
      if (task && typeof task === "object") return normalizeText(task.name);
      return "";
    })
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}


function buildSummaryFromTrending(item) {
  const repoName = normalizeText(item?.repository?.name);
  const repoOwner = normalizeText(item?.repository?.owner);
  const stars = Number(item?.repository?.num_stars ?? 0);
  const tasks = joinCategories(item?.tasks);
  const parts = [];

  if (repoOwner && repoName) {
    parts.push(`Repo: ${repoOwner}/${repoName}`);
  }
  if (stars > 0) {
    parts.push(`Stars: ${stars}`);
  }
  if (tasks?.length) {
    parts.push(`Tasks: ${tasks.join(", ")}`);
  }
  return parts.length ? parts.join(" | ") : undefined;
}


function mapTrendingItem(item) {
  const title = normalizeText(item?.title);
  const link = toPaperLink(item?.arxiv_id);
  if (!title || !link) return null;

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: toValidDate(item?.date_published),
    summary: buildSummaryFromTrending(item),
    categories: joinCategories(item?.tasks),
    sourceId: SITE_ID,
  };
}


function mapLatestItem(item) {
  const title = normalizeText(item?.title);
  const link = toPaperLink(item?.arxiv_id) || normalizeText(item?.url_abs);
  if (!title || !link) return null;

  const summary = normalizeText(item?.abstract);
  const categories = joinCategories(item?.tasks);
  const firstAuthor = Array.isArray(item?.authors) ? normalizeText(item.authors[0]) : "";

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: toValidDate(item?.published),
    author: firstAuthor || undefined,
    summary: summary || undefined,
    categories,
    sourceId: SITE_ID,
  };
}


async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error("接口返回非 JSON 数据");
  }
}


function dedupeByLink(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item || !item.link) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    output.push(item);
  }
  return output;
}


async function fetchTrendingItems(sourceUrl) {
  const limit = parsePositiveInt(sourceUrl.searchParams.get("limit"), DEFAULT_TRENDING_LIMIT, { max: 100 });
  const maxAgeDays = parsePositiveInt(
    sourceUrl.searchParams.get("max_age_days"),
    DEFAULT_MAX_AGE_DAYS,
    { max: 3650 }
  );

  const apiUrl = new URL("/api/v1/papers/trending", API_ORIGIN);
  apiUrl.searchParams.set("limit", String(limit));
  apiUrl.searchParams.set("max_age_days", String(maxAgeDays));

  const payload = await fetchJson(apiUrl);
  const rows = Array.isArray(payload) ? payload : [];
  return dedupeByLink(rows.map(mapTrendingItem).filter(Boolean));
}


async function fetchLatestItems(sourceUrl) {
  const pageSize = parsePositiveInt(sourceUrl.searchParams.get("page_size"), DEFAULT_LATEST_PAGE_SIZE, {
    max: 100,
  });
  const page = parsePositiveInt(sourceUrl.searchParams.get("page"), 1, { max: 1000 });

  const apiUrl = new URL("/api/v1/papers/", API_ORIGIN);
  apiUrl.searchParams.set("page", String(page));
  apiUrl.searchParams.set("page_size", String(pageSize));
  apiUrl.searchParams.set("order_by", "date_published");
  apiUrl.searchParams.set("order_dir", "desc");
  apiUrl.searchParams.set("include_resources", "true");

  const payload = await fetchJson(apiUrl);
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return dedupeByLink(rows.map(mapLatestItem).filter(Boolean));
}


async function fetchItems(sourceId, _ctx) {
  let sourceUrl;
  try {
    sourceUrl = new URL(sourceId);
  } catch {
    throw new Error(`[${SITE_ID}] 无效 URL: ${sourceId}`);
  }

  const mode = resolveMode(sourceUrl);
  const errors = [];

  const tryMode = async (m) => {
    try {
      return m === "latest" ? await fetchLatestItems(sourceUrl) : await fetchTrendingItems(sourceUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${m}: ${msg}`);
      return [];
    }
  };

  const primary = await tryMode(mode);
  if (primary.length > 0) return primary;

  const fallbackMode = mode === "trending" ? "latest" : "trending";
  const fallback = await tryMode(fallbackMode);
  if (fallback.length > 0) return fallback;

  throw new Error(`[${SITE_ID}] 未解析到条目（${errors.join(" | ")}）`);
}


export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?paperswithcode\.(co|com)(?:\/(?:papers)?\/?)?(?:\?.*)?$/i,
  fetchItems,
};
