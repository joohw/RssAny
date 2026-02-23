// 正文提取器：从详情页 HTML 提取单条正文；默认 Readability，传入 customExtractor 时覆盖

export { extractHtml, extractFromLink, extractItem, extractItems } from "./extractor.js";
export type { ExtractedResult, ExtractorConfig, ExtractorMode, CustomExtractorFn } from "./types.js";
