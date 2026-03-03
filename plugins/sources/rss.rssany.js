// 内置 RSS/Atom/JSON Feed 插件：匹配 *rss*、*atom*、*.xml 等标准 Feed URL

import Parser from "rss-parser";
import { createHash } from "node:crypto";

const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
    Accept: "application/rss+xml,application/atom+xml,application/json,application/xml,text/xml,*/*",
  },
});

function looksLikeFeed(url) {
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

async function fetchFeed(url, proxy) {
  const proxyToUse = proxy ?? process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY;
  if (proxyToUse) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const agent = new HttpsProxyAgent(proxyToUse);
    const parserWithProxy = new Parser({
      timeout: 15_000,
      headers: {
        "User-Agent": "RssAny/1.0",
        Accept: "application/rss+xml,application/atom+xml,application/json,application/xml,text/xml,*/*",
      },
      requestOptions: { agent },
    });
    return parserWithProxy.parseURL(url);
  }
  return parser.parseURL(url);
}

export default {
  id: "__rss__",
  pattern: /^https?:\/\//,
  match: looksLikeFeed,
  priority: 20,
  refreshInterval: "1h",
  async fetchItems(sourceId, ctx) {
    const feed = await fetchFeed(sourceId, ctx.proxy);
    return (feed.items ?? []).map((item) => {
      const link = item.link ?? item.guid ?? sourceId;
      const guid = item.guid ?? createHash("sha256").update(link).digest("hex");
      const pubDate =
        item.pubDate != null
          ? new Date(item.pubDate)
          : item.isoDate != null
            ? new Date(item.isoDate)
            : new Date();
      const authorRaw =
        typeof item.creator === "string" ? item.creator : typeof item.author === "string" ? item.author : undefined;
      const author = authorRaw ? [authorRaw] : undefined;
      const summary =
        typeof item.summary === "string" ? item.summary : typeof item.contentSnippet === "string" ? item.contentSnippet : undefined;
      const content =
        typeof item.content === "string" ? item.content : typeof item["content:encoded"] === "string" ? item["content:encoded"] : undefined;
      return {
        guid,
        title: item.title ?? "(无标题)",
        link,
        pubDate,
        author,
        summary,
        content,
      };
    });
  },
};
