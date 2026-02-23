// HTML 列表解析器：默认 LLM 解析，传入 customParser 时覆盖

export { parseHtml } from "./parser.js";
export { getLLMConfig } from "../llm/config.js";
export type { ParsedEntry } from "./types.js";
export type { CustomParserFn, LLMParserConfig, ParserConfig, ParserMode, ParsedListResult } from "./parser.js";
export type { LLMConfig } from "../llm/config.js";
