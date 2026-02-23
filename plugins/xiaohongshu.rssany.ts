// 小红书站点插件：用户主页列表解析、笔记详情提取、认证流程

import { parse, HTMLElement as NHTMLElement } from "node-html-parser";
import type { Page } from "puppeteer-core";
import type { Site } from "../src/sites/types.js";
import type { ParsedEntry } from "../src/parser/types.js";


const XHS_ORIGIN = "https://www.xiaohongshu.com";


function getOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return XHS_ORIGIN;
  }
}


function buildExploreLinkWithXsec(profileHref: string, origin: string): string | null {
  try {
    const fullUrl = new URL(profileHref.replace(/&amp;/g, "&"), origin);
    const pathSegs = fullUrl.pathname.split("/").filter(Boolean);
    const noteId = pathSegs[pathSegs.length - 1];
    if (!noteId || !/^[0-9a-f]+$/i.test(noteId)) return null;
    const token = fullUrl.searchParams.get("xsec_token");
    const source = fullUrl.searchParams.get("xsec_source") ?? "pc_user";
    if (!token) return null;
    const explore = new URL(`/explore/${noteId}`, origin);
    explore.searchParams.set("xsec_token", token);
    explore.searchParams.set("xsec_source", source);
    return explore.href;
  } catch {
    return null;
  }
}


function parser(html: string, url: string) {
  const root = parse(html);
  const origin = getOrigin(url);
  const feed = root.querySelector("#userPostedFeeds");
  if (!feed) return [];
  const sections = feed.querySelectorAll("section[data-v-79abd645][data-index]");
  const entries: ParsedEntry[] = [];
  for (const section of sections) {
    const profileWithToken = section.querySelector('a[href*="xsec_token="]');
    const profileHref = profileWithToken?.getAttribute("href")?.trim();
    let link: string | undefined;
    if (profileHref && profileHref.includes("/user/profile/")) {
      const withXsec = buildExploreLinkWithXsec(profileHref, origin);
      if (withXsec) link = withXsec;
      else link = new URL(profileHref.replace(/&amp;/g, "&"), origin).href;
    } else {
      const linkEl = section.querySelector('a[href^="/explore/"]');
      const href = linkEl?.getAttribute("href")?.trim();
      if (!href) continue;
      link = new URL(href, origin).href;
    }
    const titleEl = section.querySelector("span[data-v-51ec0135]");
    const title = (titleEl?.textContent ?? "").trim() || "笔记";
    const authorEl = section.querySelector('a[aria-current="page"] span');
    const author = (authorEl?.textContent ?? "").trim() || "";
    entries.push({ title, link, description: title, content: "", author });
  }
  return entries;
}


function descToMarkdown(descEl: ReturnType<typeof parse> | null): string {
  if (!descEl) return "";
  const noteText = descEl.querySelector(".note-text");
  if (!noteText) {
    const text = (descEl.textContent ?? "").trim();
    return text;
  }
  const parts: string[] = [];
  for (const node of noteText.childNodes) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").trim();
      if (text) parts.push(text);
    } else if (node.nodeType === 1) {
      const el = node as NHTMLElement;
      const tagName = el.tagName?.toLowerCase();
      if (tagName === "img") {
        const alt = el.getAttribute("alt") || "";
        if (alt) parts.push(alt);
      } else if (tagName === "a" && el.classList?.contains("tag")) {
        const txt = (el.textContent ?? "").trim();
        if (txt) parts.push(txt);
      } else {
        const txt = (el.textContent ?? "").trim();
        if (txt) parts.push(txt);
      }
    }
  }
  let result = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!result) {
    result = (descEl.textContent ?? "").trim();
  }
  if (!result && descEl.parentNode) {
    result = (descEl.parentNode.textContent ?? "").trim();
  }
  return result;
}


function extractUrl(val: string | null): string | null {
  if (!val) return null;
  const decoded = val.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const m = decoded.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/);
  if (m) {
    let url = m[1].trim();
    url = url.replace(/^["']|["']$/g, "");
    return url || null;
  }
  return null;
}


function collectNoteImages(root: ReturnType<typeof parse>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | null) => {
    const u = (url || "").trim();
    if (u && !seen.has(u) && (u.startsWith("http") || u.startsWith("//"))) {
      seen.add(u);
      urls.push(u.startsWith("//") ? "https:" + u : u);
    }
  };
  const imgs = root.querySelectorAll(".img-container img, .note-slider-img img, .note-slider img, .xhs-webplayer img, .note-content img, [class*='note-detail'] img, .media-container img, .video-player-media img");
  for (const el of imgs) {
    const src = el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-lazy-src");
    if (src) add(src);
  }
  const posterSelectors = ["xg-poster", "[class*='xgplayer-poster']", ".player-container [style*='background-image']", ".render-ssr-image [style*='background-image']", "[class*='player-container'] [style*='background-image']", ".video-player-media [style*='background-image']", ".media-container [style*='background-image']"];
  for (const sel of posterSelectors) {
    const els = root.querySelectorAll(sel);
    for (const el of els) {
      const style = el.getAttribute("style");
      const url = extractUrl(style ?? "");
      if (url) add(url);
    }
  }
  const anyBg = root.querySelectorAll("[style*='background-image']");
  for (const el of anyBg) {
    const url = extractUrl(el.getAttribute("style") ?? "");
    if (url && (url.includes("xhscdn") || url.includes("sns-webpic") || url.includes("sns-avatar"))) add(url);
  }
  return urls;
}


function parseNoteDate(dateEl: ReturnType<typeof parse> | null): string | undefined {
  const text = (dateEl?.textContent ?? "").trim();
  if (!text) return undefined;
  const now = new Date();
  const published = text.match(/发布于\s*(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (published) {
    const [, y, m, d] = published;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00.000Z`;
  }
  const edited = text.match(/编辑于\s*(\d{1,2})-(\d{1,2})/);
  if (edited) {
    const [, m, d] = edited;
    let year = now.getFullYear();
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    const built = new Date(year, month - 1, day);
    if (built > now) year -= 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z`;
  }
  const relativeTime = text.match(/编辑于\s*(\d+)\s*(分钟|小时|天|周|个月)前/);
  if (relativeTime) {
    const [, amount, unit] = relativeTime;
    const num = parseInt(amount, 10);
    let ms = 0;
    if (unit === "分钟") ms = num * 60 * 1000;
    else if (unit === "小时") ms = num * 60 * 60 * 1000;
    else if (unit === "天") ms = num * 24 * 60 * 60 * 1000;
    else if (unit === "周") ms = num * 7 * 24 * 60 * 60 * 1000;
    else if (unit === "个月") ms = num * 30 * 24 * 60 * 60 * 1000;
    const date = new Date(now.getTime() - ms);
    return date.toISOString();
  }
  const publishedRelative = text.match(/发布于\s*(\d+)\s*(分钟|小时|天|周|个月)前/);
  if (publishedRelative) {
    const [, amount, unit] = publishedRelative;
    const num = parseInt(amount, 10);
    let ms = 0;
    if (unit === "分钟") ms = num * 60 * 1000;
    else if (unit === "小时") ms = num * 60 * 60 * 1000;
    else if (unit === "天") ms = num * 24 * 60 * 60 * 1000;
    else if (unit === "周") ms = num * 7 * 24 * 60 * 60 * 1000;
    else if (unit === "个月") ms = num * 30 * 24 * 60 * 60 * 1000;
    const date = new Date(now.getTime() - ms);
    return date.toISOString();
  }
  return undefined;
}


function extractor(html: string, _url: string) {
  const root = parse(html);
  let authorEl: ReturnType<typeof parse> | null = null;
  const authorSelectors = [
    ".author .info a.name .username",
    ".author .author-wrapper .info a.name .username",
    ".info a.name .username",
    ".info .username",
    "a.name .username",
    ".author-container .username",
    ".interaction-container .username",
    ".author-wrapper .username",
    ".author .username",
  ];
  for (const selector of authorSelectors) {
    authorEl = root.querySelector(selector);
    if (authorEl) break;
  }
  if (!authorEl) {
    const authorContainers = root.querySelectorAll(".author, .author-container, .interaction-container");
    for (const container of authorContainers) {
      const nameLink = container.querySelector("a.name");
      if (nameLink) {
        const username = nameLink.querySelector(".username");
        if (username) {
          authorEl = username;
          break;
        }
      }
      const username = container.querySelector(".username");
      if (username) {
        authorEl = username;
        break;
      }
    }
  }
  if (!authorEl) {
    const infoContainers = root.querySelectorAll(".info");
    for (const container of infoContainers) {
      const nameLink = container.querySelector("a.name");
      if (nameLink) {
        const username = nameLink.querySelector(".username");
        if (username) {
          authorEl = username;
          break;
        }
      }
    }
  }
  if (!authorEl) {
    const nameLinks = root.querySelectorAll("a.name");
    for (const link of nameLinks) {
      const username = link.querySelector(".username");
      if (username) {
        authorEl = username;
        break;
      }
    }
  }
  if (!authorEl) {
    const allUsernames = root.querySelectorAll(".username");
    for (const el of allUsernames) {
      let parent: NHTMLElement | null = el.parentNode as NHTMLElement | null;
      for (let i = 0; i < 5 && parent; i++) {
        const className = parent.getAttribute?.("class") || "";
        if (typeof className === "string" && (className.includes("name") || className.includes("info") || className.includes("author"))) {
          authorEl = el;
          break;
        }
        if (parent.classList?.contains("name") || parent.classList?.contains("info") || parent.classList?.contains("author")) {
          authorEl = el;
          break;
        }
        parent = parent.parentNode as NHTMLElement | null;
      }
      if (authorEl) break;
    }
  }
  const author = (authorEl?.textContent ?? "").trim() || undefined;
  let titleEl = root.querySelector("#detail-title");
  if (!titleEl) {
    titleEl = root.querySelector(".note-content .title") ?? root.querySelector("h1.title") ?? root.querySelector(".title");
  }
  const title = (titleEl?.textContent ?? "").trim() || undefined;
  const descEl = root.querySelector("#detail-desc") ?? root.querySelector(".note-content .desc") ?? root.querySelector(".desc");
  const descText = descToMarkdown(descEl);
  const imgUrls = collectNoteImages(root);
  const imgMd = imgUrls.length > 0 ? imgUrls.map((url) => `\n\n![](${url})`).join("") : "";
  let content: string | undefined = (descText + imgMd).trim();
  if (!content && title) {
    content = title;
  }
  if (!content && imgUrls.length > 0) {
    content = imgMd.trim();
  }
  if (!content) {
    content = undefined;
  }
  let dateEl = root.querySelector(".bottom-container span.date");
  if (!dateEl) {
    dateEl = root.querySelector(".bottom-container .date") ?? root.querySelector(".note-content .date") ?? root.querySelector(".note-detail .date");
  }
  if (!dateEl) {
    const allDates = root.querySelectorAll("span.date, .date");
    for (const el of allDates) {
      const t = (el.textContent ?? "").trim();
      if (/编辑于|发布于/.test(t)) {
        dateEl = el;
        break;
      }
    }
  }
  if (!dateEl) {
    const bottomContainer = root.querySelector(".bottom-container");
    if (bottomContainer) {
      const dateInBottom = bottomContainer.querySelector("span[class*='date'], .date, [class*='date']");
      if (dateInBottom) dateEl = dateInBottom;
    }
  }
  if (!dateEl) {
    const noteContent = root.querySelector(".note-content");
    if (noteContent) {
      const dateInContent = noteContent.querySelector("span.date, .date, [class*='date']");
      if (dateInContent) {
        const t = (dateInContent.textContent ?? "").trim();
        if (/编辑于|发布于/.test(t)) dateEl = dateInContent;
      }
    }
  }
  if (!dateEl) {
    const allSpans = root.querySelectorAll("span");
    for (const span of allSpans) {
      const t = (span.textContent ?? "").trim();
      if (/编辑于\s*(\d{1,2}-\d{1,2}|\d+\s*(分钟|小时|天|周|个月)前)|发布于\s*(\d{4}-\d{1,2}-\d{1,2}|\d+\s*(分钟|小时|天|周|个月)前)/.test(t)) {
        dateEl = span;
        break;
      }
    }
  }
  const pubDate = parseNoteDate(dateEl);
  return { author, title, content, pubDate };
}


async function checkAuth(page: Page, _url: string): Promise<boolean> {
  try {
    const loginButton = await page.$(".reds-button-new.login-btn.large.primary");
    return loginButton == null;
  } catch {
    return false;
  }
}


const site: Site = {
  id: "xiaohongshu",
  listUrlPattern: /^https?:\/\/(www\.)?xiaohongshu\.com\/user\/profile\/[^/?]+(\?.*)?$/,
  detailUrlPattern: /^https?:\/\/(www\.)?xiaohongshu\.com\/explore\/[^/?]+(\?.*)?$/,
  parser,
  extractor,
  checkAuth,
  loginUrl: "https://www.xiaohongshu.com/",
  domain: "xiaohongshu.com",
  loginTimeoutMs: 30 * 1000,
  pollIntervalMs: 2000,
};

export default site;
