# RssAny 项目架构说明

RssAny 是一个通用的 RSS/Atom/JSON Feed 生成器，能够将任意网页内容转换为可订阅的 RSS 源，并将条目持久化到本地 SQLite 数据库，供 OpenWebUI 等工具做知识库或 RAG 使用。项目采用模块化架构，支持插件扩展、认证管理、智能解析与提取。

## 核心功能

- **RSS 生成**：根据列表页 URL 自动抓取、解析并生成 RSS XML
- **智能解析**：支持自定义解析器与 LLM 解析两种模式
- **正文提取**：支持自定义提取器、Readability 与 LLM 提取
- **认证管理**：支持需要登录的站点，通过 Puppeteer 管理 cookies
- **插件系统**：内置插件（`plugins/`）+ 用户插件（`.rssany/plugins/`）双目录加载
- **缓存机制**：多级缓存策略，提升性能与稳定性
- **持久化存储**：SQLite 数据库增量存储所有条目，支持 FTS5 全文检索
- **订阅聚合**：将多个信源聚合为单一信息流，支持分页与过滤

## 目录结构

```
项目文件（纳入版本管理）
├── src/              源代码
├── plugins/          内置站点插件（*.rssany.js / *.rssany.ts）
├── statics/          静态 HTML 页面
└── cache/            运行时 HTML / Feed 缓存（gitignore）

用户数据（不纳入版本管理，位于 .rssany/）
├── .rssany/
│   ├── sites.json          站点代理与刷新间隔配置
│   ├── subscriptions.json  订阅定义
│   ├── plugins/            用户自定义插件（可覆盖同 id 的内置插件）
│   └── data/
│       └── rssany.db       SQLite 数据库
```

> `.rssany/` 目录在首次启动时自动创建，并自动迁移旧版根目录下的 `sites.json`、`subscriptions.json`、`data/` 到新路径。

## 架构模块

### app（HTTP 路由层）
- **职责**：Hono 框架实现的 HTTP 服务，负责路由分发、参数解析、错误处理
- **路由**：
  - `/rss/*`：生成 RSS XML
  - `/parse/*`、`/extractor/*`：开发调试工具（同时有独立 HTML 页面）
  - `/feed`、`/subscriptions`、`/sites`、`/plugins`：管理页面
  - `/api/items`：数据库条目查询（含 FTS 全文搜索）
  - `/api/items/pending-push`、`/api/items/mark-pushed`：OpenWebUI 推送接口
  - `/auth/*`：认证管理
- **解耦**：与业务逻辑（feeder）解耦，可替换为 Express 等框架

### feeder（RSS 生成核心）
- **职责**：根据 URL 生成 RSS，协调 fetch → parse → extract 流程
- **流程**：检查缓存 → 匹配站点 → 抓取列表 → 解析条目 → 构建 RSS → 后台补全详情
- **缓存**：feed 级缓存（读+写），fetch/parse/extract 级仅写（供分析）
- **写库**：列表解析后立即 `upsertItems`，extract 完成后 `updateItemContent`

### fetcher（页面拉取层）
- **职责**：使用 Puppeteer 无头浏览器拉取页面 HTML
- **特性**：支持认证态恢复（cookies/localStorage）、代理配置、HTML 净化
- **认证**：通过 `ensureAuth` 管理登录流程，cookies 持久化到 `cache/domains/{domain}.json`

### parser（列表解析层）
- **职责**：从 HTML 列表页解析出条目列表（title、link、summary 等）
- **模式**：自定义解析器（插件提供）或 LLM 解析（默认）
- **缓存**：解析结果写入 `cache/parsed/`

### extractor（正文提取层）
- **职责**：从详情页 HTML 提取完整正文内容
- **模式**：自定义提取器（优先）、Readability、LLM 提取
- **输出**：标准字段（title、author、summary、contentHtml、pubDate）

### sites（站点管理）
- **职责**：聚合内置站点与外部插件，提供站点匹配与能力查询
- **匹配**：按 `listUrlPattern` 计算具体度，返回最匹配的站点
- **插件加载**：`plugins/`（内置）+ `.rssany/plugins/`（用户），同 id 时用户插件优先
- **siteConfig**：从 `.rssany/sites.json` 加载代理与刷新间隔，正则 pattern 为 key

### auth（认证抽象）
- **职责**：定义 AuthFlow 类型与认证错误，与 fetcher 配合使用
- **流程**：feeder 预检 → 检查 cookies → 失败抛出 AuthRequiredError → router 返回 401

### cacher（缓存管理）
- **职责**：统一管理缓存写入/读取，包括 HTML 缓存与认证档案持久化
- **结构**：`cache/fetched/`、`cache/parsed/`、`cache/extracted/`、`cache/feeds/`、`cache/domains/`
- **key 策略**：`cacheKey(url, strategy)` 根据刷新间隔生成时间窗口 key，过期即失效

### db（数据库层）
- **职责**：管理 SQLite 单例，提供 FeedItem 的增量写入与查询
- **位置**：`.rssany/data/rssany.db`
- **接口**：`upsertItems`、`updateItemContent`、`queryItems`、`getPendingPushItems`、`markPushed`
- **FTS5**：`items_fts` 虚拟表支持对 title/summary/content 全文检索

### llm（LLM 统一调用）
- **职责**：封装 OpenAI API 调用，供 parser/extractor 的 LLM 模式使用
- **配置**：从环境变量读取 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL

## 数据流程

1. **RSS 生成 + 入库流程**：
   ```
   URL → getSite() → preCheckAuth() → fetchHtml() → parseHtml()
     → upsertItems() → buildRssXml()
     → [后台] extractItem() → updateItemContent() → 更新缓存
   ```

2. **认证流程**：
   ```
   检查 cache/domains/{domain}.json → 无效则 ensureAuth() → 打开有头浏览器 →
   用户登录 → 保存 cookies → 后续请求自动携带
   ```

3. **插件加载流程**：
   ```
   启动时扫描 plugins/*.rssany.{js,ts}（内置）
         + .rssany/plugins/*.rssany.{js,ts}（用户）
   → 合并到 registeredSites（用户插件覆盖同 id 内置插件）
   → 开发模式监听两个目录文件变化自动重载
   ```

4. **OpenWebUI 推送流程**（待实现）：
   ```
   GET /api/items/pending-push → 获取未推送且有正文的条目
   → POST 到 OpenWebUI /api/v1/files 或 /api/v1/knowledge
   → POST /api/items/mark-pushed → 更新 pushed_at
   ```

## 关键特性

- **模块解耦**：各模块职责清晰，通过接口交互，便于测试与替换
- **插件化**：站点规则通过插件扩展，用户插件独立于项目代码
- **用户数据隔离**：`.rssany/` 目录存放所有用户数据，gitignore，升级时不覆盖
- **智能降级**：自定义解析器 → LLM 解析 → 通用兜底
- **增量存储**：SQLite `INSERT OR IGNORE` 天然去重，`pushed_at` 追踪推送状态
- **缓存策略**：时间窗口 key（10min/30min/1h/6h/12h/1day/3day/7day），过期即重抓
- **代理支持**：通过 `.rssany/sites.json` 正则匹配配置站点级代理
- **认证管理**：自动检测登录状态，支持有头浏览器手动登录

## 下一步建议

### 1. OpenWebUI 推送脚本（优先级：高）
实现一个独立的推送脚本或定时任务，将 `pending-push` 条目批量推送到 OpenWebUI 知识库：
- 调用 `GET /api/items/pending-push?limit=100`
- 将 content 按 Markdown 格式封装后，`POST /api/v1/files`（OpenWebUI API）
- 成功后调用 `POST /api/items/mark-pushed`
- 可作为 `/api/push` 路由或独立 cron 脚本运行

### 2. 定时刷新机制（优先级：高）
目前只有 HTTP 请求才会触发抓取，数据库不会自动增量。需要实现：
- 订阅的定时刷新（参考 `.rssany/sites.json` 中配置的 refresh 间隔）
- 在 `src/app/index.ts` 的 `main()` 中启动定时器，按 refresh 策略轮流触发各订阅信源

### 3. 前端迁移至 SvelteKit（优先级：中）
当架构稳定后，将 `statics/*.html` 迁移到 SvelteKit：
- topbar 等公共组件统一管理，告别跨文件复制粘贴
- SvelteKit 可以直接与 Hono 后端并存，职责清晰
- 建议时机：定时刷新和 OpenWebUI 推送完成后

### 4. 数据库维护（优先级：低）
- 实现 `VACUUM` + 旧数据清理接口（如 30 天前且已推送的条目）
- 在管理页面增加数据库统计展示（总条目数、待推送数、各信源条目数）

## 插件规则

### 文件规范

- **文件命名**：必须以 `.rssany.js` 或 `.rssany.ts` 结尾
- **内置插件**：放在项目根目录 `plugins/` 下，随代码版本管理
- **用户插件**：放在 `.rssany/plugins/` 下，不纳入版本管理，可覆盖同 id 的内置插件
- **模块格式**：必须使用 ESM 模块，通过 `export default` 导出 Site 对象

### Site 接口

插件必须实现 `Site` 接口（定义在 `src/sites/types.ts`），包含以下字段：

#### 必填字段

- **`id`** (string)：站点唯一标识符，如 `"xiaohongshu"`、`"lingowhale"`
- **`listUrlPattern`** (string | RegExp)：列表页 URL 匹配模式

#### 可选字段

- **`detailUrlPattern`** (string | RegExp | null)：详情页 URL 模式
- **`parser`** (CustomParserFn | null)：自定义列表页解析函数
- **`extractor`** (CustomExtractorFn | null)：自定义正文提取函数
- **`checkAuth`** (CheckAuthFn | null)：检查是否已登录
- **`loginUrl`** (string | null)：登录页 URL
- **`domain`** (string | null)：域名，用于保存 cookies
- **`loginTimeoutMs`** (number | null)：登录超时（毫秒，默认 300000）
- **`pollIntervalMs`** (number | null)：轮询间隔（毫秒，默认 2000）

### 示例

```javascript
// plugins/example.rssany.js  （内置）
// .rssany/plugins/example.rssany.js  （用户，可覆盖上面的内置版本）
import { parse } from "node-html-parser";

function parser(html, url) {
  const root = parse(html);
  return root.querySelectorAll(".item").map(item => ({
    title: item.querySelector(".title")?.textContent || "",
    link: new URL(item.querySelector("a")?.getAttribute("href"), url).href,
    description: item.querySelector(".summary")?.textContent || "",
  }));
}

export default {
  id: "example",
  listUrlPattern: "https://example.com/user/{userId}",
  detailUrlPattern: "https://example.com/post/{postId}",
  parser,
  loginUrl: "https://example.com/login",
  domain: "example.com",
};
```

### 站点配置（`.rssany/sites.json`）

使用正则 pattern 为 key，越具体（字符串越长）越优先：

```json
{
  "xiaohongshu\\.com": {
    "proxy": "http://127.0.0.1:7890",
    "refresh": "1h"
  },
  "x\\.com": {
    "proxy": "socks5://127.0.0.1:1080",
    "refresh": "30min"
  }
}
```

支持的刷新间隔：`10min` / `30min` / `1h` / `6h` / `12h` / `1day`（默认）/ `3day` / `7day`
