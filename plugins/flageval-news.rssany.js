import { createHash } from "node:crypto";


const FLAGEVAL_ORIGIN = "https://flageval.baai.ac.cn";
const FLAGEVAL_NEWS_API = `${FLAGEVAL_ORIGIN}/api/news/?page=1&pageSize=10`;
const MAX_PAGES = 5;


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function parseDate(rawValue) {
  const value = normalizeText(rawValue);
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}


function resolveLink(news) {
  const linkTo = normalizeText(news.linkTo);
  if (linkTo) {
    try {
      const url = new URL(linkTo);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // ignore invalid linkTo and use fallback
    }
  }
  const id = String(news.id ?? "").trim();
  return `${FLAGEVAL_ORIGIN}/#/news/detail/${encodeURIComponent(id || "unknown")}`;
}


async function fetchNewsPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`[flageval-news] 拉取新闻列表失败: HTTP ${response.status}`);
  }
  return await response.json();
}


async function fetchNewsList() {
  const all = [];
  let next = FLAGEVAL_NEWS_API;

  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    const payload = await fetchNewsPage(next);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    all.push(...results);
    next = typeof payload?.next === "string" && payload.next ? payload.next : "";
  }

  return all;
}


async function fetchItems(_sourceId, _ctx) {
  const newsList = await fetchNewsList();
  const seen = new Set();
  const items = [];

  for (const news of newsList) {
    if (typeof news !== "object" || news == null) continue;

    const title = normalizeText(news.title);
    if (!title) continue;

    const link = resolveLink(news);
    const id = String(news.id ?? "").trim();
    const guid = hashGuid(id ? `${id}|${link}` : link);
    if (seen.has(guid)) continue;
    seen.add(guid);

    const summary = normalizeText(news.description) || undefined;
    const pubDate = parseDate(news.publishedAt ?? news.updatedAt ?? news.createdAt);

    items.push({
      guid,
      title,
      link,
      pubDate,
      summary,
      sourceId: "flageval-news",
    });
  }

  if (items.length === 0) {
    throw new Error("[flageval-news] 未解析到新闻条目，接口结构可能已变化");
  }

  return items;
}


export default {
  id: "flageval-news",
  listUrlPattern: /^https?:\/\/flageval\.baai\.ac\.cn\/#\/news(?:[/?].*)?$/i,
  fetchItems,
};
