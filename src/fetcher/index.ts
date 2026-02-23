// 使用无头浏览器（Puppeteer）拉取页面，缓存逻辑在 cacher 中
export { fetchHtml, ensureAuth, preCheckAuth, getOrCreateBrowser } from "./browser.js";
export { cacheKey, readCached, writeCached, readProfile, writeProfile } from "../cacher/index.js";
export type { ReadCacheOptions, WriteCacheOptions, AuthProfile } from "../cacher/index.js";
export type { CheckAuthFn, AuthFlow } from "../auth/index.js";
// 类型定义
export type { CacheKeyStrategy, RequestConfig, StructuredHtmlResult } from "./types.js";
