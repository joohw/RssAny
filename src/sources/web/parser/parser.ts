// HTML 列表解析器：专注于从列表页提取多个条目（支持自定义函数、LLM 两种模式）

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cacheKey as cacherCacheKey } from "../../../cacher/index.js";
import { applyPurify } from "../fetcher/purify.js";
import { chatJson } from "../../../llm/index.js";
import { getLLMConfig } from "../../../llm/config.js";
import type { FeedItem } from "../../../types/feedItem.js";
import type { ParsedEntry } from "./types.js";


// 使用 sha256 生成 guid
function generateGuid(link: string): string {
  return createHash("sha256").update(link).digest("hex");
}


const PARSED_SUBDIR = "parsed";


/** 解析结果结构（类似 RSS feed 结构） */
export interface ParsedListResult {
  /** 解析出的条目列表 */
  items: FeedItem[];
  /** 源 URL */
  url?: string;
  /** 解析模式 */
  mode?: ParserMode;
}


/** 解析结果缓存结构 */
interface ParsedCache extends ParsedListResult {
  /** 缓存时间 ISO 字符串 */
  cachedAt: string;
}


/** 自定义解析函数：输入 HTML 和 URL，返回 ParsedEntry 数组 */
export type CustomParserFn = (html: string, url: string) => Promise<ParsedEntry[]> | ParsedEntry[];


/** LLM 解析配置 */
export interface LLMParserConfig {
  /** LLM API 端点，不传则从环境变量 OPENAI_BASE_URL 读取 */
  apiUrl?: string;
  /** API Key，不传则从环境变量 OPENAI_API_KEY 读取 */
  apiKey?: string;
  /** 模型名称，不传则从环境变量 OPENAI_MODEL 读取 */
  model?: string;
  /** 提示词模板，{html} 会被替换为 HTML 内容 */
  prompt?: string;
}


/** 解析模式 */
export type ParserMode = "custom" | "llm";


/** Parser 配置 */
export interface ParserConfig {
  /** 源 URL，用于提取相对链接和发布日期 */
  url?: string;
  /** 解析模式：custom（自定义函数）、llm（LLM API），默认根据 customParser 或 llmConfig 自动判断 */
  mode?: ParserMode;
  /** 自定义解析函数，mode 为 "custom" 时必需 */
  customParser?: CustomParserFn;
  /** LLM 解析配置，mode 为 "llm" 时使用（可从环境变量读取） */
  llmConfig?: LLMParserConfig;
  /** 是否包含详细内容（contentHtml），默认 false（仅摘要） */
  includeContent?: boolean;
  /** 缓存目录，启用时将解析结果缓存到 cacheDir/parsed/ */
  cacheDir?: string;
  /** 为 false 时不读缓存（但仍会写缓存），为 true 时读写缓存，默认 true */
  useCache?: boolean;
  /** 指定缓存 key（与 fetched 的 id 一致时可传此值），不传则按 html+url+config 计算 */
  cacheKey?: string;
  /** 解析前是否净化 HTML（移除 script/style/nav 等无关标签），llm 模式默认 true，custom 模式不适用 */
  purify?: boolean;
}


// 使用 LLM 解析 HTML，返回 ParsedEntry 数组
async function parseWithLLM(html: string, url: string, config: LLMParserConfig): Promise<ParsedEntry[]> {
  const prompt =
    config.prompt ??
    `你是一个专业的 HTML 内容提取助手。请仔细分析以下 HTML 页面，提取所有可点击的内容条目（如文章、笔记、帖子、视频等）。

要求：
1. 返回 JSON 对象，格式为 {"items": [...]}
2. 每个条目必须包含以下字段：
   - title: 标题（必填）
   - link: 完整链接（必填）。**必须从 HTML 的 href 原样提取**：若为绝对路径（以 / 开头）则直接使用；若为相对路径则补全为完整 URL。当前页: ${url}
   - description: 摘要或描述（200字内，必填）
   - author: 作者（可选）
   - published: 发布日期 ISO 字符串（可选）
3. 如果页面是列表页，提取所有列表项
4. 如果页面是详情页，将整个页面作为一个条目提取
5. 如果页面是用户主页/个人资料页：
   - 优先尝试提取该用户发布的内容列表
   - 如果无法提取列表，至少提取用户基本信息作为一个条目（title 为用户名称或页面标题，description 为用户简介或页面描述，link 为当前 URL）
6. 如果页面是单页应用（SPA），尝试从以下位置提取数据：
   - <title> 标签中的页面标题
   - <meta name="description"> 或 <meta property="og:description"> 中的描述
   - <meta property="og:title"> 中的标题
   - <link rel="canonical" href="..."> 中的规范链接（优先使用）
   - <script> 标签中的 JSON 数据（搜索包含 "title", "description", "user", "author", "items", "list" 等关键词的 JSON）
   - 任何包含 href 属性的 <a> 标签，**link 必须使用 href 的原始值**（以 / 开头的路径表示从站根算起）
   - 任何包含文本内容的元素
7. **重要**：即使页面看起来是空的 SPA，也必须至少返回一个条目：
   - 从 <title> 提取标题（如果没有则使用 URL）
   - 从 <meta> 标签提取描述（如果没有则使用 "页面内容通过 JavaScript 动态加载"）
   - link 使用当前 URL: ${url}
   - 如果页面 URL 包含 "user" 或 "profile"，可以推断这是一个用户主页，title 可以是 "用户主页"，description 可以是页面 URL

**强制要求**：绝对不能返回空数组 {"items": []}，至少要返回一个包含页面基本信息的条目。

HTML:
${html}`;
  const parsed = await chatJson(
    prompt,
    { apiKey: config.apiKey, apiUrl: config.apiUrl, model: config.model },
    { debugLabel: "parseWithLLM" }
  );
  let entries: ParsedEntry[] = [];
  if (parsed.items && Array.isArray(parsed.items)) {
    entries = parsed.items as ParsedEntry[];
  } else if (parsed.entries && Array.isArray(parsed.entries)) {
    entries = parsed.entries as ParsedEntry[];
  } else if (Array.isArray(parsed)) {
    entries = parsed as ParsedEntry[];
  } else if (parsed && typeof parsed === "object") {
    entries = [parsed as unknown as ParsedEntry];
  }
  return entries.map((e) => {
    const raw = e.link || url;
    if (raw.startsWith("http")) return { ...e, link: raw };
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    try {
      const base = new URL(url);
      return { ...e, link: new URL(path, base.origin).href };
    } catch {
      return { ...e, link: new URL(raw, url).href };
    }
  });
}


// 将 ParsedEntry 转为 FeedItem（不包含详细内容）
function toFeedItem(entry: ParsedEntry, includeContent: boolean): FeedItem {
  return {
    guid: entry.guid ?? generateGuid(entry.link),
    title: entry.title,
    link: entry.link,
    pubDate: entry.published ? new Date(entry.published) : new Date(),
    author: entry.author ? entry.author : undefined,
    summary: entry.description,
    contentHtml: includeContent ? entry.content : undefined,
  };
}


// 与 fetched 缓存一致：使用同一套 sha256(url)，便于 fetched 与 parsed 一一对应；custom/llm 共用同一 key（llm 作为 fallback）
function parsedCacheKey(html: string, url: string, config: ParserConfig): string {
  if (url) return cacherCacheKey(url, "forever");
  const keyParts = [html.slice(0, 1000), config.customParser ? "custom" : "llm", config.includeContent ? "full" : "summary"];
  return createHash("sha256").update(keyParts.join("|")).digest("hex");
}


// 从缓存读取解析结果
async function readCachedResult(cacheDir: string, key: string): Promise<ParsedListResult | null> {
  const filePath = join(cacheDir, PARSED_SUBDIR, `${key}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    // 兼容旧格式（数组）和新格式（对象）
    if (Array.isArray(parsed)) {
      return { items: parsed as FeedItem[] };
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      return parsed as ParsedListResult;
    }
    return null;
  } catch {
    return null;
  }
}


// 将解析结果写入缓存
async function writeCachedResult(cacheDir: string, key: string, result: ParsedListResult): Promise<void> {
  const dir = join(cacheDir, PARSED_SUBDIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  const cache: ParsedCache = {
    ...result,
    cachedAt: new Date().toISOString(),
  };
  await writeFile(filePath, JSON.stringify(cache, null, 2), "utf-8");
}


/** 解析 HTML 列表页，返回包含 items 的对象（类似 RSS feed 结构） */
export async function parseHtml(html: string, config: ParserConfig = {}): Promise<ParsedListResult> {
  const { url = "", mode, customParser, llmConfig, includeContent = false, cacheDir, useCache = true, cacheKey: configCacheKey, purify } = config;
  const resolveKey = () => (configCacheKey != null && configCacheKey !== "" ? configCacheKey : parsedCacheKey(html, url, config));
  // 如果启用缓存读取，尝试从缓存读取
  if (useCache !== false && cacheDir != null && cacheDir !== "") {
    const key = resolveKey();
    const cached = await readCachedResult(cacheDir, key);
    if (cached != null) {
      return cached;
    }
  }
  let entries: ParsedEntry[] = [];
  const actualMode = mode ?? (llmConfig != null ? "llm" : customParser != null ? "custom" : "llm");
  if (actualMode === "llm") {
    if (llmConfig == null && !getLLMConfig().apiKey) {
      throw new Error('mode 为 "llm" 时必须提供 llmConfig 或设置 OPENAI_API_KEY 环境变量');
    }
    const htmlForLLM = applyPurify(html, purify !== false);
    entries = await parseWithLLM(htmlForLLM, url, llmConfig ?? {});
  } else if (actualMode === "custom") {
    if (customParser == null) {
      throw new Error('mode 为 "custom" 时必须提供 customParser');
    }
    entries = await customParser(html, url);
    if (!Array.isArray(entries)) {
      entries = [entries];
    }
  } else {
    throw new Error(`不支持的解析模式: ${actualMode}`);
  }
  const items = entries.map((e) => toFeedItem(e, includeContent));
  const result: ParsedListResult = {
    items,
    url,
    mode: actualMode,
  };
  // 如果提供了缓存目录，总是写入缓存（即使 useCache 为 false，也写入以便后续使用）
  if (cacheDir != null && cacheDir !== "") {
    const key = resolveKey();
    await writeCachedResult(cacheDir, key, result);
  }
  return result;
}
