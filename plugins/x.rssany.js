// X (Twitter) 站点插件：用户主页列表解析、推文详情提取、认证流程

import { parse } from "node-html-parser";


const X_ORIGIN = "https://x.com";


// 从 URL 提取 origin
function getOrigin(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return X_ORIGIN;
  }
}


// 检测是否是 repost（转发）
function isRepost(article) {
  if (!article) return false;
  const socialContext = article.querySelector('[data-testid="socialContext"]');
  if (socialContext) {
    const text = (socialContext.textContent ?? "").toLowerCase();
    if (text.includes("repost") || text.includes("retweet") || text.includes("转推")) {
      return true;
    }
  }
  const allSpans = article.querySelectorAll("span");
  for (const span of allSpans) {
    const text = (span.textContent ?? "").toLowerCase();
    if (text.includes("repost") || text.includes("retweet") || text.includes("转推")) {
      return true;
    }
  }
  const nestedArticles = article.querySelectorAll('article[data-testid="tweet"]');
  if (nestedArticles.length > 1) {
    const outerText = (article.textContent ?? "").toLowerCase();
    if (outerText.includes("repost") || outerText.includes("retweet")) {
      return true;
    }
  }
  return false;
}


// 提取 repost 信息（转发者和原始作者）
function extractRepostInfo(article) {
  if (!article) return { reposter: "", originalAuthor: "" };
  const socialContext = article.querySelector('[data-testid="socialContext"]');
  let reposter = "";
  let originalAuthor = "";
  if (socialContext) {
    const contextText = socialContext.textContent?.trim() || "";
    const reposterMatch = contextText.match(/(\w+)\s+(?:repost|retweet|转推)/i);
    if (reposterMatch) {
      reposter = reposterMatch[1];
    }
  }
  const nestedArticles = article.querySelectorAll('article[data-testid="tweet"]');
  if (nestedArticles.length > 0) {
    const nestedArticle = nestedArticles[nestedArticles.length - 1];
    const originalAuthorEl = nestedArticle.querySelector('[data-testid="User-Name"]') ?? nestedArticle.querySelector('a[href^="/"]');
    if (originalAuthorEl) {
      const authorText = originalAuthorEl.textContent?.trim() || "";
      const authorMatch = authorText.match(/@?(\w+)/);
      if (authorMatch) originalAuthor = authorMatch[1];
    }
  }
  const outerAuthorEl = article.querySelector('[data-testid="User-Name"]') ?? article.querySelector('a[href^="/"]');
  if (outerAuthorEl && !reposter) {
    const authorText = outerAuthorEl.textContent?.trim() || "";
    const authorMatch = authorText.match(/@?(\w+)/);
    if (authorMatch) reposter = authorMatch[1];
  }
  if (!reposter) {
    const allLinks = article.querySelectorAll('a[href^="/"]');
    for (const link of allLinks) {
      const href = link.getAttribute("href");
      if (href && href.match(/^\/\w+$/)) {
        const username = href.replace("/", "");
        if (username !== originalAuthor) {
          reposter = username;
          break;
        }
      }
    }
  }
  return { reposter, originalAuthor };
}


// 解析用户主页的推文列表
function parser(html, url) {
  const root = parse(html);
  const origin = getOrigin(url);
  const entries = [];
  const articleSelectors = [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    'div[data-testid="tweet"]',
    'article',
  ];
  let articles = [];
  for (const selector of articleSelectors) {
    articles = root.querySelectorAll(selector);
    if (articles.length > 0) break;
  }
  if (articles.length === 0) {
    const scriptTags = root.querySelectorAll('script[type="application/json"]');
    for (const script of scriptTags) {
      try {
        const data = JSON.parse(script.textContent || "");
        if (data && typeof data === "object") {
          const entriesData = extractEntriesFromJson(data, origin);
          if (entriesData.length > 0) {
            entries.push(...entriesData);
          }
        }
      } catch {
        continue;
      }
    }
  }
  for (const article of articles) {
    const linkEl = article.querySelector('a[href*="/status/"]');
    if (!linkEl) continue;
    const href = linkEl.getAttribute("href");
    if (!href) continue;
    const link = href.startsWith("http") ? href : new URL(href, origin).href;
    const isRepostTweet = isRepost(article);
    let textEl = article.querySelector('[data-testid="tweetText"]') ?? article.querySelector('[lang]');
    if (isRepostTweet && !textEl) {
      const nestedArticle = article.querySelector('article[data-testid="tweet"]');
      if (nestedArticle) {
        textEl = nestedArticle.querySelector('[data-testid="tweetText"]') ?? nestedArticle.querySelector('[lang]');
      }
    }
    let title = (textEl?.textContent ?? "").trim().slice(0, 200) || "推文";
    const authorEl = article.querySelector('[data-testid="User-Name"]') ?? article.querySelector('a[href^="/"]');
    let author = "";
    if (authorEl) {
      const authorText = authorEl.textContent?.trim() || "";
      const authorMatch = authorText.match(/@?(\w+)/);
      if (authorMatch) author = authorMatch[1];
    }
    if (isRepostTweet) {
      const repostInfo = extractRepostInfo(article);
      if (repostInfo.reposter && repostInfo.originalAuthor) {
        title = `RT @${repostInfo.originalAuthor}: ${title}`;
        author = repostInfo.reposter;
      } else if (repostInfo.reposter) {
        title = `RT @${author || repostInfo.reposter}: ${title}`;
        author = repostInfo.reposter;
      } else {
        title = `RT @${author}: ${title}`;
      }
    }
    const timeEl = article.querySelector('time[datetime]');
    const pubDate = timeEl?.getAttribute("datetime") || undefined;
    entries.push({ title, link, description: title, content: "", author, published: pubDate });
  }
  if (entries.length === 0) {
    const metaTitle = root.querySelector("title")?.textContent?.trim() || "";
    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
    if (metaTitle || metaDesc) {
      entries.push({
        title: metaTitle || "X (Twitter)",
        link: url,
        description: metaDesc || metaTitle,
        content: "",
        author: undefined,
      });
    }
  }
  return entries;
}


// 从 JSON 数据中提取推文条目
function extractEntriesFromJson(data, origin) {
  const entries = [];
  if (typeof data !== "object" || data === null) return entries;
  const str = JSON.stringify(data);
  const tweetIdMatches = str.match(/\/status\/(\d+)/g);
  if (tweetIdMatches) {
    const seenIds = new Set();
    for (const match of tweetIdMatches) {
      const tweetId = match.replace("/status/", "");
      if (seenIds.has(tweetId)) continue;
      seenIds.add(tweetId);
      const usernameMatch = str.match(new RegExp(`"screen_name":"([^"]+)"`));
      const username = usernameMatch ? usernameMatch[1] : "";
      const link = `${origin}/${username}/status/${tweetId}`;
      entries.push({
        title: "推文",
        link,
        description: "推文",
        content: "",
        author: username,
      });
    }
  }
  return entries;
}


// 检查是否已登录
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
  detailUrlPattern: "https://x.com/{username}/status/{tweetId}",
  parser,
  checkAuth,
  loginUrl: "https://x.com",
  domain: "x.com",
  loginTimeoutMs: 60 * 1000,
  pollIntervalMs: 2000,
};
