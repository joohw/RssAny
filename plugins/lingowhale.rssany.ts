// 语鲸 Open API 插件：将语鲸推荐文章 / 今日文章转换为 FeedItem[]
// sourceId 格式：lingowhale://articles 或 lingowhale://today
// 认证参数可内联于 URL query：?app_id=xxx&app_secret=yyy
// 也可通过环境变量 LINGOWHALE_APP_ID / LINGOWHALE_APP_SECRET 提供

import type { Site, SiteContext } from "../src/sources/web/site.js";
import type { FeedItem } from "../src/types/feedItem.js";


const BASE_URL = "https://open.lingowhale.com/open-api/v1";


interface LingowhaleArticle {
  entry_id: string;
  title?: string;
  orig_url?: string;
  html?: string;
  pub_time?: number;
  abstract?: string;
  description?: string;
}

interface LingowhaleListResponse {
  code: number;
  message: string;
  data: {
    items: LingowhaleArticle[];
    total?: number;
    nextCursor?: string;
  };
}


function resolveCredentials(sourceId: string): { appId: string; appSecret: string } {
  let appId = process.env.LINGOWHALE_APP_ID ?? "";
  let appSecret = process.env.LINGOWHALE_APP_SECRET ?? "";
  try {
    const parsed = new URL(sourceId.replace(/^lingowhale:/, "http://x"));
    appId = parsed.searchParams.get("app_id") ?? appId;
    appSecret = parsed.searchParams.get("app_secret") ?? appSecret;
  } catch { /* fallback to env vars */ }
  if (!appId || !appSecret) {
    throw new Error(
      "[LingowhalePlugin] 缺少认证信息：请在 sourceId 中提供 ?app_id=&app_secret= 参数，" +
      "或设置环境变量 LINGOWHALE_APP_ID / LINGOWHALE_APP_SECRET"
    );
  }
  return { appId, appSecret };
}

function resolveEndpoint(sourceId: string): "articles" | "today" {
  return sourceId.includes("://today") ? "today" : "articles";
}

function resolveMaxPages(sourceId: string): number {
  try {
    const parsed = new URL(sourceId.replace(/^lingowhale:/, "http://x"));
    const pages = parseInt(parsed.searchParams.get("pages") ?? "", 10);
    if (!isNaN(pages) && pages > 0) return pages;
  } catch { /* ignore */ }
  return 2;
}

function buildHeaders(appId: string, appSecret: string): Record<string, string> {
  return {
    "X-App-ID": appId,
    "X-App-Secret": appSecret,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function stripHl(text: string): string {
  return text.replace(/<\/?hl>/g, "");
}

function mapArticle(article: LingowhaleArticle): FeedItem {
  const link = article.orig_url ?? `https://lingowhale.com/article/${article.entry_id}`;
  const rawSummary = article.abstract || article.description;
  return {
    guid: article.entry_id,
    title: article.title ?? "(无标题)",
    link,
    pubDate: article.pub_time ? new Date(article.pub_time * 1000) : new Date(),
    summary: rawSummary ? stripHl(rawSummary) : undefined,
    contentHtml: article.html || undefined,
  };
}

async function fetchArticles(appId: string, appSecret: string, maxPages: number): Promise<FeedItem[]> {
  const headers = buildHeaders(appId, appSecret);
  const items: FeedItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${BASE_URL}/articles?page=${page}&page_size=20`, { headers });
    if (!res.ok) throw new Error(`[LingowhalePlugin] HTTP ${res.status} 拉取文章列表失败`);
    const json = await res.json() as LingowhaleListResponse;
    if (json.code !== 0) throw new Error(`[LingowhalePlugin] API 错误：${json.message}`);
    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));
    const total = json.data.total ?? 0;
    if (items.length >= total || pageItems.length === 0) break;
  }
  return items;
}

async function fetchTodayArticles(appId: string, appSecret: string): Promise<FeedItem[]> {
  const headers = buildHeaders(appId, appSecret);
  const items: FeedItem[] = [];
  let cursor: string | undefined;
  for (let round = 0; round < 10; round++) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`${BASE_URL}/articles/today?page_size=20${cursorParam}`, { headers });
    if (!res.ok) throw new Error(`[LingowhalePlugin] HTTP ${res.status} 拉取今日文章失败`);
    const json = await res.json() as LingowhaleListResponse;
    if (json.code !== 0) throw new Error(`[LingowhalePlugin] API 错误：${json.message}`);
    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));
    cursor = json.data.nextCursor;
    if (!cursor || pageItems.length === 0) break;
  }
  return items;
}


const lingowhalePlugin: Site = {
  id: "lingowhale",
  listUrlPattern: /^lingowhale:\/\//,
  refreshInterval: "1h",

  async fetchItems(sourceId: string, _ctx: SiteContext): Promise<FeedItem[]> {
    const { appId, appSecret } = resolveCredentials(sourceId);
    const endpoint = resolveEndpoint(sourceId);
    const maxPages = resolveMaxPages(sourceId);
    if (endpoint === "today") return fetchTodayArticles(appId, appSecret);
    return fetchArticles(appId, appSecret, maxPages);
  },
};

export default lingowhalePlugin;
