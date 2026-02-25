// Google Search 插件：将搜索结果页转换为 FeedItem 列表（不含 enrich）

import { parse } from "node-html-parser";
import { createHash } from "node:crypto";

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function isGoogleHost(hostname) {
  return /^([a-z0-9-]+\.)*google\.[a-z.]+$/i.test(hostname);
}

function resolveResultLink(rawHref, pageUrl) {
  if (!rawHref) return null;
  const href = rawHref.trim();
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;

  let url;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }

  if (isGoogleHost(url.hostname) && url.pathname === "/url") {
    const q = url.searchParams.get("q") ?? url.searchParams.get("url");
    if (!q) return null;
    try {
      const target = new URL(q);
      return /^https?:$/i.test(target.protocol) ? target.href : null;
    } catch {
      return null;
    }
  }

  if (!/^https?:$/i.test(url.protocol)) return null;
  if (isGoogleHost(url.hostname)) return null;
  return url.href;
}

function closestAnchor(node) {
  let cur = node;
  while (cur) {
    if (cur.tagName?.toLowerCase() === "a") return cur;
    cur = cur.parentNode ?? null;
  }
  return null;
}

function extractSnippet(startNode) {
  const snippetSelectors = [".VwiC3b", ".IsZvec", ".MUxGbd", ".lyLwlc"];
  let cur = startNode;
  for (let i = 0; i < 6 && cur; i += 1) {
    for (const sel of snippetSelectors) {
      const el = cur.querySelector?.(sel);
      const text = normalizeText(el?.textContent);
      if (text) return text;
    }
    cur = cur.parentNode ?? null;
  }
  return "";
}

function looksLikeBlockedPage(root, html, finalUrl) {
  const text = normalizeText(root.textContent).toLowerCase();
  const body = (html ?? "").toLowerCase();
  if (finalUrl.includes("/sorry/")) return true;
  if (root.querySelector("#captcha-form, #recaptcha, .g-recaptcha")) return true;
  if (body.includes("/httpservice/retry/enablejs")) return true;
  if (body.includes("id=\"yvlrue\"") || body.includes("if you're having trouble accessing google search")) return true;
  if (body.includes("sg_rel")) return true;
  return text.includes("about this page") || text.includes("unusual traffic") || text.includes("captcha");
}

async function checkAuth(page, _url) {
  try {
    const currentUrl = page.url() || "";
    if (currentUrl.includes("/sorry/") || currentUrl.includes("/httpservice/retry/enablejs")) return false;

    const blockedDom = await page.$("#captcha-form, #recaptcha, .g-recaptcha, #yvlrue");
    if (blockedDom) return false;

    const bodyText = await page.evaluate(() => (document.body?.innerText ?? "").toLowerCase());
    if (
      bodyText.includes("unusual traffic") ||
      bodyText.includes("about this page") ||
      bodyText.includes("captcha") ||
      bodyText.includes("if you're having trouble accessing google search")
    ) {
      return false;
    }

    // 首页或搜索页出现 q 输入框即可认为当前会话可用；若被风控会在上面的分支提前返回 false。
    const searchBox = await page.$('textarea[name="q"], input[name="q"]');
    return !!searchBox;
  } catch {
    return false;
  }
}

function parseFromResultBlocks(root, pageUrl) {
  const resultBlocks = root.querySelectorAll("#rso .MjjYud .A6K0A, #rso .MjjYud .tF2Cxc");
  const seen = new Set();
  const items = [];

  for (const block of resultBlocks) {
    const anchor =
      block.querySelector('a[jsname="UWckNb"][href]') ??
      block.querySelector(".yuRUbf a[href]") ??
      block.querySelector("a[href]");
    const link = resolveResultLink(anchor?.getAttribute("href"), pageUrl);
    if (!link || seen.has(link)) continue;

    const titleNode =
      block.querySelector("h3.LC20lb, h3.DKV0Md, h3.MBeuO, h3") ??
      anchor?.querySelector?.("h3");
    const title = normalizeText(titleNode?.textContent);
    if (!title) continue;

    seen.add(link);
    const summary = extractSnippet(block) || extractSnippet(titleNode ?? block) || title;
    items.push({
      guid: createHash("sha256").update(link).digest("hex"),
      title,
      link,
      pubDate: new Date(),
      author: "Google Search",
      summary,
    });
  }

  return items;
}

function parseFromHeadingFallback(root, pageUrl) {
  const seen = new Set();
  const items = [];
  const titles = root.querySelectorAll("h3");
  for (const h3 of titles) {
    const title = normalizeText(h3.textContent);
    if (!title) continue;
    const anchor = closestAnchor(h3);
    const link = resolveResultLink(anchor?.getAttribute("href"), pageUrl);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    const summary = extractSnippet(h3) || title;
    items.push({
      guid: createHash("sha256").update(link).digest("hex"),
      title,
      link,
      pubDate: new Date(),
      author: "Google Search",
      summary,
    });
  }
  return items;
}

async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 2500 });
  const root = parse(html);
  const pageUrl = new URL(finalUrl);

  const fromBlocks = parseFromResultBlocks(root, pageUrl);
  const items = fromBlocks.length > 0 ? fromBlocks : parseFromHeadingFallback(root, pageUrl);

  if (items.length === 0) {
    if (looksLikeBlockedPage(root, html, finalUrl)) {
      throw new Error("[google] 命中 Google 验证页（reCAPTCHA/风控），当前会话无法稳定抓取搜索结果");
    }
    throw new Error("[google] 未解析到搜索结果，页面结构可能已变化");
  }
  return items;
}

export default {
  id: "google-search",
  listUrlPattern: /^https?:\/\/(www\.)?google\.[^/]+\/search(\?.*)?$/i,
  fetchItems,
  checkAuth,
  loginUrl: "https://www.google.com/",
  domain: "google.com",
  loginTimeoutMs: 5 * 60 * 1000,
  pollIntervalMs: 2000,
};
