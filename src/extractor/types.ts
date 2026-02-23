// 正文提取结果：从详情页 HTML 提取的单一条目内容

export interface ExtractedResult {
  /** 作者 */
  author?: string;
  /** 标题 */
  title?: string;
  /** 摘要 */
  summary?: string;
  /** 正文（标准 RSS 用 content；可为 HTML 或 Markdown，输出到 description） */
  content?: string;
  /** 发布时间，ISO 字符串或 Date，用于合并到 FeedItem.pubDate */
  pubDate?: string | Date;
}


/** 自定义正文提取函数：输入 HTML 和 URL，返回单条提取结果 */
export type CustomExtractorFn = (html: string, url: string) => Promise<ExtractedResult> | ExtractedResult;


/** 提取模式 */
export type ExtractorMode = "custom" | "readability";


/** Extractor 配置 */
export interface ExtractorConfig {
  /** 当前详情页 URL，用于相对链接与缓存 key */
  url?: string;
  /** 提取模式：custom / readability，默认不提取（仅在有 customExtractor 时提取） */
  mode?: ExtractorMode;
  /** 自定义提取函数，mode 为 custom 时必需 */
  customExtractor?: CustomExtractorFn;
  /** 缓存目录，结果写入 cacheDir/extracted/ */
  cacheDir?: string;
  /** 为 false 时不读缓存（仍会写），默认 true */
  useCache?: boolean;
  /** 指定缓存 key */
  cacheKey?: string;
  /** 进度回调，每处理完一条时调用 (current, total) */
  onProgress?: (current: number, total: number) => void;
}
