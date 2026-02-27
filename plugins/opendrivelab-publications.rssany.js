import { createHash } from "node:crypto";
import { parse } from "node-html-parser";


const VENUE_HINT_RE = /(20\d{2}|cvpr|iccv|eccv|neurips|iclr|aaai|ijcv|tpami|icra|rss|corl|preprint|arxiv)/i;
const BLOCKED_HOST_RE = /(^|\.)scholar\.google\.com$|(^|\.)github\.com$|(^|\.)img\.shields\.io$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)zhihu\.com$|(^|\.)mp\.weixin\.qq\.com$|(^|\.)cvpr\d{4}\.thecvf\.com$/i;
const AWARD_RE = /\baward\b/i;


function normalizeText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}


function toHttpUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  try {
    const url = new URL(rawHref, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}


function hashGuid(input) {
  return createHash("sha256").update(input).digest("hex");
}


function isLikelyPaperTitle(title) {
  if (!title || title.length < 20) return false;
  if (AWARD_RE.test(title)) return false;
  const words = title.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [];
  return words.length >= 4;
}


function findYear(text) {
  const m = normalizeText(text).match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (year < 2000 || year > 2099) return undefined;
  return year;
}


function extractContext(anchor) {
  let node = anchor;
  let summary;
  let category;
  let year;

  for (let i = 0; i < 8 && node; i += 1) {
    if (!summary) {
      const summaryNode = node.querySelector?.("i");
      const summaryText = normalizeText(summaryNode?.textContent);
      if (summaryText && summaryText.length >= 24) summary = summaryText;
    }

    const spanTexts = (node.querySelectorAll?.("span") ?? [])
      .map((el) => normalizeText(el.textContent))
      .filter(Boolean);

    if (!category) {
      category = spanTexts.find((text) => VENUE_HINT_RE.test(text) && !AWARD_RE.test(text));
    }
    if (year == null) {
      for (const text of spanTexts) {
        const parsed = findYear(text);
        if (parsed != null) {
          year = parsed;
          break;
        }
      }
    }

    node = node.parentNode ?? null;
  }

  return { summary, category, year };
}


async function fetchItems(sourceId, ctx) {
  const { html, finalUrl } = await ctx.fetchHtml(sourceId, { waitMs: 3500 });
  const root = parse(html);
  const main = root.querySelector("main") ?? root;
  const anchors = main.querySelectorAll("a[href]");
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    if (!isLikelyPaperTitle(title)) continue;

    const url = toHttpUrl(anchor.getAttribute("href"), finalUrl);
    if (!url) continue;
    if (BLOCKED_HOST_RE.test(url.hostname)) continue;

    const link = url.href;
    if (seen.has(link)) continue;
    seen.add(link);

    const { summary, category, year } = extractContext(anchor);
    const pubDate = year != null ? new Date(Date.UTC(year, 0, 1)) : new Date();

    items.push({
      guid: hashGuid(link),
      title,
      link,
      pubDate,
      summary: summary || undefined,
      categories: category ? [category] : undefined,
    });
  }

  if (items.length === 0) {
    throw new Error("[opendrivelab-publications] 未解析到论文条目，页面结构可能已变化");
  }
  return items;
}


export default {
  id: "opendrivelab-publications",
  listUrlPattern: /^https?:\/\/(www\.)?opendrivelab\.com\/publications\/?(\?.*)?$/i,
  fetchItems,
};
