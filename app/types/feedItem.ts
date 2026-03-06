/**
 * 系统内部统一的 Feed Item 定义
 * 插件 → Normalizer → RSS Generator
 * 自包含：携带 sourceRef 后，入库 / Signal 投递等无需再单独传 ref。
 */

/** 单语种译文字段（key 为 BCP 47，如 zh-CN、en） */
export interface ItemTranslationFields {
    title?: string;
    summary?: string;
    content?: string;
}

/** 带可选 translations 的条目视图（FeedItem 或 DB 行 + translations 等） */
export interface ItemWithOptionalTranslations {
    title: string;
    summary?: string;
    content?: string;
    translations?: Record<string, ItemTranslationFields>;
}

/**
 * 根据 lng 取条目的「有效」标题/摘要/正文：有 translations[lng] 则优先用译文，否则用原文。
 * 路由层传 lng 时用此结果生成 RSS 或 API 响应。
 */
export function getEffectiveItemFields(
    item: ItemWithOptionalTranslations,
    lng?: string | null,
): { title: string; summary: string; content: string } {
    const raw = lng && lng !== "" ? item.translations?.[lng] : undefined;
    const t = raw && typeof raw === "object" ? raw : undefined;
    return {
        title: (t?.title != null && t.title !== "" ? t.title : item.title) ?? "",
        summary: (t?.summary != null && t.summary !== "" ? t.summary : item.summary) ?? "",
        content: (t?.content != null && t.content !== "" ? t.content : item.content) ?? "",
    };
}

/** 将 author 规范为 string[]，兼容 string 输入（插件等） */
export function normalizeAuthor(author: string | string[] | null | undefined): string[] | undefined {
    if (author == null) return undefined;
    if (Array.isArray(author)) return author.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
    const s = String(author).trim();
    return s ? [s] : undefined;
}

/** 将 author 转为显示用字符串（逗号分隔） */
export function authorToDisplay(author: string | string[] | null | undefined): string {
    const arr = normalizeAuthor(author);
    return arr?.join(", ") ?? "";
}

export interface FeedItem {
    /** 全局唯一标识，link 或稳定 hash */
    guid: string;
    /** 标题 */
    title: string;
    /** 原文链接 */
    link: string;
    /** 发布时间 */
    pubDate: Date;
    /** 作者列表 */
    author?: string[];
    /** 简要描述（纯文本，适合 RSS description） */
    summary?: string;
    /** 详情正文（输出到 RSS description） */
    content?: string;
    /** RSS 来源分类（直接来自 feed 的 <category> 字段） */
    categories?: string[];
    /** 系统 / pipeline 生成的标签（从用户管理的标签库中匹配） */
    tags?: string[];
    /** 信源标识（列表页 URL 或 imap 等），入库与按 channel 筛选用；设后则 upsertItems / writeItems 等无需再传 ref */
    sourceRef?: string;
    /**
     * 多语种译文。key 为 BCP 47（如 zh-CN、en），路由支持 lng 参数时可据此返回对应译文。
     * 由插件在 enrichItem 中写入，或由框架在 enrich 后统一调用翻译服务写入。
     */
    translations?: Record<string, ItemTranslationFields>;
    /** 扩展字段，给插件留后门 */
    extra?: Record<string, unknown>;
  }