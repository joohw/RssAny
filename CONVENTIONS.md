# RssAny 开发约定

本文件描述 RssAny 项目的代码规范、架构约定与开发模式，供 AI 编程助手（DeepWiki、Cursor 等）理解项目结构时参考。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 运行时 | Node.js >= 20，ESM 模块 |
| 语言 | TypeScript（严格模式） |
| HTTP 框架 | Hono + @hono/node-server |
| 数据库 | better-sqlite3（SQLite，同步 API） |
| 浏览器自动化 | puppeteer-core |
| HTML 解析 | node-html-parser / jsdom / @mozilla/readability |
| LLM | OpenAI SDK（兼容任意 OpenAI 格式接口） |
| 前端 | SvelteKit（位于 `webui/` 子目录） |
| 构建 | Vite |
| 测试 | Vitest |

---

## 代码风格

### 格式规则

- **函数内部**：单个函数内部不换行（紧凑书写）
- **函数之间**：函数与函数之间空三行
- **函数开头**：每个函数顶部写一行中文注释说明用途
- **缩进**：2 空格
- **引号**：双引号（字符串），单引号仅用于 JSX/模板场景
- **分号**：省略（无分号风格）

### TypeScript 规范

- 所有公共接口使用 `interface` 或 `type` 显式声明，存放在同目录 `types.ts` 中
- 避免 `any`，优先使用 `unknown` + 类型收窄
- 异步函数统一用 `async/await`，不用 `.then()` 链式调用
- 模块导出统一用命名导出（`export`），入口文件可用 `export default`
- 插件文件（`*.rssany.ts`）必须 `export default` 一个 `Site` 对象

### 命名约定

| 类型 | 风格 | 示例 |
|------|------|------|
| 变量 / 函数 | camelCase | `fetchItems`, `cacheKey` |
| 类 / 接口 | PascalCase | `FeedItem`, `Source` |
| 常量 | camelCase（不用 UPPER_SNAKE） | `defaultRefreshInterval` |
| 文件名 | kebab-case 或 camelCase | `pluginLoader.ts`, `refreshInterval.ts` |
| 插件文件 | `{id}.rssany.{js,ts}` | `xiaohongshu.rssany.ts` |

---

## 架构约定

### 模块边界

- 每个顶层目录（`feeder/`、`sources/`、`db/` 等）代表一个模块，通过 `index.ts` 对外暴露接口
- 模块之间只能依赖 `index.ts` 暴露的接口，不直接引用模块内部文件
- `app/` 层只调用 `feeder/`、`db/`、`sources/` 等模块的公开 API，不内联业务逻辑

### 数据流方向

```
HTTP Request (app/router.ts)
  → feeder/feeder.ts（协调）
    → sources/index.ts → getSource()
    → source.fetchItems()（抓取+解析列表）
    → db.upsertItems()（写库）
    → buildRssXml()（构建 XML）
    → [后台] source.enrichItem()（提取正文）
    → db.updateItemContent()（更新正文）
```

### 错误处理

- 业务错误（如认证失败）使用自定义 Error 子类，在 `auth/errors.ts` 等模块内定义
- HTTP 层在 `app/router.ts` 中统一捕获，转换为适当的 HTTP 状态码
- 后台任务（enrichItem）的错误只记录日志，不影响主流程

### 缓存策略

- 缓存 key 由 `cacheKey(url, refreshInterval)` 生成，包含时间窗口（如 `1h_2024010112`）
- 时间窗口过期即视为缓存失效，无需主动清理
- feed 级缓存：读+写；fetch/parse/extract 级：仅写（供调试分析）

---

## 目录约定

### 源代码（`src/`）

```
src/
├── app/          HTTP 层，路由与中间件
├── feeder/       RSS 生成核心，协调各模块
├── sources/      信源抽象
│   ├── types.ts  Source 接口定义
│   ├── index.ts  getSource() 入口
│   ├── web/      网页信源（Puppeteer + 插件）
│   ├── api/      标准 RSS/Atom/JSON Feed
│   └── email/    IMAP 邮件信源
├── db/           SQLite 数据库层
├── cacher/       缓存读写
├── auth/         认证抽象与错误
├── llm/          OpenAI API 封装
├── scheduler/    定时刷新调度
├── subscription/ 订阅配置（.rssany/subscriptions.json）
├── feed/         RSS XML 构建
├── config/       路径常量（paths.ts）
├── events/       事件总线
├── types/        共享类型（FeedItem 等）
└── utils/        工具函数（refreshInterval.ts 等）
```

### 插件（`plugins/`）

- 每个站点一个文件，命名为 `{站点id}.rssany.{js,ts}`
- `export default` 一个实现 `Site` 接口的对象（见 `src/sources/web/site.ts`）
- 内置插件在 `plugins/`，用户插件在 `.rssany/plugins/`，同 id 时用户插件优先

### 用户数据（`.rssany/`，gitignore）

- `subscriptions.json`：订阅配置，信源列表
- `plugins/`：用户自定义插件
- `data/rssany.db`：SQLite 数据库

---

## 关键接口

### Source（信源）

```typescript
interface Source {
  id: string
  pattern: string | RegExp
  refreshInterval: RefreshInterval
  proxy?: string | null
  fetchItems(url: string, options: FetchOptions): Promise<FeedItem[]>
  enrichItem?(item: FeedItem, options: FetchOptions): Promise<Partial<FeedItem>>
  preCheck?(url: string): Promise<void>
}
```

### FeedItem（条目）

```typescript
interface FeedItem {
  id: string          // 唯一标识（通常为 link 的 hash）
  title: string
  link: string
  summary?: string
  content?: string    // 完整正文 HTML
  author?: string
  pubDate?: string    // ISO 8601
  sourceUrl: string   // 来源列表页 URL
  pushedAt?: string   // 推送到 OpenWebUI 的时间
}
```

### Site 插件接口

```typescript
interface Site {
  id: string
  listUrlPattern: string | RegExp
  detailUrlPattern?: string | RegExp | null
  refreshInterval?: RefreshInterval | null
  proxy?: string | null
  parser?: CustomParserFn | null
  extractor?: CustomExtractorFn | null
  checkAuth?: CheckAuthFn | null
  loginUrl?: string | null
  domain?: string | null
  loginTimeoutMs?: number | null
  pollIntervalMs?: number | null
}
```

---

## 测试约定

- 测试文件放在 `tests/` 目录，文件名格式：`{模块}-{功能}.{unit,e2e}.test.ts`
- 端到端测试（e2e）可以真实调用网络，需要在 CI 中跳过或 mock
- 单元测试 mock 外部依赖（Puppeteer、LLM、网络请求）

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | HTTP 监听端口 | `3751` |
| `NODE_ENV` | 运行环境 | `production` |
| `OPENAI_API_KEY` | LLM API Key | — |
| `OPENAI_BASE_URL` | LLM API 地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | LLM 模型名 | `gpt-4o-mini` |
| `HTTP_PROXY` | 全局代理（兜底） | — |

---

## Signal 仓库投递（AI Signals）

RssAny 可将入库的条目以「一条信息一个文件」的形式投递到本地 Signal 仓库目录（与 RssAny 同级别工作区，如 `../AI-Signals`），仅写文件、不执行 git commit/push，便于后续用 Git 或文档分析引擎使用。

### 配置

- 在 `.rssany/config.json` 中增加 `signal` 块：
  - `enabled`: 是否启用投递，默认 `false`
  - `repoPath`: Signal 仓库的本地路径，支持相对路径（相对当前工作目录）或绝对路径，例如 `"../AI-Signals"`
- 环境变量兜底：`SIGNAL_REPO_PATH` 覆盖 `repoPath`；未配置或 `enabled: false` 时不投递。

### 目录与文件名

- 投递根目录为 `repoPath`，其下固定子目录为 `items/`，再按日期分子目录 `YYYY-MM-DD`。
- 单条信息对应一个文件，路径为 `items/YYYY-MM-DD/<id>.md`。日期取自条目的 `pubDate`（无则用当天）。
- `<id>` 为**仅作唯一标识的稳定 id**，不包含任何元信息（如频道、日期、标题）：由条目原文链接 `link` 的 SHA256 前 16 位十六进制字符串构成，保证同一链接在不同频道下去重为同一文件。

### Markdown 格式约定

- **编码**：UTF-8。
- **结构**：YAML frontmatter + 正文。
  - 第一行必须为 `---`。
  - frontmatter 为 YAML 键值对，与正文之间以第二个 `---` 分隔。
  - 正文为 Markdown，用于标题与正文内容。

**Frontmatter 字段（均为可选，但推荐写入）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 条目唯一标识（如 guid） |
| `url` | string | 原文链接 |
| `source_url` | string | 当前来源列表页 URL（单条） |
| `sources` | string[] | 该信息出现过的所有列表页 URL（多次投递时合并） |
| `title` | string | 标题 |
| `author` | string | 作者 |
| `pub_date` | string | 发布时间，ISO 8601 |
| `fetched_at` | string | 抓取时间，ISO 8601 |

**正文：**

- 第一行建议为一级标题：`# <title>`，便于纯文本阅读与检索。
- 随后为摘要（若有），再后为正文（`contentHtml` 转成的 Markdown 或保留 HTML 片段，由实现决定）。
- 若仅有摘要无正文，则只写摘要；两者皆无则仅保留标题行。

**示例：**

```markdown
---
id: "https://example.com/post/123"
url: "https://example.com/post/123"
source_url: "https://example.com/user/456"
sources:
  - "https://example.com/user/456"
title: "示例标题"
author: "作者"
pub_date: "2025-02-27T12:00:00.000Z"
fetched_at: "2025-02-27T14:00:00.000Z"
---

# 示例标题

这里是摘要或正文……
```

### 接入点

- 投递在 **feeder** 层与写库同步触发：当 `writeDb: true` 且 Signal 配置启用时，在 `upsertItems` 之后对当次列表条目调用批量投递，在 `updateItemContent` 之后对单条更新再投递一次（覆盖同一文件，并合并 `sources`）。
- 投递失败仅记录日志，不阻塞 RSS 生成与写库。

---

## 常见模式

### 新增信源类型

1. 在 `src/sources/` 下创建子目录（如 `src/sources/mytype/`）
2. 实现 `Source` 接口，导出 `getSource(url): Source | null`
3. 在 `src/sources/index.ts` 的 `getSource()` 中注册优先级

### 新增插件

1. 在 `plugins/` 创建 `{id}.rssany.ts`
2. 实现 `Site` 接口并 `export default`
3. 服务会在启动时（或开发模式下文件变化时）自动加载

### 新增 API 路由

1. 在 `src/app/router.ts` 中添加路由
2. 业务逻辑委托给对应模块，路由层只做参数解析与错误转换

### 数据库迁移

- 在 `src/db/index.ts` 中用 `db.exec()` 执行 DDL
- 使用 `CREATE TABLE IF NOT EXISTS` 保证幂等
- FTS 虚拟表用 `CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(...)`
