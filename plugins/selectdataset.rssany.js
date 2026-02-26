// SelectDataset 插件：解析首页/搜索页 Nuxt payload，输出数据集条目（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const SELECT_DATASET_ORIGIN = "https://www.selectdataset.com";


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function parseDate(dateText) {
  const text = normalizeText(dateText);
  if (!text || text === "0") return new Date();
  const m = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (!m) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
  }
  const [, y, mm, dd, hh = "0", mi = "0", ss = "0"] = m;
  // 站点时间以中国时区为主，显式补 +08:00 避免环境时区影响排序。
  const withTimezone = `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T` +
    `${hh.padStart(2, "0")}:${mi.padStart(2, "0")}:${ss.padStart(2, "0")}+08:00`;
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}


function toAbsoluteDatasetUrl(datasetId) {
  const id = normalizeText(datasetId);
  if (!id) return null;
  return `${SELECT_DATASET_ORIGIN}/dataset/${id}`;
}


function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.link || seen.has(item.link)) continue;
    seen.add(item.link);
    out.push(item);
  }
  return out;
}


function parseFromAnchorDom(html, finalUrl) {
  const root = parse(html);
  const baseUrl = finalUrl || SELECT_DATASET_ORIGIN;
  const items = [];

  for (const anchor of root.querySelectorAll('a[href*="/dataset/"]')) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let link = null;
    try {
      const url = new URL(href, baseUrl);
      if (!/^https?:$/i.test(url.protocol)) continue;
      if (!/\/dataset\/[A-Za-z0-9]{16,}/.test(url.pathname)) continue;
      link = url.href;
    } catch {
      continue;
    }
    const title = normalizeText(anchor.textContent);
    if (!title) continue;

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate: new Date(),
      summary: undefined,
    });
  }

  return dedupeItems(items);
}


function createNuxtResolver(table) {
  const cache = new Map();
  const inProgress = new Set();

  function decodeRef(index) {
    if (cache.has(index)) return cache.get(index);
    if (inProgress.has(index)) return undefined;
    inProgress.add(index);
    const decoded = decodeValue(table[index]);
    inProgress.delete(index);
    cache.set(index, decoded);
    return decoded;
  }

  function decodeValue(value) {
    if (typeof value === "number") {
      if (Number.isInteger(value) && value >= 0 && value < table.length) {
        return decodeRef(value);
      }
      return value;
    }
    if (value == null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      if (value.length === 2 && (value[0] === "Reactive" || value[0] === "ShallowReactive")) {
        return decodeValue(value[1]);
      }
      if (value.length === 2 && value[0] === "Set") {
        const raw = decodeValue(value[1]);
        return Array.isArray(raw) ? raw : [];
      }
      return value.map((x) => decodeValue(x));
    }

    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = decodeValue(v);
    }
    return out;
  }

  return { decodeRef };
}


function normalizeCategories(record) {
  const raw = [];
  if (Array.isArray(record.topic_list)) raw.push(...record.topic_list);
  raw.push(record.first_class, record.second_class);

  const categories = [];
  const seen = new Set();
  for (const value of raw) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    categories.push(text);
  }
  return categories.length > 0 ? categories : undefined;
}


function toFeedItem(record) {
  const title = normalizeText(record.dataset_name);
  const link = toAbsoluteDatasetUrl(record.id);
  if (!title || !link) return null;

  const summary = normalizeText(record.dataset_desc);
  const author = normalizeText(record.ext_host_name);
  return {
    guid: hashGuid(link),
    title,
    link,
    pubDate: parseDate(record.date_index_update || record.date_dataset_update),
    author: author || undefined,
    summary: summary || undefined,
    categories: normalizeCategories(record),
  };
}


function parseFromNuxtPayload(html) {
  const root = parse(html);
  const payload = root.querySelector("#__NUXT_DATA__")?.textContent;
  if (!payload) return [];

  let table;
  try {
    table = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!Array.isArray(table)) return [];

  const { decodeRef } = createNuxtResolver(table);
  const items = [];

  for (let i = 0; i < table.length; i += 1) {
    const entry = table[i];
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!("dataset_name" in entry) || !("id" in entry)) continue;

    const decoded = decodeRef(i);
    if (!decoded || typeof decoded !== "object") continue;
    const item = toFeedItem(decoded);
    if (item) items.push(item);
  }

  const deduped = dedupeItems(items);
  deduped.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return deduped;
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const fromAnchorDom = parseFromAnchorDom(html, finalUrl);
  if (fromAnchorDom.length > 0) return fromAnchorDom;

  // 净化 HTML 下无稳定数据集链接时，回退到未净化 payload 取 dataset id 与更新时间。
  const raw = await ctx.fetchHtml(sourceId, { waitMs: 3500, purify: false });
  const fromPayload = parseFromNuxtPayload(raw.html);
  if (fromPayload.length > 0) return fromPayload;

  throw new Error("[selectdataset] 未解析到数据集条目，页面结构可能已变化");
}


export default {
  id: "selectdataset",
  listUrlPattern: /^https?:\/\/(www\.)?selectdataset\.com\/(?:$|\?.*|search(?:\?.*)?|subject(?:\?.*)?)$/i,
  fetchItems,
};
