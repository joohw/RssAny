// Agent 能力：pi-agent + MCP 工具，供 Chat 页面使用

import "dotenv/config";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { feedAgentTools } from "./tools.js";

const SYSTEM_PROMPT = `你是 RssAny 的 Info Sourcing Agent，拥有自主行动能力，可查询和管理 RSS 订阅内容。

工具说明：
- list_channels: 列出所有频道（id、标题、描述、信源数）
- get_channel_feeds: 获取频道 feeds 列表（不含正文）。支持 channel_id、since/until 日期范围、tags 标签过滤、author 作者模糊匹配、分页
- get_feed_detail: 按 item id 获取单条完整详情（含正文）
- search_feeds: 全文搜索或按条件筛选。q 全文匹配 title/summary/content；可选 channel_id、source_url、author、tags、since/until 日期范围。不传 q 时仅按过滤条件返回
- web_search: 网页搜索（Brave），获取实时信息。当用户需要最新资讯、订阅外的信息或外部来源时使用
- web_fetch: 抓取指定 URL 的网页正文（Readability 提取）。当需要读取某个链接的完整内容时使用

根据用户问题组合使用工具，用简洁的中文回复。需要正文时先获取列表再调用 get_feed_detail。需要实时网页信息时用 web_search。需要读取某链接的正文时用 web_fetch。

引用信息时请附带来源地址（url、link 等），使用 Markdown 链接格式 [标题](url)，方便用户溯源。`;

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
