// LingowhaleSource：消费语鲸 Open API，将文章列表转换为 FeedItem[]
// sourceId 格式：lingowhale://articles 或 lingowhale://today
// 认证参数可内联于 URL query：?app_id=xxx&app_secret=yyy
// 也可通过环境变量 LINGOWHALE_APP_ID / LINGOWHALE_APP_SECRET 提供

import type { Source, SourceContext } from "../types.js";
import type { FeedItem } from "../../types/feedItem.js";
import type { RefreshInterval } from "../../utils/refreshInterval.js";


const BASE_URL = "https://open.lingowhale.com/open-api/v1";

interface LingowhaleArticle {
  entry_id: string;
  title?: string;
  orig_url?: string;
  content?: string;
  html?: string;
  pub_time?: number;
  description?: string;
  abstract?: string;
  surface_url?: string;
}

interface LingowhaleListResponse {
  code: number;
  message: string;
  data: {
    items: LingowhaleArticle[];
    total?: number;
    page?: number;
    page_size?: number;
    nextCursor?: string;
  };
}


/** 从 sourceId URL 或环境变量中解析认证凭据 */
function resolveCredentials(sourceId: string): { appId: string; appSecret: string } {
  let appId = process.env.LINGOWHALE_APP_ID ?? "";
  let appSecret = process.env.LINGOWHALE_APP_SECRET ?? "";

  try {
    // sourceId 可能是 lingowhale://articles?app_id=xxx&app_secret=yyy
    const fakeBase = "http://x";
    const parsed = new URL(sourceId.replace(/^lingowhale:/, fakeBase));
    appId = parsed.searchParams.get("app_id") ?? appId;
    appSecret = parsed.searchParams.get("app_secret") ?? appSecret;
  } catch {
    // 忽略解析失败，fallback 到环境变量
  }

  if (!appId || !appSecret) {
    throw new Error(
      "[LingowhaleSource] 缺少认证信息：请在 sourceId 中提供 ?app_id=&app_secret= 参数，" +
      "或设置环境变量 LINGOWHALE_APP_ID / LINGOWHALE_APP_SECRET"
    );
  }
  return { appId, appSecret };
}


/** 解析 sourceId 中的 endpoint 类型：articles（默认）或 today */
function resolveEndpoint(sourceId: string): "articles" | "today" {
  if (sourceId.includes("://today")) return "today";
  return "articles";
}


/** 从 sourceId 中解析最大拉取页数，默认 2 */
function resolveMaxPages(sourceId: string): number {
  try {
    const fakeBase = "http://x";
    const parsed = new URL(sourceId.replace(/^lingowhale:/, fakeBase));
    const pages = parseInt(parsed.searchParams.get("pages") ?? "", 10);
    if (!isNaN(pages) && pages > 0) return pages;
  } catch {
    // ignore
  }
  return 2;
}


/** 构建请求 Headers */
function buildHeaders(appId: string, appSecret: string): Record<string, string> {
  return {
    "X-App-ID": appId,
    "X-App-Secret": appSecret,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}


/** 去除语鲸摘要里的 <hl> 高亮标签 */
function stripHl(text: string): string {
  return text.replace(/<\/?hl>/g, "");
}

/** 将语鲸文章对象映射为 FeedItem */
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


/** 拉取推荐文章列表（分页） */
async function fetchArticles(
  appId: string,
  appSecret: string,
  maxPages: number,
  _ctx: SourceContext
): Promise<FeedItem[]> {
  const headers = buildHeaders(appId, appSecret);
  const items: FeedItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}/articles?page=${page}&page_size=20`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`[LingowhaleSource] HTTP ${res.status} 拉取文章列表失败`);
    const json = (await res.json()) as LingowhaleListResponse;
    if (json.code !== 0) throw new Error(`[LingowhaleSource] API 错误：${json.message}`);

    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));

    const total = json.data.total ?? 0;
    if (items.length >= total || pageItems.length === 0) break;
  }

  return items;
}


/** 拉取今日文章（游标分页，一次性拉完） */
async function fetchTodayArticles(
  appId: string,
  appSecret: string,
  _ctx: SourceContext
): Promise<FeedItem[]> {
  const headers = buildHeaders(appId, appSecret);
  const items: FeedItem[] = [];
  let cursor: string | undefined;

  for (let round = 0; round < 10; round++) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const url = `${BASE_URL}/articles/today?page_size=20${cursorParam}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`[LingowhaleSource] HTTP ${res.status} 拉取今日文章失败`);
    const json = (await res.json()) as LingowhaleListResponse;
    if (json.code !== 0) throw new Error(`[LingowhaleSource] API 错误：${json.message}`);

    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));

    cursor = json.data.nextCursor;
    if (!cursor || pageItems.length === 0) break;
  }

  return items;
}


export const lingowhaleSource: Source = {
  id: "lingowhale",
  pattern: /^lingowhale:\/\//,
  refreshInterval: "1h" satisfies RefreshInterval,

  async fetchItems(sourceId: string, ctx: SourceContext): Promise<FeedItem[]> {
    const { appId, appSecret } = resolveCredentials(sourceId);
    const endpoint = resolveEndpoint(sourceId);
    const maxPages = resolveMaxPages(sourceId);

    if (endpoint === "today") {
      return fetchTodayArticles(appId, appSecret, ctx);
    }
    return fetchArticles(appId, appSecret, maxPages, ctx);
  },
};
