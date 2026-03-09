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
│   ├── pipeline/            入库前固定处理链（tagger、translator，与 plugins 同级别）
│   ├── mcp/                 MCP 服务（stdio，list_channels / get_channel_feeds / get_feed_detail / search_feeds）  
│   ├── scraper/             抓取与信源
│   │   ├── sources/        getSource、web/api/email
│   │   │   ├── web/        Site 插件、fetcher/parser/extractor/pluginLoader
│   │   │   ├── api/        RSS/Atom/JSON Feed
│   │   │   └── email/      IMAP
│   │   ├── enrich/          正文提取任务队列
│   │   ├── auth/            认证抽象
│   │   ├── subscription/    sources.json 读写
│   │   └── scheduler/       定时抓取
│   ├── types/               FeedItem、译文等
│   └── utils/               refreshInterval 等
├── plugins/                内置站点插件（sources、enrich，*.rssany.{js,ts}）
└── statics/                静态 HTML

用户数据（.rssany/，首次启动自动创建）
├── sources.json            爬虫配置 { sources: [] }
├── channels.json           频道配置（id 英文、title 中文：产品/项目/人物/研究/论文/资讯）
├── config.json             enrich、pipeline 等
├── cache/                  运行时缓存（fetched、extracted、feeds、domains、browser_data）
├── plugins/                用户插件
└── data/rssany.db          SQLite
```

> **四块对应**：**core** = `src/core/`；**feeder** = `src/feeder/`；**scraper** = `src/scraper/`；**db** = `src/db/`（外层统一，SQLite 与 CRUD 均在此）。

## 架构模块（core / feeder / scraper / db）

### core（基础设施）
- **cacher**：缓存 key 与目录（fetched/extracted/feeds/domains）。
- **channel**：channels.json 读写、getAllChannelConfigs、collectAllSourceRefs（首页信息流聚合）。
- **events**：事件总线（emitFeedUpdated / onFeedUpdated）。
- **logger**：统一日志落库，供 API/页面查看；依赖 db.insertLog。
- **llm**：OpenAI 封装，供 parser/extractor 的 LLM 模式。

### feeder（RSS 生成核心）
- 根据 URL 生成 RSS：缓存 → getSource → fetchItems → upsertItems → buildRssXml；有 enrichItem 则提交队列，完成后 **pipeline**（仅一次）→ updateItemContent 并更新缓存；无 enrich 时 pipeline 在入库后对每条执行一次。支持 `lng` 译文输出。writeDb 时写库并可选用写文件模块将条目落盘（见下文「写文件模块」）。

### pipeline（入库前固定处理链）
- **职责**：对条目执行固定流程（打标签、翻译），与 plugins 同级别，不作为插件。
- **位置**：`app/pipeline/`（tagger、translator 等固定步骤）。
- **配置**：`.rssany/config.json` 的 `pipeline.steps` 控制步骤开关与排序，格式 `[{ id, enabled }]`。
- **执行时机**：每条条目仅执行一次——有 enrich 时在 enrichItem 完成后；无 enrich 时在 upsertItems 之后。

### scraper（抓取与信源）
- **sources**：Source 接口与 getSource；web（Site + fetcher/parser/extractor/pluginLoader）、api（RSS/Atom/JSON）、email（IMAP）。
- **enrich**：正文提取任务队列，并发/重试可配置，完成后更新 feed 缓存。
- **auth**：AuthFlow、AuthRequiredError，与 fetcher 配合；401 由 router 处理。
- **subscription**：sources.json 读写。
- **scheduler**：定时抓取调度。

### db（数据库层）
- 实现位于 **`src/db/`**（与 core、feeder、scraper 平级）：SQLite 单例、FeedItem CRUD、日志表、FTS5 全文检索。getItemById 按 id（guid）查单条供 MCP/API 详情使用。

### MCP 服务
- **入口**：与主站同进程，路径 **`GET/POST /mcp`**，采用 **Streamable HTTP（SSE）** 传输；客户端 GET 建立 SSE、POST 发送 JSON-RPC。
- **工具**：`list_channels`（频道列表 id/title/description）、`get_channel_feeds`（指定频道或全部的条目列表，不含 content）、`get_feed_detail`（按 item_id 返回单条完整详情含 content）、`search_feeds`（全文搜索 title/summary/content，支持 source_url 过滤与分页）。
- **数据**：复用 .rssany/channels.json 与 SQLite，与 HTTP API 同源。实现见 `src/mcp/server.ts`。

### app（HTTP 路由层）
- **职责**：Hono 框架实现的 HTTP 服务，负责路由分发、参数解析、错误处理
- **路由**：
  - `/rss/*`：生成 RSS XML
  - `/admin/parse/*`、`/admin/extractor/*`：开发调试工具（Parse/Enrich 返回 JSON）
  - `/feed`、`/subscriptions`：管理页面；`/admin` 下含频道、插件、日志、MCP、Parse、Enrich
  - **`/mcp`**：MCP 服务（Streamable HTTP/SSE，工具 list_channels / get_channel_feeds / get_feed_detail / search_feeds）
  - `/api/items`：数据库条目查询（含 FTS 全文搜索）
  - `/api/items/pending-push`、`/api/items/mark-pushed`：OpenWebUI 推送接口
  - `/auth/*`：认证管理
- **解耦**：与业务逻辑（feeder）解耦，可替换为 Express 等框架。路由支持 `lng` 参数时按译文输出（/rss/*、/api/rss、/api/feed、/api/items）。

## 数据流程

1. **RSS 生成 + 入库流程**：
   ```
   URL → getSource() → preCheckAuth() → fetchItems()
     → upsertItems() → buildRssXml()
     → [后台] enrichItem() → pipeline（仅一次）→ updateItemContent() → 更新缓存
   ```
   （无 enrich 时：upsertItems 后对每条执行 pipeline → updateItemContent）

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

### 两阶段插件系统 + 固定 pipeline

插件按职责分为两个阶段，pipeline 为固定流程（与 plugins 同级别）：

| 阶段 | 目录 | 职责 | 执行时机 |
|------|------|------|----------|
| **sources** | `plugins/sources/`、`.rssany/plugins/sources/` | 定义信源（Site/Source），负责列表抓取与解析 | fetchItems 时 |
| **enrich** | `plugins/enrich/`、`.rssany/plugins/enrich/` | 对单条补全正文（content）等 | enrichItem 队列中，列表入库后异步执行 |
| **pipeline** | `app/pipeline/` | 固定流程：打标签、翻译（非插件） | 每条仅一次：有 enrich 在补全后；无 enrich 在入库后 |

- **sources**：决定「抓什么、怎么抓」；内置 web/api/email 等信源类型，用户可扩展 Site 或 Source。
- **enrich**：决定「补全什么」；通过 `match(item, ctx)` 判断是否适用，`enrichItem` 返回带 content 的完整条目。
- **pipeline**：固定流程，位于 `app/pipeline/`，包含 tagger（打标签）、translator（翻译）等步骤，按顺序执行。

**分布式爬虫**：若需将抓取任务分散到多机，可在 pipeline 中扩展步骤，对条目执行 `fetch(url, { method: 'POST', body: JSON.stringify(item) })` 投递到其他节点的接收路由，由远端完成入库或二次处理；本地可选择跳过入库或仅做轻量记录。

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
- **`enrichItem`** (function | null)：对单条补全正文（后台任务）；不实现则不做正文抓取，适合即时资讯类（如 X）

### 正文补全（enrichItem）与上下文

- **fetchItems** 只负责列表；需要详情正文时实现 **enrichItem(item, ctx)**，返回带 `content` 的完整条目。
- **ctx** 提供：
  - **ctx.fetchHtml(url, opts?)**：用浏览器抓取 URL，返回 `{ html, finalUrl, status }`（带认证与 cookie）。
  - **ctx.extractItem(item, opts?)**：默认正文提取——拉取 `item.link` 后用 Readability 提取并合并回条目。需要正文但无需自写解析时可直接 `return ctx.extractItem(item)`；自定义解析则 `ctx.fetchHtml(item.link)` 后自行解析。
- **即时资讯类**（如 X、HN 最新）：不实现 `enrichItem` 即可，列表即最终内容。

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

