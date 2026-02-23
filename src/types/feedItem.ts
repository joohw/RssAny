/**
 * 系统内部统一的 Feed Item 定义
 * 插件 → Normalizer → RSS Generator
 */

export interface FeedItem {
    /** 全局唯一标识，建议：link 或稳定 hash */
    guid: string;
    /** 标题 */
    title: string;
    /** 原文链接 */
    link: string;
    /** 发布时间 */
    pubDate: Date;
    /** 作者 */
    author?: string;
    /** 简要描述（纯文本，适合 RSS description） */
    summary?: string;
    /** 详情正文（HTML，输出到 RSS description） */
    contentHtml?: string;
    /** 是否已尝试抓取详情但失败（用于展示「抓取失败」而非「抓取中」） */
    extractionFailed?: boolean;
    /** 分类 / 标签 */
    categories?: string[];
    /** 来源标识（插件 id） */
    sourceId?: string;
    /** 扩展字段，给插件留后门 */
    extra?: Record<string, unknown>;
  }