# parser

从 HTML 列表页解析出条目（支持 custom 规则解析与 LLM 解析）。

- **净化**：LLM 解析前默认对 HTML 做 purify（移除 script/style/nav 等无关标签），减少 token 消耗、提升解析质量；`purify: false` 可关闭。
- **缓存**：`cacheDir/parsed/`。未传 `cacheKey` 时按 `sha256(url)` 与 fetched 对齐，custom 与 llm 共用同一缓存（llm 作为 fallback）；传入 `cacheKey` 可与 fetched 的 id 对齐（同 id 同文件）。
- **默认 LLM 解析**：未传 `customParser` 时使用 LLM 解析；传入 `customParser` 时覆盖（如插件 `xiaohongshu.rssany.js` 的 `parser`）。
