// 语鲸（lingowhale）站点插件：channels 列表（channel_id 匹配）、登录态通过 /home 用户元素检查

import { parse } from "node-html-parser";


const LINGOWHALE_ORIGIN = "https://lingowhale.com";
const HOME_URL = "https://lingowhale.com/home";


function getOrigin(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return LINGOWHALE_ORIGIN;
  }
}


/** 从卡片节点查找链接：优先查找内部的 a 标签，如果没有则查找 data-href、data-url、data-link 等属性，最后尝试查找父级链接 */
function getLinkFromCard(card, origin) {
  // 先查找内部的 a 标签
  const linkEl = card.querySelector("a[href]");
  if (linkEl) {
    const href = linkEl.getAttribute("href")?.trim();
    if (href) return new URL(href.replace(/&amp;/g, "&"), origin).href;
  }
  // 查找各种 data 属性
  const dataAttrs = ["data-href", "data-url", "data-link", "data-to", "data-path"];
  for (const attr of dataAttrs) {
    const value = card.getAttribute(attr);
    if (value) {
      try {
        return new URL(value.replace(/&amp;/g, "&"), origin).href;
      } catch {
        // 如果不是完整 URL，尝试作为路径
        if (value.startsWith("/")) {
          return new URL(value, origin).href;
        }
      }
    }
  }
  // 查找 onclick 属性中的 URL
  const onclick = card.getAttribute("onclick");
  if (onclick) {
    const urlMatch = onclick.match(/['"](https?:\/\/[^'"]+)['"]/);
    if (urlMatch) {
      return urlMatch[1];
    }
    const pathMatch = onclick.match(/['"](\/[^'"]+)['"]/);
    if (pathMatch) {
      return new URL(pathMatch[1], origin).href;
    }
  }
  // 查找父级链接（向上查找）
  let el = card.parentNode;
  let depth = 0;
  while (el && el.tagName !== "BODY" && depth < 5) {
    if (el.tagName === "A") {
      const href = el.getAttribute("href")?.trim();
      if (href) return new URL(href.replace(/&amp;/g, "&"), origin).href;
    }
    // 也检查父级的 data 属性
    for (const attr of dataAttrs) {
      const value = el.getAttribute?.(attr);
      if (value) {
        try {
          return new URL(value.replace(/&amp;/g, "&"), origin).href;
        } catch {
          if (value.startsWith("/")) {
            return new URL(value, origin).href;
          }
        }
      }
    }
    el = el.parentNode;
    depth++;
  }
  return null;
}


/** 频道列表解析：按卡片结构（封面图 + 标题 + 描述 + 元信息）提取条目 */
function parser(html, url) {
  const root = parse(html);
  const origin = getOrigin(url);
  // 查找所有卡片：匹配包含 cursor-pointer、border、rounded 的 div
  // 使用更精确的选择器，匹配实际的卡片结构
  const cards = root.querySelectorAll('div[class*="cursor-pointer"][class*="border"][class*="rounded"]');
  const entries = [];
  for (const card of cards) {
    // 确保是真正的卡片（有图片和内容区域）
    const hasImage = card.querySelector('img');
    const hasTitle = card.querySelector('div[class*="text-base"][class*="font-medium"]');
    if (!hasImage || !hasTitle) {
      continue;
    }
    // 获取链接
    let link = getLinkFromCard(card, origin);
    // 如果找不到链接，尝试查找父级或兄弟元素的链接
    if (!link) {
      // 查找父级 ul 或容器中的链接
      let parent = card.parentNode;
      while (parent && parent.tagName !== "BODY") {
        const parentLink = parent.querySelector("a[href]");
        if (parentLink) {
          const href = parentLink.getAttribute("href")?.trim();
          if (href) {
            link = new URL(href.replace(/&amp;/g, "&"), origin).href;
            break;
          }
        }
        parent = parent.parentNode;
      }
    }
    // 提取标题
    const titleEl = card.querySelector('div[class*="text-base"][class*="font-medium"]');
    const title = (titleEl?.textContent ?? "").trim() || "未命名";
    // 如果找不到链接，跳过这个条目（RSS 需要有效的链接）
    if (!link) {
      continue;
    }
    // 提取描述（副标题）
    const descEl = card.querySelector('div[class*="leading-5.5"][class*="text-sm"]');
    const description = (descEl?.textContent ?? "").trim() || title;
    // 提取作者（从元信息行）
    const metaRow = card.querySelector('div[class*="text-neutral-400"][class*="mt-3"]');
    let author = undefined;
    if (metaRow) {
      const authorSpan = metaRow.querySelector("span");
      if (authorSpan) {
        author = authorSpan.textContent?.trim() || undefined;
      } else {
        // 如果没有 span，尝试从第一个 div 获取
        const firstDiv = metaRow.querySelector("div");
        if (firstDiv) {
          const text = firstDiv.textContent?.trim() || "";
          // 提取作者名（去掉后面的字数等信息）
          author = text.split(/\s+/)[0] || undefined;
        }
      }
    }
    entries.push({ title, link, description, content: "", author });
  }
  return entries;
}


/** 检查是否已登录：打开 /home 页面，根据用户区域判断。已登录有头像 img 或「用户_」「****」文案，未登录有「立即登录」 */
async function checkAuth(page, _url) {
  try {
    const current = page.url();
    if (!current.startsWith(HOME_URL)) {
      await page.goto(HOME_URL, { waitUntil: "networkidle2" });
    }
    const notLoggedIn = await page.evaluate(() => {
      /* global document */
      return document.body?.innerText?.includes("立即登录") ?? false;
    });
    if (notLoggedIn) return false;
    const loggedIn = await page.evaluate(() => {
      /* global document */
      const hasAvatar = document.querySelector('img[src*="user_avatar.jpg"], img[src*="lingoreader/avatar"]');
      const text = document.body?.innerText ?? "";
      const hasUserHint = text.includes("用户_") || /\d{3}\*\*\*\*\d{4}/.test(text);
      return !!(hasAvatar || hasUserHint);
    });
    return loggedIn;
  } catch {
    return false;
  }
}


export default {
  id: "lingowhale",
  listUrlPattern: "https://lingowhale.com/channels",
  parser,
  extractor: null,
  checkAuth,
  loginUrl: "https://lingowhale.com/",
  domain: "lingowhale.com",
  loginTimeoutMs: 30 * 1000,
  pollIntervalMs: 2000,
};
