# feeder

根据 URL 生成 RSS，与 router 解耦。

## 流程

1. 检查 feeds 缓存（cacheDir/feeds/{sha256(url)}.xml）
2. 命中则直接返回
3. 未命中：getSite(url) 匹配站点
4. 无站点则抛错
5. 抓 list → parse → 构建基础 RSS（含列表条目）→ 立即写入缓存并返回
6. 若 includeContent：后台逐条抓 detail 并 extract，完成后覆盖缓存；刷新可得完整正文

## 缓存策略

- **feed 级**（feeds/*.xml）：读 + 写，用于复用整条链路结果（按 feedCacheMaxAgeMs 过期）。
- **fetch/parse/extract 级**：仅写缓存（记录到 cache/fetched、parsed、extracted），生成流程中不读，避免错误结果被复用、持续传播；缓存仅供排查与分析使用。

## 接口

- `getRss(listUrl, config)`：返回 `{ xml, fromCache }`
- 未来：`proxyRss(rssUrl)` 转发外部 RSS（/proxy/+url）

## 解耦

Router（Hono/Express 等）只负责 HTTP：解析 URL → 调用 `getRss` → 返回 XML。feeder 不依赖 router。
