// 语鲸 Open API 插件：将语鲸推荐文章 / 今日文章转换为条目列表
//
// sourceId 格式：
//   lingowhale://articles  — 推荐文章（默认拉取 2 页，可用 ?pages=5 调整）
//   lingowhale://today     — 今日文章（自动翻页拉完）
//
// 认证参数可内联于 URL query：
//   lingowhale://articles?app_id=xxx&app_secret=yyy
// 也可通过环境变量提供（优先级低于 URL 参数）：
//   LINGOWHALE_APP_ID / LINGOWHALE_APP_SECRET


const BASE_URL = "https://open.lingowhale.com/open-api/v1";


function resolveCredentials(sourceId) {
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

function resolveEndpoint(sourceId) {
  return sourceId.includes("://today") ? "today" : "articles";
}

function resolveMaxPages(sourceId) {
  try {
    const parsed = new URL(sourceId.replace(/^lingowhale:/, "http://x"));
    const pages = parseInt(parsed.searchParams.get("pages") ?? "", 10);
    if (!isNaN(pages) && pages > 0) return pages;
  } catch { /* ignore */ }
  return 2;
}

function buildHeaders(appId, appSecret) {
  return {
    "X-App-ID": appId,
    "X-App-Secret": appSecret,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function stripHl(text) {
  return text.replace(/<\/?hl>/g, "");
}

function mapArticle(article) {
  const link = article.orig_url ?? `https://lingowhale.com/article/${article.entry_id}`;
  const rawSummary = article.abstract || article.description;
  return {
    guid: article.entry_id,
    title: article.title ?? "(无标题)",
    link,
    pubDate: article.pub_time ? new Date(article.pub_time * 1000) : new Date(),
    summary: rawSummary ? stripHl(rawSummary) : undefined,
    content: article.html || undefined,
  };
}

async function fetchArticles(appId, appSecret, maxPages) {
  const headers = buildHeaders(appId, appSecret);
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${BASE_URL}/articles?page=${page}&page_size=20`, { headers });
    if (!res.ok) throw new Error(`[LingowhalePlugin] HTTP ${res.status} 拉取文章列表失败`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`[LingowhalePlugin] API 错误：${json.message}`);
    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));
    const total = json.data.total ?? 0;
    if (items.length >= total || pageItems.length === 0) break;
  }
  return items;
}

async function fetchTodayArticles(appId, appSecret) {
  const headers = buildHeaders(appId, appSecret);
  const items = [];
  let cursor;
  for (let round = 0; round < 10; round++) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`${BASE_URL}/articles/today?page_size=20${cursorParam}`, { headers });
    if (!res.ok) throw new Error(`[LingowhalePlugin] HTTP ${res.status} 拉取今日文章失败`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`[LingowhalePlugin] API 错误：${json.message}`);
    const pageItems = json.data.items ?? [];
    items.push(...pageItems.map(mapArticle));
    cursor = json.data.nextCursor;
    if (!cursor || pageItems.length === 0) break;
  }
  return items;
}


export default {
  id: "lingowhale",
  listUrlPattern: /^lingowhale:\/\//,
  refreshInterval: "1h",

  async fetchItems(sourceId, _ctx) {
    const { appId, appSecret } = resolveCredentials(sourceId);
    const endpoint = resolveEndpoint(sourceId);
    const maxPages = resolveMaxPages(sourceId);
    if (endpoint === "today") return fetchTodayArticles(appId, appSecret);
    return fetchArticles(appId, appSecret, maxPages);
  },
};
