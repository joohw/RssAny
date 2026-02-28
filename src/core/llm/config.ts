// LLM 配置：从环境变量读取，供 parser/extractor 等复用

import "dotenv/config";


/** LLM 配置（从环境变量或调用方传入） */
export interface LLMConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}


/** 从环境变量读取 LLM 配置 */
export function getLLMConfig(): Required<Pick<LLMConfig, "baseUrl" | "model">> & Pick<LLMConfig, "apiKey"> {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}
