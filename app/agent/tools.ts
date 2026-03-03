// Agent 工具：从 definitions 转换

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { toAgentTools } from "./tools/definitions.js";

/** 所有 feed 相关 Agent 工具 */
export const feedAgentTools = toAgentTools() as AgentTool[];
