// LLM 统一调用：封装 OpenAI chat completion，供 parser/extractor 复用

import OpenAI from "openai";
import { getLLMConfig } from "./config.js";
import type { LLMConfig } from "./config.js";


/** 合并调用方配置与环境变量配置 */
function mergeConfig(override?: Partial<LLMConfig> & { apiUrl?: string }): { apiKey: string; baseUrl: string; model: string } {
  const env = getLLMConfig();
  const apiKey = override?.apiKey ?? env.apiKey;
  const baseUrl = override?.apiUrl ?? override?.baseUrl ?? env.baseUrl;
  const model = override?.model ?? env.model;
  if (!apiKey) throw new Error("LLM API Key 未配置，请设置 OPENAI_API_KEY 或传入 apiKey");
  return { apiKey, baseUrl, model };
}


/** 调用 LLM 获取 JSON 响应，供 parser/extractor 复用 */
export async function chatJson(
  prompt: string,
  config?: Partial<LLMConfig> & { apiUrl?: string },
  options?: { maxTokens?: number; debugLabel?: string }
): Promise<Record<string, unknown>> {
  const { apiKey, baseUrl, model } = mergeConfig(config);
  if (options?.debugLabel) console.log(`[${options.debugLabel}] HTML 总长度:`, prompt.length, "字符");
  const openai = new OpenAI({ apiKey, baseURL: baseUrl });
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options?.maxTokens ?? 8192,
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      if (options?.debugLabel) console.error(`[${options.debugLabel}] LLM API 返回空内容`);
      throw new Error("LLM 返回空内容");
    }
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    if (options?.debugLabel) {
      console.error(`[${options.debugLabel}] LLM API 调用失败:`, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}


export { getLLMConfig } from "./config.js";
export type { LLMConfig } from "./config.js";
