// Readability 解析后的文章核心内容

export interface ReadabilityArticle {
  /** 文章标题 */
  title: string;
  /** 正文 HTML */
  content: string;
  /** 正文纯文本 */
  textContent: string;
  /** 摘要 */
  excerpt: string;
  /** 作者等信息 */
  byline: string;
  /** 字符数 */
  length: number;
  /** 文本方向 */
  dir: string | null;
}

// 用于生成 RSS/Atom 的条目：在 Readability 结果上补充 link、published 等
export interface ParsedEntry {
  /** 条目标题 */
  title: string;
  /** 条目 URL */
  link: string;
  /** 摘要（RSS description） */
  description: string;
  /** 正文 HTML（RSS content:encoded 或 description 的完整版） */
  content: string;
  /** 作者 */
  author: string;
  /** 发布日期 ISO 字符串，可选 */
  published?: string;
  /** 唯一标识，不填则用 link */
  guid?: string;
}
