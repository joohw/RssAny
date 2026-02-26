import { createHash } from "node:crypto";

const SITE_ID = "baai-wudao-paper-article";
const OWNER = "BAAI-WuDao";
const REPO = "Paper-Article";
const README_PATH = "README.md";
const README_RAW_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${README_PATH}`;
const README_COMMITS_API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/commits?path=${encodeURIComponent(
  README_PATH
)}&per_page=1`;

function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}

function cleanUrl(raw) {
  const text = normalizeText(raw).replace(/[)>.,;!?]+$/g, "");
  try {
    const url = new URL(text);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("接口返回非 JSON 数据");
  }
}

async function fetchReadmeMarkdown() {
  const response = await fetch(README_RAW_URL, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "RssAny/1.0 (+https://github.com/rssany/rssany)",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const markdown = await response.text();
  if (!normalizeText(markdown)) {
    throw new Error("README 内容为空");
  }
  return markdown;
}

async function fetchReadmeUpdatedAt() {
  try {
    const payload = await fetchJson(README_COMMITS_API_URL);
    const first = Array.isArray(payload) ? payload[0] : undefined;
    const rawDate =
      first?.commit?.committer?.date ??
      first?.commit?.author?.date ??
      first?.committer?.date ??
      first?.author?.date;
    const parsed = rawDate ? new Date(rawDate) : undefined;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  } catch {
    // 忽略日期接口异常，回退到当前时间保证插件可用
  }
  return new Date();
}

function parseSectionName(line) {
  const m = normalizeText(line).match(/^###\s+(.+)$/);
  if (!m) return "";
  const name = normalizeText(m[1]).toLowerCase();
  if (name.includes("paper")) return "Paper";
  if (name.includes("article")) return "Article";
  return "";
}

function parseTitleLine(line) {
  const text = normalizeText(line);
  const m = text.match(/^\*\s+\*\*(.+?)\*\*\s*$/);
  if (!m) return "";
  return normalizeText(m[1]);
}

function parseLinkLine(line) {
  const text = normalizeText(line);
  if (!text) return null;
  const directMatch = text.match(/链接[:：]\s*(https?:\/\/\S+)/i);
  if (directMatch) return cleanUrl(directMatch[1]);
  const urlMatch = text.match(/(https?:\/\/\S+)/i);
  if (urlMatch) return cleanUrl(urlMatch[1]);
  return null;
}

function parseItemsFromReadme(markdown, baseDate) {
  const lines = markdown.split(/\r?\n/);
  const items = [];
  const seenLinks = new Set();
  let currentSection = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const section = parseSectionName(line);
    if (section) {
      currentSection = section;
      continue;
    }

    const title = parseTitleLine(line);
    if (!title) continue;

    let link = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      link = parseLinkLine(lines[j]);
      if (link) break;
      if (parseTitleLine(lines[j]) || parseSectionName(lines[j])) break;
    }
    if (!link || seenLinks.has(link)) continue;
    seenLinks.add(link);

    const pubDate = new Date(baseDate.getTime() - items.length * 1000);
    const category = currentSection || "Paper-Article";
    const summary =
      category === "Paper"
        ? "BAAI-WuDao Paper collection"
        : category === "Article"
          ? "BAAI-WuDao related article"
          : "BAAI-WuDao Paper-Article repository";

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      summary,
      categories: [category],
      sourceId: SITE_ID,
    });
  }

  return items;
}

async function fetchItems(sourceId, _ctx) {
  let sourceUrl;
  try {
    sourceUrl = new URL(sourceId);
  } catch {
    throw new Error(`[${SITE_ID}] 无效 URL: ${sourceId}`);
  }

  if (
    sourceUrl.hostname !== "github.com" ||
    sourceUrl.pathname.replace(/\/+$/, "") !== `/${OWNER}/${REPO}`
  ) {
    throw new Error(`[${SITE_ID}] 仅支持仓库 URL: https://github.com/${OWNER}/${REPO}`);
  }

  const [markdown, baseDate] = await Promise.all([fetchReadmeMarkdown(), fetchReadmeUpdatedAt()]);
  const items = parseItemsFromReadme(markdown, baseDate);
  if (items.length === 0) {
    throw new Error(`[${SITE_ID}] 未解析到条目，README 结构可能已变化`);
  }
  return items;
}

export default {
  id: SITE_ID,
  listUrlPattern: /^https?:\/\/(www\.)?github\.com\/BAAI-WuDao\/Paper-Article\/?(?:\?.*)?$/i,
  fetchItems,
};
