import { createHash } from "node:crypto";

const DEFAULT_ORIGIN = "https://agi-eval.org";
const DEFAULT_SOURCES = ["PUBLIC", "PRIVATE"];
const VALID_SOURCES = new Set(DEFAULT_SOURCES);

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parseDate(value) {
  const text = normalizeText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function clampText(text, maxLen = 300) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trim()}…`;
}

function pickOrigin(sourceId) {
  try {
    const url = new URL(sourceId);
    if (/^https?:$/i.test(url.protocol)) return url.origin;
  } catch {
    // ignore
  }
  return DEFAULT_ORIGIN;
}

function parseSources(sourceId) {
  const found = [];
  try {
    const url = new URL(sourceId);
    const fromQuery = [
      url.searchParams.get("source"),
      url.searchParams.get("sources"),
    ];
    for (const value of fromQuery) {
      if (!value) continue;
      found.push(...value.split(/[,+\s|/]+/g));
    }

    const pathMatch = url.pathname.match(/^\/evaluation\/home\/([^/?#]+)/i);
    if (pathMatch) {
      found.push(...decodeURIComponent(pathMatch[1]).split(/[,+\s|/]+/g));
    }
  } catch {
    // ignore
  }

  const picked = [];
  const seen = new Set();
  for (const raw of found) {
    const source = normalizeText(raw).toUpperCase();
    if (!VALID_SOURCES.has(source) || seen.has(source)) continue;
    seen.add(source);
    picked.push(source);
  }
  return picked.length > 0 ? picked : [...DEFAULT_SOURCES];
}

async function fetchBySource(origin, source) {
  const response = await fetch(`${origin}/commWebApi/evaluation/home`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ source }),
  });

  if (!response.ok) {
    throw new Error(`[agi-eval-evaluation] source=${source} 请求失败: HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.rescode !== 0) {
    const message = normalizeText(payload?.msg) || "接口返回异常";
    throw new Error(`[agi-eval-evaluation] source=${source} 请求失败: ${message}`);
  }

  const list = payload?.data?.evaluationList;
  if (!Array.isArray(list)) {
    throw new Error(`[agi-eval-evaluation] source=${source} 响应结构异常`);
  }
  return list;
}

function buildLink(origin, record) {
  const id = String(record?.id ?? "").trim();
  const name = normalizeText(record?.name);
  if (id && name) {
    return `${origin}/evaluation/${encodeURIComponent(name)}?id=${encodeURIComponent(id)}`;
  }
  if (id) {
    return `${origin}/evaluation/detail?id=${encodeURIComponent(id)}`;
  }
  return `${origin}/evaluation/home`;
}

function pickPubDate(record) {
  const candidates = [record?.publishTime, record?.createdAt, record?.updatedAt];
  for (const value of candidates) {
    const date = parseDate(value);
    if (date) return date;
  }
  return new Date();
}

function buildSummary(record) {
  const description = normalizeText(
    record?.description ||
      record?.introduction ||
      record?.zhData?.description ||
      record?.enData?.description ||
      ""
  );
  const detail = description || "AGI-Eval 评测条目";
  const views = Number(record?.views);
  if (Number.isFinite(views) && views >= 0) {
    return clampText(`${detail} | 浏览量 ${views}`);
  }
  return clampText(detail);
}

function buildCategories(record, source) {
  const raw = [
    source,
    normalizeText(record?.modality),
    normalizeText(record?.type),
    Number(record?.openStatus) === 1 ? "OPEN" : "CLOSED",
  ];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

function toFeedItem(record, origin, source) {
  if (!record || typeof record !== "object") return null;
  const title = normalizeText(record.name);
  if (!title) return null;

  const link = buildLink(origin, record);
  const id = String(record.id ?? "").trim();
  const guidSeed = id ? `agi-eval:${id}` : link;

  return {
    guid: hashGuid(guidSeed),
    title,
    link,
    pubDate: pickPubDate(record),
    author: "AGI-Eval",
    summary: buildSummary(record),
    categories: buildCategories(record, source),
    sourceId: "agi-eval-evaluation",
  };
}

async function fetchItems(sourceId) {
  const origin = pickOrigin(sourceId);
  const sources = parseSources(sourceId);
  const rows = [];

  for (const source of sources) {
    const list = await fetchBySource(origin, source);
    for (const record of list) {
      rows.push({ source, record });
    }
  }

  const seen = new Set();
  const items = [];
  for (const { source, record } of rows) {
    const item = toFeedItem(record, origin, source);
    if (!item || seen.has(item.guid)) continue;
    seen.add(item.guid);
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("[agi-eval-evaluation] 未解析到条目，接口结构可能已变化");
  }

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return items;
}

export default {
  id: "agi-eval-evaluation",
  listUrlPattern: /^https?:\/\/agi-eval\.(org|cn)\/evaluation\/home(?:\/[^/?#]+)?\/?(?:\?.*)?$/i,
  fetchItems,
};
