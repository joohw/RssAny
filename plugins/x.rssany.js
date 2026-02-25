// X (Twitter) 站点插件：用户主页列表抓取与解析、认证流程

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const X_ORIGIN = "https://x.com";


function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return X_ORIGIN;
  }
}


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function statusPathFromHref(href) {
  if (!href) return null;
  try {
    const normalized = href.startsWith("http") ? new URL(href).pathname : href.split("?")[0];
    const m = normalized.match(/^\/([A-Za-z0-9_]{1,32})\/status\/(\d+)/);
    if (!m) return null;
    return `/${m[1]}/status/${m[2]}`;
  } catch {
    return null;
  }
}


function extractAuthor(article, statusPath) {
  const nameBlock = article.querySelector('[data-testid="User-Name"]');
  if (nameBlock) {
    const profileAnchors = nameBlock.querySelectorAll('a[href^="/"]');
    for (const a of profileAnchors) {
      const href = a.getAttribute("href") || "";
      if (/^\/[A-Za-z0-9_]{1,32}$/.test(href)) return href.slice(1);
    }
    const text = normalizeText(nameBlock.textContent);
    const mention = text.match(/@([A-Za-z0-9_]{1,32})/);
    if (mention) return mention[1];
  }
  if (statusPath) {
    const m = statusPath.match(/^\/([A-Za-z0-9_]{1,32})\/status\/\d+$/);
    if (m) return m[1];
  }
  return undefined;
}


function extractTweetText(article) {
  const textNode = article.querySelector('[data-testid="tweetText"]') ?? article.querySelector('[lang]');
  const text = normalizeText(textNode?.textContent);
  const hasShowMore = !!article.querySelector('[data-testid="tweet-text-show-more-link"]');
  if (!text) return hasShowMore ? "推文内容较长，请打开原文查看" : "";
  return hasShowMore ? `${text} ...` : text;
}


function parseArticles(root, origin) {
  const entries = [];
  const seen = new Set();
  const articles = root.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
  for (const article of articles) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    let statusPath = null;
    for (const a of links) {
      const p = statusPathFromHref(a.getAttribute("href"));
      if (p) {
        statusPath = p;
        break;
      }
    }
    if (!statusPath || seen.has(statusPath)) continue;
    seen.add(statusPath);
    const link = new URL(statusPath, origin).href;
    const text = extractTweetText(article);
    const author = extractAuthor(article, statusPath);
    const pubDate = article.querySelector("time[datetime]")?.getAttribute("datetime") || undefined;
    entries.push({ link, text, author, pubDate });
  }
  return entries;
}


function extractEntriesFromJson(data, origin) {
  if (typeof data !== "object" || data == null) return [];
  const entries = [];
  const str = JSON.stringify(data);
  const seen = new Set();
  const matches = str.match(/\/([A-Za-z0-9_]{1,32})\/status\/(\d+)/g) || [];
  for (const raw of matches) {
    const m = raw.match(/^\/([A-Za-z0-9_]{1,32})\/status\/(\d+)$/);
    if (!m) continue;
    const statusPath = `/${m[1]}/status/${m[2]}`;
    if (seen.has(statusPath)) continue;
    seen.add(statusPath);
    entries.push({ link: new URL(statusPath, origin).href, text: "", author: m[1], pubDate: undefined });
  }
  return entries;
}


function entriesToFeedItems(entries) {
  return entries.map(({ link, text, author, pubDate }) => ({
    guid: createHash("sha256").update(link).digest("hex"),
    title: text || undefined,
    link,
    pubDate: pubDate ? new Date(pubDate) : new Date(),
    author,
    summary: text || undefined,
  }));
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 6000 });
  const root = parse(html);
  const origin = getOrigin(finalUrl);

  let entries = parseArticles(root, origin);
  if (entries.length > 0) return entriesToFeedItems(entries);

  const scripts = root.querySelectorAll('script[type="application/json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      const fromJson = extractEntriesFromJson(data, origin);
      if (fromJson.length > 0) {
        entries = fromJson;
        break;
      }
    } catch {
      // ignore broken JSON blocks
    }
  }
  if (entries.length > 0) return entriesToFeedItems(entries);

  const bodyText = normalizeText(root.textContent).toLowerCase();
  const isErrorPage = bodyText.includes("something went wrong") || bodyText.includes("try again");
  const message = isErrorPage
    ? "X 页面暂不可用（可能被风控或需登录），请稍后重试或切换为有头模式并确认登录态"
    : "未解析到推文条目，可能被风控或需登录";
  throw new Error(`[X] ${message}`);
}


async function checkAuth(page, _url) {
  try {
    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/i/flow/login') || currentUrl.includes('/i/flow/signup');
    if (isLoginPage) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newUrl = page.url();
      if (newUrl !== currentUrl && !newUrl.includes('/i/flow/login') && !newUrl.includes('/i/flow/signup')) {
        return true;
      }
    }
    const accountSwitcher = await page.$('[data-testid="SideNav_AccountSwitcher_Button"]');
    const homeLink = await page.$('[data-testid="AppTabBar_Home_Link"]');
    const exploreLink = await page.$('[data-testid="AppTabBar_Explore_Link"]');
    const notificationsLink = await page.$('[data-testid="AppTabBar_Notifications_Link"]');
    if (accountSwitcher || homeLink || exploreLink || notificationsLink) {
      return true;
    }
    const tweet = await page.$('article[data-testid="tweet"]');
    const timeline = await page.$('[data-testid="primaryColumn"]');
    if (tweet || timeline) {
      return true;
    }
    const userProfilePattern = /^https:\/\/(x\.com|twitter\.com)\/[^/]+$/;
    if (currentUrl.includes('/home') || currentUrl.includes('/explore') || currentUrl.includes('/notifications') || userProfilePattern.test(currentUrl)) {
      return true;
    }
    const loginPrompt = await page.$('[data-testid="login"]');
    const restrictedContent = await page.$('[data-testid="error"]');
    if (loginPrompt || restrictedContent) {
      return false;
    }
    return false;
  } catch {
    return false;
  }
}


export default {
  id: "x",
  listUrlPattern: "https://x.com/{username}",
  fetchItems,
  checkAuth,
  loginUrl: "https://x.com",
  domain: "x.com",
  loginTimeoutMs: 60 * 1000,
  pollIntervalMs: 2000,
};
