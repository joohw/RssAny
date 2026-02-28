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

项目按 **core**、**feeder**、**scraper**、**db** 四大块组织；用户数据与运行时分离。

```
项目文件（纳入版本管理）
├── src/
│   ├── app/                HTTP 路由层（Hono）
│   ├── core/               基础设施
│   │   ├── cacher/         缓存 key 与目录策略
│   │   ├── channel/        首页频道配置（channels.json 读写与聚合）
│   │   ├── events/         应用内事件（如 feed:updated）
│   │   ├── logger/          统一日志（落库）
│   │   └── llm/             OpenAI 封装
│   ├── config/             路径、adminToken 等配置
│   ├── db/                  SQLite、FeedItem CRUD、日志表（外层统一）
│   ├── feeder/              RSS 生成核心
│   ├── scraper/             抓取与信源
│   │   ├── sources/        getSource、web/api/email
│   │   │   ├── web/        Site 插件、fetcher/parser/extractor/pluginLoader
│   │   │   ├── api/        RSS/Atom/JSON Feed
│   │   │   └── email/      IMAP
│   │   ├── enrich/          正文提取任务队列
│   │   ├── auth/            认证抽象
│   │   ├── subscription/    sources.json 读写
│   │   └── scheduler/       定时抓取
│   ├── signal/             写文件模块（条目以 Markdown 落盘到配置目录）
│   ├── types/               FeedItem、译文等
│   └── utils/               refreshInterval 等
├── plugins/                内置站点插件（*.rssany.{js,ts}）
├── statics/                静态 HTML
└── cache/                  运行时缓存（gitignore）

用户数据（.rssany/，首次启动自动创建）
├── sources.json            爬虫配置 { sources: [] }
├── channels.json           频道 → sourceRefs
├── config.json             enrich、signal（写文件）等
├── plugins/                用户插件
└── data/rssany.db          SQLite
```

> **四块对应**：**core** = `src/core/`；**feeder** = `src/feeder/`；**scraper** = `src/scraper/`；**db** = `src/db/`（外层统一，SQLite 与 CRUD 均在此）。

## 架构模块（core / feeder / scraper / db）

### core（基础设施）
- **cacher**：缓存 key 与目录（fetched/parsed/extracted/feeds/domains）。
- **channel**：channels.json 读写、getAllChannelConfigs、collectAllSourceRefs（首页信息流聚合）。
- **events**：事件总线（emitFeedUpdated / onFeedUpdated）。
- **logger**：统一日志落库，供 API/页面查看；依赖 db.insertLog。
- **llm**：OpenAI 封装，供 parser/extractor 的 LLM 模式。

### feeder（RSS 生成核心）
- 根据 URL 生成 RSS：缓存 → getSource → fetchItems → upsertItems → buildRssXml；有 enrichItem 则提交队列，完成后 updateItemContent 并更新缓存。支持 `lng` 译文输出。writeDb 时写库并可选用写文件模块将条目落盘（见下文「写文件模块」）。

### scraper（抓取与信源）
- **sources**：Source 接口与 getSource；web（Site + fetcher/parser/extractor/pluginLoader）、api（RSS/Atom/JSON）、email（IMAP）。
- **enrich**：正文提取任务队列，并发/重试可配置，完成后更新 feed 缓存。
- **auth**：AuthFlow、AuthRequiredError，与 fetcher 配合；401 由 router 处理。
- **subscription**：sources.json 读写。
- **scheduler**：定时抓取调度。

### db（数据库层）
- 实现位于 **`src/db/`**（与 core、feeder、scraper 平级）：SQLite 单例、FeedItem CRUD、日志表、FTS5 全文检索。

### app（HTTP 路由层）
- **职责**：Hono 框架实现的 HTTP 服务，负责路由分发、参数解析、错误处理
- **路由**：
  - `/rss/*`：生成 RSS XML
  - `/parse/*`、`/extractor/*`：开发调试工具（同时有独立 HTML 页面）
  - `/feed`、`/subscriptions`、`/plugins`：管理页面
  - `/api/items`：数据库条目查询（含 FTS 全文搜索）
  - `/api/items/pending-push`、`/api/items/mark-pushed`：OpenWebUI 推送接口
  - `/auth/*`：认证管理
- **解耦**：与业务逻辑（feeder）解耦，可替换为 Express 等框架。路由支持 `lng` 参数时按译文输出（/rss/*、/api/rss、/api/feed、/api/items）。

### signal（写文件模块）
- **职责**：将入库条目以「一条信息一个文件」的形式写入配置的本地目录，仅写文件、不执行 git 操作，便于后续用 Git 或文档分析引擎使用。
- **配置**：在 `.rssany/config.json` 中增加 `signal` 块：`enabled`（是否启用，默认 `false`）、`repoPath`（写文件目标目录，支持相对或绝对路径）。环境变量 `SIGNAL_REPO_PATH` 可覆盖 `repoPath`；未配置或 `enabled: false` 时不写文件。
- **目录与文件名**：根目录为 `repoPath`，其下固定子目录 `items/`，再按日期分子目录 `YYYY-MM-DD`。单条对应 `items/YYYY-MM-DD/<id>.md`，日期取自条目 `pubDate`（无则用当天）。`<id>` 为稳定唯一 id（如 link 的 SHA256 前 16 位十六进制），同一 link 去重为同一文件。
- **Markdown 格式**：UTF-8；YAML frontmatter（`---` 起止）+ 正文。frontmatter 推荐字段：`id`、`url`、`source_url`、`sources`、`title`、`author`、`pub_date`、`fetched_at`。正文第一行建议一级标题 `# <title>`，随后摘要与正文（由 `contentHtml` 等生成）。
- **接入点**：在 feeder 层与写库同步触发——当 `writeDb: true` 且写文件配置启用时，在 `upsertItems` 之后对当次列表条目批量写文件，在 `updateItemContent` 之后对单条再写一次（覆盖同一文件，并合并 `sources`）。写文件失败仅记录日志，不阻塞 RSS 生成与写库。

## 数据流程

1. **RSS 生成 + 入库流程**：
   ```
   URL → getSource() → preCheckAuth() → fetchItems()
     → upsertItems() → buildRssXml()
     → [后台] enrichItem() → updateItemContent() → 更新缓存
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
   → 合并到 registeredSources（用户插件覆盖同 id 内置插件）
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
- **代理支持**：在插件 `Site.proxy` 或 `sources.json` 的 `sources[].proxy` 字段中配置，无需全局 sites.json
- **认证管理**：自动检测登录状态，支持有头浏览器手动登录



## 插件规则

### 文件规范

- **文件命名**：必须以 `.rssany.js` 或 `.rssany.ts` 结尾
- **内置插件**：放在项目根目录 `plugins/` 下，随代码版本管理
- **用户插件**：放在 `.rssany/plugins/` 下，不纳入版本管理，可覆盖同 id 的内置插件
- **模块格式**：必须使用 ESM 模块，通过 `export default` 导出 Site 对象

### Site 接口

插件必须实现 `Site` 接口（定义在 `src/scraper/sources/web/site.ts`），包含以下字段：

#### 必填字段

- **`id`** (string)：站点唯一标识符，如 `"xiaohongshu"`、`"lingowhale"`
- **`listUrlPattern`** (string | RegExp)：列表页 URL 匹配模式

#### 可选字段

- **`detailUrlPattern`** (string | RegExp | null)：详情页 URL 模式
- **`refreshInterval`** (RefreshInterval | null)：条目有效时间窗口，作用于缓存键、DB 查询和调度间隔；不填默认 `1day`
- **`proxy`** (string | null)：代理地址，如 `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080`；不填则使用 env `HTTP_PROXY`
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
  refreshInterval: "1h",
  proxy: "http://127.0.0.1:7890",
  parser,
  loginUrl: "https://example.com/login",
  domain: "example.com",
};
```

### 订阅配置中的代理与刷新间隔（`.rssany/sources.json`）

也可在爬虫配置（sources.json）中对单个信源设置代理或刷新间隔，优先级高于插件声明：

```json
{
  "tech": {
    "title": "科技资讯",
    "sources": [
      {
        "ref": "https://example.com/user/123",
        "label": "示例站点",
        "refresh": "1h",
        "proxy": "http://127.0.0.1:7890"
      }
    ]
  }
}
```

支持的刷新间隔：`10min` / `30min` / `1h` / `6h` / `12h` / `1day`（默认）/ `3day` / `7day`

### 代理优先级链

```
SubscriptionSource.proxy（sources.json 单源覆盖）
  → FeederConfig.proxy（调用方传入）
  → Source.proxy / Site.proxy（插件声明）
  → process.env.HTTP_PROXY（环境变量兜底）
```

