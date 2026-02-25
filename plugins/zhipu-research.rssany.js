// 智谱研究页插件：仅抓取列表，不做正文 enrich（兼容净化后的 HTML）

import { NodeType, parse } from "node-html-parser";
import { createHash } from "node:crypto";


const ZHIPU_RESEARCH_URL = "https://www.zhipuai.cn/zh/research";
const ZHIPU_ORIGIN = "https://www.zhipuai.cn";
const DATE_RE = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/;
const RESEARCH_TAGS = new Set(["多模态", "语言模型", "基座模型", "推理模型", "Agent", "代码模型"]);


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function parseDate(dateText) {
  if (!dateText) return undefined;
  const normalized = normalizeText(dateText);
  const m = normalized.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return undefined;
  const [, y, mm, dd] = m;
  return new Date(`${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00.000Z`);
}


function findArrayEnd(raw, startIndex) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = startIndex; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}


function extractBlogsItems(html) {
  const normalized = html.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  const marker = "\"blogsItems\":";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return [];
  const arrayStart = normalized.indexOf("[", markerIndex + marker.length);
  if (arrayStart < 0) return [];
  const arrayEnd = findArrayEnd(normalized, arrayStart);
  if (arrayEnd < 0) return [];
  const arrayRaw = normalized.slice(arrayStart, arrayEnd + 1);
  try {
    const parsed = JSON.parse(arrayRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


async function fetchRawHtml(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}


function buildItemsFromBlogsItems(blogsItems) {
  const items = [];
  for (const blog of blogsItems) {
    if (typeof blog !== "object" || blog == null) continue;
    const id = String(blog.id ?? "").trim();
    if (!id) continue;
    const title = normalizeText(blog.title_zh ?? blog.title_en ?? "");
    if (!title) continue;
    const link = `${ZHIPU_ORIGIN}/zh/research/${id}`;
    const summary = normalizeText(blog.resume_zh ?? blog.resume_en ?? "");
    const createdAt = String(blog.createAt ?? "").trim();
    const pubDate = createdAt ? new Date(createdAt) : new Date();
    const category = normalizeText(blog.tag_zh ?? blog.tag_en ?? "");
    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate: Number.isNaN(pubDate.getTime()) ? new Date() : pubDate,
      summary: summary || undefined,
      categories: category ? [category] : undefined,
    });
  }
  return items;
}


function buildTitleIdMap(blogsItems) {
  const map = new Map();
  for (const blog of blogsItems) {
    if (typeof blog !== "object" || blog == null) continue;
    const id = String(blog.id ?? "").trim();
    const title = normalizeText(blog.title_zh ?? blog.title_en ?? "");
    if (!id || !title) continue;
    map.set(title, id);
  }
  return map;
}


function isDateText(text) {
  return DATE_RE.test(normalizeText(text));
}


function uniqueTexts(texts) {
  const out = [];
  const seen = new Set();
  for (const t of texts) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}


function getLeafTexts(node) {
  const leafs = node
    .querySelectorAll("div, span, p, h1, h2, h3")
    .filter((el) => el.querySelector("div, span, p, h1, h2, h3") == null)
    .map((el) => normalizeText(el.textContent))
    .filter(Boolean)
    .filter((t) => !t.includes("没有更多"))
    .filter((t) => !t.includes("加载更多"));
  return uniqueTexts(leafs);
}


function countDateNodes(node) {
  return node
    .querySelectorAll("p")
    .map((p) => normalizeText(p.textContent))
    .filter((t) => isDateText(t))
    .length;
}


function findCardRootFromDateNode(dateNode) {
  let current = dateNode?.parentNode ?? null;
  let candidate = null;
  for (let i = 0; i < 8 && current; i += 1) {
    if (current.nodeType !== NodeType.ELEMENT_NODE) {
      current = current.parentNode ?? null;
      continue;
    }
    const dateCount = countDateNodes(current);
    if (dateCount === 1) {
      const leafs = getLeafTexts(current);
      const hasTitleCandidate = leafs.some((t) => !isDateText(t) && !RESEARCH_TAGS.has(t) && t.length >= 6);
      if (hasTitleCandidate) candidate = current;
    }
    if (dateCount > 1) break;
    current = current.parentNode ?? null;
  }
  return candidate;
}


function parseCardItem(card, dateText, titleIdMap) {
  const leafs = getLeafTexts(card);
  const category = leafs.find((t) => RESEARCH_TAGS.has(t));
  const textCandidates = leafs
    .filter((t) => !isDateText(t))
    .filter((t) => !RESEARCH_TAGS.has(t))
    .filter((t) => t !== "时间排序" && t !== "研究");
  if (textCandidates.length === 0) return null;
  const title = textCandidates[0];
  const summary = textCandidates[1];
  const id = titleIdMap.get(title);
  const link = id
    ? `${ZHIPU_ORIGIN}/zh/research/${id}`
    : `${ZHIPU_RESEARCH_URL}#${encodeURIComponent(title)}`;
  const pubDate = parseDate(dateText) ?? new Date();
  return {
    guid: hashGuid(id ? link : `${title}|${normalizeText(dateText)}`),
    title,
    link,
    pubDate,
    summary: summary || undefined,
    categories: category ? [category] : undefined,
  };
}


function buildItemsFromDom(html, titleIdMap) {
  const root = parse(html);
  const dateNodes = root.querySelectorAll("p")
    .map((p) => ({ node: p, dateText: normalizeText(p.textContent) }))
    .filter((x) => isDateText(x.dateText));
  const seen = new Set();
  const items = [];
  for (const { node, dateText } of dateNodes) {
    const card = findCardRootFromDateNode(node);
    if (!card) continue;
    const parsed = parseCardItem(card, dateText, titleIdMap);
    if (!parsed) continue;
    const key = `${parsed.title}|${parsed.pubDate.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }
  return items;
}


function buildItemsFromLeafSequence(html, titleIdMap) {
  const root = parse(html);
  const leafTexts = uniqueTexts(
    root
      .querySelectorAll("div, span, p, h1, h2, h3")
      .filter((el) => el.querySelector("div, span, p, h1, h2, h3") == null)
      .map((el) => normalizeText(el.textContent))
      .filter(Boolean)
      .filter((t) => !t.includes("没有更多"))
      .filter((t) => !t.includes("加载更多"))
      .filter((t) => t !== "研究" && t !== "时间排序")
  );

  const items = [];
  const seen = new Set();
  for (let i = 0; i < leafTexts.length; i += 1) {
    const dateText = leafTexts[i];
    if (!isDateText(dateText)) continue;
    const category = i > 0 && RESEARCH_TAGS.has(leafTexts[i - 1]) ? leafTexts[i - 1] : undefined;

    let title = "";
    let summary;
    for (let j = i + 1; j < leafTexts.length; j += 1) {
      const t = leafTexts[j];
      if (isDateText(t)) break;
      if (RESEARCH_TAGS.has(t)) continue;
      if (!title) {
        title = t;
        continue;
      }
      summary = t;
      break;
    }
    if (!title || title.length < 4) continue;

    const id = titleIdMap.get(title);
    const link = id
      ? `${ZHIPU_ORIGIN}/zh/research/${id}`
      : `${ZHIPU_RESEARCH_URL}#${encodeURIComponent(title)}`;
    const pubDate = parseDate(dateText) ?? new Date();
    const key = `${title}|${pubDate.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      guid: hashGuid(id ? link : `${title}|${normalizeText(dateText)}`),
      title,
      link,
      pubDate,
      summary: summary || undefined,
      categories: category ? [category] : undefined,
    });
  }
  return items;
}


async function fetchItems(sourceId, ctx) {
  // 需要读取页面脚本里的 blogsItems（包含详情 id），因此这里禁用净化。
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 5000, purify: false });

  let blogsItems = extractBlogsItems(html);
  if (blogsItems.length === 0) {
    const rawHtml = await fetchRawHtml(finalUrl || sourceId);
    if (rawHtml) {
      blogsItems = extractBlogsItems(rawHtml);
    }
  }

  const parsedFromScript = buildItemsFromBlogsItems(blogsItems);
  if (parsedFromScript.length > 0) return parsedFromScript;

  const titleIdMap = buildTitleIdMap(blogsItems);
  const parsedFromDom = buildItemsFromDom(html, titleIdMap);
  if (parsedFromDom.length > 0) return parsedFromDom;

  const parsedFromLeafs = buildItemsFromLeafSequence(html, titleIdMap);
  if (parsedFromLeafs.length > 0) return parsedFromLeafs;

  throw new Error("[zhipu-research] 未解析到研究条目，页面结构可能已变化");
}


export default {
  id: "zhipu-research",
  listUrlPattern: ZHIPU_RESEARCH_URL,
  fetchItems,
};
