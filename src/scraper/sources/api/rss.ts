// RssSource：内置 RSS/Atom/JSON Feed 解析器，直接消费标准 Feed URL，无需插件

import Parser from "rss-parser";
import type { Source, SourceContext } from "../types.js";
import type { FeedItem } from "../../../types/feedItem.js";
import { createHash } from "node:crypto";
import type { RefreshInterval } from "../../../utils/refreshInterval.js";


const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
    "Accept": "application/rss+xml,application/atom+xml,application/json,application/xml,text/xml,*/*",
  },
});


/** 判断 URL 是否看起来是标准 Feed（通过 content-type 或 URL 后缀启发式判断） */
export function looksLikeFeed(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/feed") ||
    lower.includes("/rss") ||
    lower.includes("/atom") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".rss") ||
    lower.endsWith(".atom") ||
    lower.includes("format=rss") ||
    lower.includes("format=atom") ||
    lower.includes("output=rss")
  );
}


/** 尝试拉取并解析 Feed；失败时抛出错误 */
async function fetchFeed(url: string, proxy?: string): Promise<Parser.Output<Record<string, unknown>>> {
  const proxyToUse = proxy ?? process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY;
  if (proxyToUse) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent(proxyToUse);
    const parserWithProxy = new Parser({
      timeout: 15_000,
      headers: {
        "User-Agent": "RssAny/1.0",
        "Accept": "application/rss+xml,application/atom+xml,application/json,application/xml,text/xml,*/*",
      },
      requestOptions: { agent },
    });
    return parserWithProxy.parseURL(url);
  }
  return parser.parseURL(url);
}


/** 内置 RssSource：匹配所有 http/https URL，优先级低于 WebSource 插件 */
export const rssSource: Source = {
  id: "__rss__",
  pattern: /^https?:\/\//,
  refreshInterval: "1h" satisfies RefreshInterval,
  async fetchItems(sourceId: string, ctx: SourceContext): Promise<FeedItem[]> {
    const feed = await fetchFeed(sourceId, ctx.proxy);
    return (feed.items ?? []).map((item) => {
      const link = item.link ?? item.guid ?? sourceId;
      const guid = item.guid ?? createHash("sha256").update(link).digest("hex");
      const pubDate =
        item.pubDate != null ? new Date(item.pubDate) :
        item.isoDate != null ? new Date(item.isoDate) :
        new Date();
      const author = typeof item.creator === "string" ? item.creator : typeof item.author === "string" ? item.author : undefined;
      const summary = typeof item.summary === "string" ? item.summary : typeof item.contentSnippet === "string" ? item.contentSnippet : undefined;
      const contentHtml = typeof item.content === "string" ? item.content : typeof item["content:encoded"] === "string" ? item["content:encoded"] : undefined;
      return {
        guid,
        title: item.title ?? "(无标题)",
        link,
        pubDate,
        author,
        summary,
        contentHtml,
      } satisfies FeedItem;
    });
  },
};
