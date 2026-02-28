// 小红书站点插件：用户主页列表抓取、笔记详情提取、认证流程

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";


const XHS_ORIGIN = "https://www.xiaohongshu.com";


function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return XHS_ORIGIN;
  }
}


function buildExploreLinkWithXsec(profileHref, origin) {
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


function parseListHtml(html, url) {
  const root = parse(html);
  const origin = getOrigin(url);
  const feed = root.querySelector("#userPostedFeeds");
  if (!feed) return [];
  const sections = feed.querySelectorAll("section[data-v-79abd645][data-index]");
  const items = [];
  for (const section of sections) {
    const profileWithToken = section.querySelector('a[href*="xsec_token="]');
    const profileHref = profileWithToken?.getAttribute("href")?.trim();
    let link;
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
    const author = (authorEl?.textContent ?? "").trim() || undefined;
    items.push({
      guid: createHash("sha256").update(link).digest("hex"),
      title,
      link,
      pubDate: new Date(),
      author,
      summary: title,
    });
  }
  return items;
}


function descToMarkdown(descEl) {
  if (!descEl) return "";
  const noteText = descEl.querySelector(".note-text");
  if (!noteText) {
    return (descEl.textContent ?? "").trim();
  }
  const parts = [];
  for (const node of noteText.childNodes) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").trim();
      if (text) parts.push(text);
    } else if (node.nodeType === 1) {
      const el = node;
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
  if (!result) result = (descEl.textContent ?? "").trim();
  if (!result && descEl.parentNode) result = (descEl.parentNode.textContent ?? "").trim();
  return result;
}


function extractUrl(val) {
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


function collectNoteImages(root) {
  const urls = [];
  const seen = new Set();
  const add = (url) => {
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


function parseNoteDate(dateEl) {
  const text = (dateEl?.textContent ?? "").trim();
  if (!text) return undefined;
  const now = new Date();
  const published = text.match(/发布于\s*(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (published) {
    const [, y, m, d] = published;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00.000Z`);
  }
  const edited = text.match(/编辑于\s*(\d{1,2})-(\d{1,2})/);
  if (edited) {
    const [, m, d] = edited;
    let year = now.getFullYear();
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    const built = new Date(year, month - 1, day);
    if (built > now) year -= 1;
    return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z`);
  }
  const relativeMatch = text.match(/(编辑于|发布于)\s*(\d+)\s*(分钟|小时|天|周|个月)前/);
  if (relativeMatch) {
    const [, , amount, unit] = relativeMatch;
    const num = parseInt(amount, 10);
    const msMap = { 分钟: 60_000, 小时: 3_600_000, 天: 86_400_000, 周: 604_800_000, 个月: 2_592_000_000 };
    return new Date(now.getTime() - (num * (msMap[unit] ?? 0)));
  }
  return undefined;
}


function extractDetailHtml(html) {
  const root = parse(html);
  // 作者
  let authorEl = null;
  const authorSelectors = [
    ".author .info a.name .username",
    ".info a.name .username",
    ".info .username",
    "a.name .username",
    ".author-container .username",
    ".author .username",
  ];
  for (const sel of authorSelectors) {
    authorEl = root.querySelector(sel);
    if (authorEl) break;
  }
  if (!authorEl) {
    const containers = root.querySelectorAll(".author, .author-container, .interaction-container, .info");
    for (const c of containers) {
      const u = c.querySelector("a.name .username") ?? c.querySelector(".username");
      if (u) { authorEl = u; break; }
    }
  }
  if (!authorEl) {
    for (const u of root.querySelectorAll(".username")) {
      let p = u.parentNode ?? null;
      for (let i = 0; i < 5 && p; i++) {
        const cls = p.getAttribute?.("class") || "";
        if (typeof cls === "string" && (cls.includes("name") || cls.includes("info") || cls.includes("author"))) {
          authorEl = u; break;
        }
        p = p.parentNode ?? null;
      }
      if (authorEl) break;
    }
  }
  const author = (authorEl?.textContent ?? "").trim() || undefined;
  // 标题
  const titleEl = root.querySelector("#detail-title") ?? root.querySelector(".note-content .title") ?? root.querySelector("h1.title");
  const title = (titleEl?.textContent ?? "").trim() || undefined;
  // 正文
  const descEl = root.querySelector("#detail-desc") ?? root.querySelector(".note-content .desc") ?? root.querySelector(".desc");
  const descText = descToMarkdown(descEl);
  const imgUrls = collectNoteImages(root);
  const imgMd = imgUrls.length > 0 ? imgUrls.map((u) => `\n\n![](${u})`).join("") : "";
  let content = (descText + imgMd).trim() || title || imgMd.trim() || undefined;
  // 发布时间
  let dateEl = root.querySelector(".bottom-container span.date") ?? root.querySelector(".bottom-container .date");
  if (!dateEl) {
    for (const span of root.querySelectorAll("span")) {
      if (/(编辑于|发布于)/.test(span.textContent ?? "")) { dateEl = span; break; }
    }
  }
  const pubDate = parseNoteDate(dateEl);
  return { author, title, content, pubDate };
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId);
  return parseListHtml(html, finalUrl);
}


async function enrichItem(item, ctx) {
  const { html } = await ctx.fetchHtml(item.link);
  const detail = extractDetailHtml(html);
  return {
    ...item,
    author: detail.author ?? item.author,
    title: detail.title ?? item.title,
    content: detail.content ? `<p>${detail.content.replace(/\n\n/g, "</p><p>")}</p>` : undefined,
    pubDate: detail.pubDate ?? item.pubDate,
  };
}


async function checkAuth(page, _url) {
  try {
    const loginButton = await page.$(".reds-button-new.login-btn.large.primary");
    return loginButton == null;
  } catch {
    return false;
  }
}


export default {
  id: "xiaohongshu",
  listUrlPattern: "https://xiaohongshu.com/user/profile/{userId}",
  fetchItems,
  enrichItem,
  checkAuth,
  loginUrl: "https://www.xiaohongshu.com/",
  domain: "xiaohongshu.com",
  loginTimeoutMs: 30 * 1000,
  pollIntervalMs: 2000,
};
