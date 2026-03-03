import { createHash } from "node:crypto";

const OPENDATALAB_ORIGIN = "https://opendatalab.org.cn";
const OPENDATALAB_LIST_API = `${OPENDATALAB_ORIGIN}/datasets/api/v3/datasets/list`;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toDate(value) {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function pickPubDate(record) {
  const candidates = [record?.lastUpdateTime, record?.updatedAt, record?.publicTime, record?.createdAt];
  for (const value of candidates) {
    const parsed = toDate(value);
    if (parsed) return parsed;
  }
  return new Date();
}

function toDatasetLink(name) {
  const normalized = normalizeText(name);
  if (!normalized) return null;
  const parts = normalized.split("/").map((x) => normalizeText(x)).filter(Boolean);
  if (parts.length < 2) return null;
  const encodedPath = parts.map((x) => encodeURIComponent(x)).join("/");
  return `${OPENDATALAB_ORIGIN}/${encodedPath}`;
}

function toFeedItem(record) {
  if (!record || typeof record !== "object") return null;
  const title = normalizeText(record.displayName || record.name || "");
  const link = toDatasetLink(record.name);
  if (!title || !link) return null;

  const summary = normalizeText(record?.introduction?.zh || record?.introduction?.en || "");
  const author = normalizeText(record?.createdBy?.name || record?.updatedBy || "");

  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: pickPubDate(record),
    author: author || undefined,
    summary: summary || undefined,
    sourceId: "opendatalab",
  };
}

function parsePaginationFromSourceId(sourceId) {
  const defaults = { pageNo: 1, pageSize: 30 };
  try {
    const url = new URL(sourceId);
    const pageNo = Number(url.searchParams.get("pageNo") ?? defaults.pageNo);
    const pageSize = Number(url.searchParams.get("pageSize") ?? defaults.pageSize);
    const safePageNo = Number.isInteger(pageNo) && pageNo > 0 ? pageNo : defaults.pageNo;
    const safePageSize = Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : defaults.pageSize;
    return { pageNo: safePageNo, pageSize: safePageSize };
  } catch {
    return defaults;
  }
}

async function fetchItems(sourceId) {
  const { pageNo, pageSize } = parsePaginationFromSourceId(sourceId);
  const response = await fetch(OPENDATALAB_LIST_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ pageNo, pageSize }),
  });

  if (!response.ok) {
    throw new Error(`[opendatalab] 请求列表接口失败: HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  const list = payload?.data?.list;
  if (!Array.isArray(list)) {
    const msg = normalizeText(payload?.msg) || "返回结构异常";
    throw new Error(`[opendatalab] 列表接口响应不可用: ${msg}`);
  }

  const items = list.map((record) => toFeedItem(record)).filter(Boolean);
  if (items.length === 0) {
    throw new Error("[opendatalab] 未解析到条目，接口结构可能已变化");
  }
  return items;
}

export default {
  id: "opendatalab",
  listUrlPattern: /^https?:\/\/(www\.)?opendatalab\.(org\.cn|com)\/?(?:datasets\/?)?(?:\?.*)?$/i,
  fetchItems,
};
