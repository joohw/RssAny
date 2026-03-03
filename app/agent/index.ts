// Agent 能力：pi-agent + MCP 工具，供 Chat 页面使用

import "dotenv/config";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { feedAgentTools } from "./tools.js";

const SYSTEM_PROMPT = `你是 RssAny 的 RSS 助手，可以帮你查询和管理 RSS 订阅内容。

你可以使用以下工具：
- list_channels: 列出所有频道（id、标题、描述）
- get_channel_feeds: 获取指定频道或全部 feeds 列表（不含正文），支持分页
- get_feed_detail: 按 id 获取单条 feed 的完整详情（含正文）
- search_feeds: 全文搜索 feeds（title、summary、content）

请根据用户问题选择合适的工具，用简洁的中文回复。`;

/** 创建配置好工具的 Agent 实例 */
export function createFeedAgent(): Agent {
  const baseModel = getModel("openai", "gpt-4o-mini");
  const baseUrl = process.env.OPENAI_BASE_URL || baseModel.baseUrl;
  const modelId = process.env.OPENAI_MODEL || baseModel.id;
  // DeepSeek 等第三方 API 仅支持 Chat Completions，需用 openai-completions 而非 openai-responses
  const useCompletions = baseUrl !== "https://api.openai.com/v1";
  const model = {
    ...baseModel,
    baseUrl,
    id: modelId,
    name: modelId,
    ...(useCompletions && { api: "openai-completions" as const, provider: "openai" as const }),
  };
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: feedAgentTools,
    },
    getApiKey: () => process.env.OPENAI_API_KEY,
  });
  return agent;
}

export { feedAgentTools } from "./tools.js";
