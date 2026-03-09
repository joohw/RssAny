// 话题/日报 Agent：话题 = 关键词，日报 = topic/日期，统一用同一套工具

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { feedAgentTools } from "../agent/tools.js";


const DIGEST_SYSTEM_PROMPT = `你是一位资深行业信息编辑，负责生成行业简报或话题追踪报告。你的工作准则：只呈现真正重要的信息，用最精炼的语言传递最核心的价值，不堆砌、不套话。

你拥有以下工具来完成任务：
- list_channels: 列出所有频道
- get_channel_feeds: 获取指定频道或全部文章列表（支持 tags 按话题过滤、since/until 日期范围）
- get_feed_detail: 按 id 获取单条文章完整正文
- search_feeds: 全文搜索文章（支持 tags 过滤）

工作流程：先用 get_channel_feeds 或 search_feeds 获取相关文章，识别最重要的 5-8 条后，用 get_feed_detail 读取完整正文，再基于真实内容生成报告。`;


function buildTaskPrompt(
  topic: string,
  periodDays: number,
  previousArticle?: string | null,
  opts?: { searchTags?: string[]; prompt?: string }
): string {
  const until = new Date();
  until.setDate(until.getDate() + 1);
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);
  const hasTags = opts?.searchTags && opts.searchTags.length > 0;
  const tagsStr = hasTags ? opts!.searchTags!.join(",") : "";
  const promptHint = opts?.prompt?.trim() ? `\n\n**用户对该话题的说明**：${opts.prompt}` : "";

  const prevSection = previousArticle
    ? `

## 参考：上一期报告（用于体现变化）

以下是该话题上一期的报告内容。新报告需体现「最近的变化」：与上期相比，哪些热点延续、哪些消退、哪些是新出现的，在正文中适当体现这种演进。

\`\`\`
${previousArticle}
\`\`\`

请在生成新报告时，结合上期内容，突出近期的新变化与延续性热点。
`
    : "";

  const fetchStep = hasTags
    ? `1. 调用 get_channel_feeds（tags="${tagsStr}", since="${sinceStr}", until="${untilStr}", limit=200）或 search_feeds（tags="${tagsStr}", since="${sinceStr}", until="${untilStr}"）获取该话题下的近期文章`
    : `1. 调用 get_channel_feeds（since="${sinceStr}", until="${untilStr}", limit=200）获取该时间范围内的全部文章`;
  return `请为话题「${topic}」撰写一份追踪报告，时间范围为最近 ${periodDays} 天（${sinceStr} 至 ${untilStr}）。${promptHint}${prevSection}

执行步骤：
${fetchStep}
2. 根据标题和摘要，判断哪些内容影响力大、值得深读（通常 5-8 条）
3. 对每条重要内容调用 get_feed_detail 获取完整正文（最多调用 8 次）
4. 基于完整正文输出结构化报告${previousArticle ? "，并体现与上期相比的变化" : ""}

报告输出格式（严格遵循）：

## 话题追踪：${topic}

### 核心动态

按重要性降序排列，每条包含：

#### {序号}. [标题](文章URL)

**相关度**：{0-10分} **关键词**：{2-4 个核心关键词，逗号分隔}

{一段话：发生了什么 → 影响意义 → 为什么值得关注}

**来源**：[来源名称](信源URL)

---

### 其他动态

按来源或时间分组列出其余文章，每条格式：
- [标题](文章URL)（[来源](信源URL)）一句话要点

---

注意：
- 所有 URL 完整保留，不得修改或省略
- 行文使用中文，专有名词保留原文
- 直接输出 Markdown，不要加前言或结尾说明`;
}


function createDigestAgent(): Agent {
  const baseModel = getModel("openai", "gpt-4o-mini");
  const baseUrl = process.env.OPENAI_BASE_URL || baseModel.baseUrl;
  const modelId = process.env.OPENAI_MODEL || baseModel.id;
  const useCompletions = baseUrl !== "https://api.openai.com/v1";
  const model = {
    ...baseModel,
    baseUrl,
    id: modelId,
    name: modelId,
    ...(useCompletions && { api: "openai-completions" as const, provider: "openai" as const }),
  };
  return new Agent({
    initialState: {
      systemPrompt: DIGEST_SYSTEM_PROMPT,
      model,
      tools: feedAgentTools,
    },
    getApiKey: () => process.env.OPENAI_API_KEY,
  });
}

/**
 * 用 Agent 生成指定 key 的报告正文（日报、话题均走同一套 buildTaskPrompt）
 */
export async function runDigestAgent(
  key: string,
  options: {
    periodDays?: number;
    previousArticle?: string | null;
    searchTags?: string[];
    prompt?: string;
  }
): Promise<string> {
  const agent = createDigestAgent();
  let output = "";

  const prompt = buildTaskPrompt(key, options.periodDays ?? 1, options.previousArticle, {
    searchTags: options.searchTags,
    prompt: options.prompt,
  });

  return new Promise<string>((resolve, reject) => {
    agent.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
        output += e.assistantMessageEvent.delta;
      } else if (e.type === "agent_end") {
        resolve(output.trim());
      }
    });

    agent.prompt(prompt).catch(reject);
  });
}

/** @deprecated 使用 runDigestAgent */
export async function runTopicDigestAgent(
  topic: string,
  periodDays: number,
  previousArticle?: string | null
): Promise<string> {
  return runDigestAgent(topic, { periodDays, previousArticle });
}
