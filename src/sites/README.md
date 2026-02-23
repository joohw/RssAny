# sites

站点聚合：内置站点 + 外部插件（`plugins/*.rssany.js`）。每个站点实现 `Site` 接口，负责声明 URL 形态并提供 parser、extractor、auth。

## Site 接口

```ts
interface Site {
  id: string;
  listUrlPattern: string | RegExp;  // {placeholder} 匹配路径段，如 "https://example.com/user/{id}"
  detailUrlPattern?: string | RegExp;  // 详情页 URL 模式，供 /extractor 匹配，不填则按 domain 兜底
  parser: CustomParserFn;
  extractor: CustomExtractorFn;
  // 认证（扁平字段，不需登录时省略）
  checkAuth?: (page, url) => Promise<boolean>;
  loginUrl?: string;
  domain?: string;  // cookies 保存在 domains/{domain}.json
  loginTimeoutMs?: number;
  pollIntervalMs?: number;
  // 代理配置（可选）
  proxy?: string;  // 如 "http://127.0.0.1:7890"、"socks5://127.0.0.1:1080"；需认证时 "http://user:pass@host:port"，不设则使用环境变量 HTTP_PROXY/HTTPS_PROXY
}
```

- **listUrlPattern**：字符串时 `{xxx}` 匹配路径段，query 忽略；也可直接传 RegExp
- **detailUrlPattern**：可选，详情页 URL 模式（同 listUrlPattern 语法）；有则 /extractor 优先按此匹配，无则按 domain 兜底
- 认证字段详见 `docs/AUTH_FLOW.md`

## 匹配具体度

`getSite(url)` 不再返回第一个匹配，而是返回**具体度最高**的站点。具体度由 `listUrlPattern` 自动推算：

- 字符串模式：按路径段数（段数越多越具体）
- RegExp 模式：默认 1（兜底）

## 目录结构

```
sites/
  types.ts        # Site 接口、getSiteByUrl、toAuthFlow
  pluginLoader.ts # 从 plugins/*.rssany.js 加载外部插件
  index.ts        # 聚合、initSites、registeredSites、getSite
```

## 外部插件

- 插件目录：项目根目录 `plugins/`
- 命名：`*.rssany.js`
- 启动时自动加载并合并到 `registeredSites`
- 插件规范见 `docs/PLUGIN.md`

**内置站点**：
- `generic`：通用兜底，匹配任意 `http(s)://` URL，使用 LLM 解析与提取
- 小红书已迁移至 `plugins/xiaohongshu.rssany.js`

## 使用

- **初始化**：`await initSites()`（app 启动时已调用）
- **按 URL 查找**：`getSite(url)` 按 listUrlPattern 返回具体度最高的站点（用于 RSS/parse）；`getSiteForExtraction(url)` 按域名匹配「有 extractor」的站点（用于 /extractor，因详情页 URL 通常不匹配 listUrlPattern）；`computeSpecificity(site, url)` 可单独计算匹配分数
- **Parser**：传入 `customParser: site.parser` 覆盖默认 LLM 解析
- **Extractor**：传入 `customExtractor: site.extractor` 覆盖默认 LLM 提取
- **Auth**：需登录的站点提供 `checkAuth`、`loginUrl` 等扁平字段；`toAuthFlow(site)` 转为 AuthFlow 供 `fetchHtml` / `ensureAuth` 使用
