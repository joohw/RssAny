import { createHash } from "node:crypto";

const API_ROOT = "https://static.openxlab.org.cn/opendatalab/dynamics";
const DETAIL_ROOT = "https://opendatalab.org.cn/news/details";

const SOURCES = [
  {
    label: "featuredArticles",
    url: `${API_ROOT}/featuredArticles/data.json?t=12`,
    detailType: "article",
    category: "精选文章",
  },
  {
    label: "banner",
    url: `${API_ROOT}/banner/data.json?t=1`,
    detailType: "banner",
    category: "轮播",
  },
  {
    label: "AItalk",
    url: `${API_ROOT}/talkArticles/AItalk/data.json?t=1`,
    detailType: "AItalk",
    category: "AI Talk",
  },
  {
    label: "JStalk",
    url: `${API_ROOT}/talkArticles/JStalk/data.json?t=1`,
    detailType: "JStalk",
    category: "解数 Talk",
  },
];

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parsePubDate(rawDate, rawStartTime) {
  const dateText = normalizeText(rawDate);
  const dateMatch = dateText.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!dateMatch) return new Date();

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");

  const timeText = normalizeText(rawStartTime);
  const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);

  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if ([year, month, day, hour, minute].every(Number.isFinite)) {
      const hourText = String(hour).padStart(2, "0");
      const minuteText = String(minute).padStart(2, "0");
      return new Date(`${year}-${monthText}-${dayText}T${hourText}:${minuteText}:00+08:00`);
    }
  }

  if ([year, month, day].every(Number.isFinite)) {
    return new Date(`${year}-${monthText}-${dayText}T12:00:00+08:00`);
  }

  return new Date();
}

function buildSummary(item) {
  const dateText = normalizeText(item?.date);
  const start = normalizeText(item?.start_time);
  const end = normalizeText(item?.end_time);
  if (!dateText) return undefined;
  if (start && end) return `直播时间: ${dateText} ${start}-${end}`;
  return `发布时间: ${dateText}`;
}

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[opendatalab-news] 请求 ${label} 失败: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`[opendatalab-news] 请求 ${label} 失败: HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[opendatalab-news] 解析 ${label} JSON 失败: ${message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`[opendatalab-news] ${label} 返回结构异常，期望数组`);
  }

  return data;
}

function mapItems(records, source) {
  const items = [];

  for (const raw of records) {
    if (typeof raw !== "object" || raw == null) continue;

    const id = Number(raw.id);
    const title = normalizeText(raw.title);
    if (!Number.isFinite(id) || !title) continue;

    const link = `${DETAIL_ROOT}/${source.detailType}/${id}`;
    const pubDate = parsePubDate(raw.date, raw.start_time);
    const summary = buildSummary(raw);

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      summary,
      categories: [source.category],
      sourceId: "opendatalab-news",
    });
  }

  return items;
}

async function fetchItems(_sourceId, _ctx) {
  const collected = [];

  for (const source of SOURCES) {
    const records = await fetchJson(source.url, source.label);
    collected.push(...mapItems(records, source));
  }

  const deduped = [];
  const seen = new Set();

  for (const item of collected) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }

  deduped.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  if (deduped.length === 0) {
    throw new Error("[opendatalab-news] 未解析到条目，页面数据源可能已变化");
  }

  return deduped;
}

export default {
  id: "opendatalab-news",
  listUrlPattern: /^https?:\/\/(www\.)?opendatalab\.(org\.cn|com)\/news\/?(\?.*)?$/i,
  refreshInterval: "1h",
  fetchItems,
};
