/**
 * 内置 pipeline 插件：LLM 自动打标签
 *
 * 从用户管理的系统标签库（.rssany/tags.json）中选取匹配的标签写入 item.tags。
 * 模型建议的 tag 若不在系统标签库中则忽略。
 *
 * 需要配置 OPENAI_API_KEY（或等效 LLM 环境变量）。
 * 可在 .rssany/plugins/pipeline/ 放同名文件覆盖本插件。
 */

const SYSTEM = `你是一个信息分类助手。根据文章标题和摘要，从候选标签库中选出 5-10 个最匹配的标签。
- 只能使用候选标签库中已有的标签，不要输出库中不存在的标签。
- 只输出 JSON，格式：{"tags": ["tag1", "tag2", ...]}`;

export default {
  id: "tagger",

  /** 跳过已有 tags 的条目（已处理过）；无 LLM 则跳过 */
  match(item, ctx) {
    return !item.tags?.length && !!ctx.llm;
  },

  async run(item, ctx) {
    const systemTags = await ctx.db.getSystemTags();

    if (!systemTags.length) return item;

    const candidateList = `候选标签库（只能从中选取）：\n${systemTags.join(", ")}\n\n`;

    const prompt = `${SYSTEM}\n\n${candidateList}文章标题：${item.title ?? ""}\n文章摘要：${item.summary ?? item.content?.slice(0, 300) ?? "（无摘要）"}`;

    let suggested;
    try {
      const res = await ctx.llm.chatJson(prompt, undefined, { maxTokens: 256, debugLabel: "tagger" });
      suggested = Array.isArray(res.tags) ? res.tags.filter((t) => typeof t === "string") : [];
    } catch {
      return item;
    }

    if (!suggested.length) return item;

    const set = new Set(systemTags.map((t) => t.toLowerCase()));
    const confirmed = suggested.filter((t) => set.has(t.toLowerCase()));

    if (confirmed.length) {
      item.tags = [...new Set([...(item.tags ?? []), ...confirmed])];
    }

    return item;
  },
};
