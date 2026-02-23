# extractor

从详情页 HTML 提取单条正文，返回标准字段：`author`、`title`、`summary`、`content`、`pubDate`（与 RSS 对齐）。

## 模式

- **custom**：插件提供 customExtractor 时使用（默认）
- **readability**：显式指定时使用 @mozilla/readability 提取
- **无模式**：如果没有提供 customExtractor 且未指定 readability，则不提取详情页内容

## 缓存

- 提取结果写入 `cacheDir/extracted/`
- 提取过程的 fetch **不缓存**（每次实时拉取）
