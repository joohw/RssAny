# RssAny

> 将任意内容源统一为可订阅的信息流 —— 网页、RSS Feed、邮件收件箱，一站聚合。

RssAny 是一个通用的内容聚合与信息流平台。它不仅能将任意网页转换为标准 RSS 源供阅读器订阅，还能将多个异构信源（网页、RSS、IMAP 邮件）聚合为统一的信息流，持久化到本地 SQLite 数据库，供 RSS 阅读器、OpenWebUI 知识库或 RAG 管道消费。

## 特性

- **RSS 生成**：根据列表页 URL 自动抓取、解析并生成 RSS XML，可直接投喂给任意 RSS 阅读器
- **信息流聚合**：将多个信源（网页 + RSS Feed + 邮件）聚合为单一时间线，支持分页与过滤
- **邮件收件箱**：通过 IMAP 协议抓取邮件，将 Newsletter 纳入统一信息流
- **智能解析**：支持自定义解析器与 LLM 解析两种模式
- **正文提取**：支持自定义提取器、Readability 与 LLM 提取
- **自动打标签与翻译**：内置 LLM pipeline 插件，新条目自动打标签并翻译为中文
- **实时通知**：新内容到达时通过 SSE 实时推送前端，无需手动刷新
- **认证管理**：支持需要登录的站点，通过 Puppeteer 管理 cookies
- **三阶段插件系统**：Source（抓取）/ Enrich（补全正文）/ Pipeline（二次加工）三阶段插件，内置 + 用户插件双目录
- **缓存机制**：多级缓存策略，提升性能与稳定性
- **持久化存储**：SQLite 数据库增量存储所有条目，支持 FTS5 全文检索

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm

### 安装

```bash
# 安装后端依赖
pnpm install

# 安装前端依赖
cd webui && pnpm install && cd ..
```

### 配置

复制示例配置并按需修改：

```bash
cp sources.example.json .rssany/sources.json
cp channels.example.json .rssany/channels.json
```

若已有 `.rssany/subscriptions.json`，首次启动会自动迁移为 `sources.json`，并可根据 `sources.json` 生成默认 `channels.json`。

配置 LLM（用于智能解析、正文提取与自动打标签，可选）：

```bash
export OPENAI_API_KEY=your_key
export OPENAI_BASE_URL=https://api.openai.com/v1  # 可替换为兼容接口
export OPENAI_MODEL=gpt-4o-mini
```

配置后，新入库条目将自动调用 LLM 从系统标签库中匹配标签；未配置则跳过。系统标签在「标签」页面配置和删除，对应 `.rssany/tags.json`，也可通过 `GET/PUT /api/tags` 读写。

### 启动

**开发模式**（推荐，前端 HMR + 后端热重载）：

```bash
# 终端 1：后端
pnpm dev

# 终端 2：前端 dev server（访问 http://localhost:5173）
cd webui && pnpm dev
```

**生产模式**（前端与后端分离，前端仍在 5173 端口提供 UI）：

```bash
# 构建前端
cd webui && pnpm build && cd ..

# 启动后端（API 监听 http://localhost:3751）
pnpm start

# （可选）独立运行 WebUI preview / 静态服务器（继续使用 5173 端口）
cd webui && pnpm preview --port 5173
```

服务默认监听 `http://localhost:3751`（仅作为 API + RSS 端点）。

## 全局数据流向

RssAny 支持两条数据摄入路径，最终汇聚到缓存与数据库，供 Web UI、API、MCP 等消费。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            数据摄入（两条路径）                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  内部爬虫路径：                                                                   │
│  url / Imap / RSS ──► Source 插件 ──► Enrich 插件 ──► Pipeline 插件 ──► Cache ──► DB │
│       │                    │               │                │           │       │
│       └── fetchItems       └── enrichItem  └── 翻译/打标签   └── feeds  └── SQLite │
│           (列表抓取)          (正文补全)       (每条仅一次)      (缓存)     (持久化)  │
│                                                                                 │
│  外部 Gateway 路径：                                                              │
│  External Scrappers ──► POST /api/gateway/items ──► Pipeline ──► DB              │
│       │                            │                    │                       │
│       └── 分布式爬虫/其他服务         └── 接收 FeedItem[]   └── 同内部流程入库       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                            数据消费                                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Web UI ◄── Backend API ◄── Database                                              │
│     │           │                                                                 │
│     │           ├── Agent ◄──► Tools ◄──► MCP ◄──► Mcp Server                     │
│     │           │                                                                 │
│     └───────────┴── 信息流 / RSS / 全文搜索 / 推送 OpenWebUI                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **三阶段插件**：Source（抓什么）→ Enrich（补全正文）→ Pipeline（翻译/打标签），每条仅执行一次
- **Gateway**：外部爬虫可通过 `POST /api/gateway/items` 推送 FeedItem，经 Pipeline 后入库，支持分布式架构

## WebUI

访问 `http://localhost:5173`（开发或预览/生产）打开管理界面；后端不再提供 UI 静态路由，仅保留 API + RSS。

| 页面         | 说明                               |
| ---------- | -------------------------------- |
| **信息流**    | 多源聚合时间线，实时推送新内容                  |
| **信源**     | 展示频道中所有可用的订阅源（ref），点击进入预览        |
| **频道**     | 编辑 `channels.json`，配置首页信息流要聚合的频道 |
| **日志**     | 查看运行日志                           |
| **Parse**  | 开发工具：从列表页解析条目，返回 JSON            |
| **Enrich** | 开发工具：从详情页提取正文，返回 JSON            |
| **插件**     | 已加载插件列表与登录状态                     |

## 使用

### 生成 RSS（供阅读器订阅）

支持两种方式：

**1. 查询式 RSS**（从数据库按条件筛选，支持多种组合）：

```
GET /rss?search=AI&tags=科技,产品&sourceUrl=https://...&author=xxx&lng=zh-CN&limit=50
```

| 参数 | 说明 |
|------|------|
| `search` / `q` | 全文搜索 |
| `source` / `sourceUrl` | 信源 URL 精确匹配 |
| `author` | 作者模糊匹配 |
| `tags` | 标签，逗号分隔（任一匹配） |
| `lng` | 译文语种（如 zh-CN） |
| `limit` / `offset` | 分页，默认 50 条 |
| `title` | 自定义频道标题 |

**2. 按 URL 抓取式 RSS**（从信源实时抓取）：

```
http://localhost:3751/rss/https://sspai.com/writers
```

### 信息流聚合

在 `.rssany/sources.json` 中定义爬虫要抓取的信源列表（扁平格式）：

```json
{
  "sources": [
    { "ref": "https://sspai.com/feed", "label": "少数派" },
    { "ref": "https://example.com/blog", "label": "某博客", "refresh": "1h" },
    { "ref": "imaps://me%40163.com:authcode@imap.163.com:993/INBOX", "label": "邮件订阅" }
  ]
}
```

在 `.rssany/channels.json` 中定义首页信息流要展示的频道（channel → sourceRefs）：

```json
{
  "tech": {
    "title": "科技资讯",
    "sourceRefs": ["https://sspai.com/feed", "https://example.com/blog"]
  }
}
```

两者解耦：爬虫只读 `sources.json`，首页只读 `channels.json`。

### 邮件收件箱

支持通过 IMAP 将邮件 Newsletter 纳入信息流，格式：

```
imaps://用户名%40域名:授权码@imap服务器:993/INBOX?limit=50
```

### Gateway：接收外部爬虫推送

外部爬虫或分布式抓取服务可通过 `POST /api/gateway/items` 推送 FeedItem，经 Pipeline 后入库：

```bash
curl -X POST http://localhost:3751/api/gateway/items \
  -H "Content-Type: application/json" \
  -d '{
    "sourceRef": "my-external-scraper",
    "items": [
      {
        "title": "文章标题",
        "link": "https://example.com/article/1",
        "pubDate": "2025-03-03T12:00:00Z",
        "summary": "摘要",
        "content": "正文（可选）"
      }
    ]
  }'
```

请求体字段：

- `items`（必填）：FeedItem 数组，每项需含 `link`、`title`，`pubDate` 可为 ISO 字符串
- `sourceRef`（可选）：信源标识，默认 `"gateway"`；需在 `channels.json` 的 `sourceRefs` 中加入此值，条目才会出现在信息流
- `writeDb`（可选）：是否写入数据库，默认 `true`

### 系统标签

系统标签由用户管理，存储在 `.rssany/tags.json`，供 pipeline tagger 使用。`GET /api/tags` 返回标签列表及统计（文章数量、热度）：

```bash
# 获取标签列表及统计（tags、stats）
curl http://localhost:3751/api/tags
# 响应示例：{"tags":["科技","AI"],"stats":[{"name":"科技","count":42,"hotness":12.5},{"name":"AI","count":18,"hotness":8.2}]}
# hotness：综合数量与新鲜度，越新的文章贡献越大

# 更新标签（覆盖）
curl -X PUT http://localhost:3751/api/tags \
  -H "Content-Type: application/json" \
  -d '{"tags": ["科技", "AI", "产品"]}'
```

## 插件开发

插件按职责分为三个阶段，放在对应子目录中：

| 阶段 | 内置目录 | 用户目录 | 职责 |
|---|---|---|---|
| **sources** | `plugins/sources/` | `.rssany/plugins/sources/` | 定义信源，负责列表抓取与解析 |
| **enrich** | `plugins/enrich/` | `.rssany/plugins/enrich/` | 对单条补全正文 |
| **pipeline** | `plugins/pipeline/` | `.rssany/plugins/pipeline/` | 二次加工（翻译、打标签等） |

用户插件会覆盖同 `id` 的内置插件，无需修改项目代码。

### Source 插件示例

在 `.rssany/plugins/sources/` 下创建 `*.rssany.js`：

```javascript
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

### Pipeline（固定流程 + 配置开关）

Pipeline 位于 `app/pipeline/`，步骤开关与排序由 `.rssany/config.json` 的 `pipeline.steps` 配置：

```json
{
  "pipeline": {
    "steps": [
      { "id": "tagger", "enabled": true },
      { "id": "translator", "enabled": false }
    ]
  }
}
```

- **tagger**：从系统标签库自动匹配标签
- **translator**：将标题、摘要、正文翻译为中文（`lng=zh-CN` 时输出译文）

`steps` 数组顺序即执行顺序，`enabled: false` 的步骤跳过。管理页：`/admin/pipeline`，支持拖拽排序与开关。API：`GET/PUT /api/pipeline`。配置 `OPENAI_API_KEY` 后开箱即用。

### 投递

投递为独立配置，需同时开启 `enabled` 并设置 `url` 才生效。启用后**不写本机数据库**，仅将条目 POST 到该 URL（纯转发节点）：

```json
{
  "deliver": {
    "enabled": true,
    "url": "https://other-server/api/gateway/items"
  }
}
```

管理页：`/admin/deliver`。测试端点：`POST /api/deliver/test`（不写数据库，仅发送示例条目）。

详细插件规范见 [AGENTS.MD](./AGENTS.MD)。

## 目录结构

```
├── app/              源代码
│   ├── agent/        Agent 与工具定义
│   ├── config/       路径与全局配置
│   ├── core/         基础设施（缓存、日志、事件、LLM）
│   ├── db/           SQLite 数据库层（FeedItem CRUD、FTS5）
│   ├── feeder/       RSS 生成核心
│   ├── mcp/          MCP 服务（list_channels / search_feeds 等）
│   ├── plugins/      插件加载器
│   ├── router/       HTTP 路由层（Hono）
│   ├── scraper/      抓取与信源（web / api / email / enrich）
│   └── types/        FeedItem 等类型定义
├── plugins/          内置插件
│   ├── sources/      内置 Source 插件
│   ├── enrich/       内置 Enrich 插件
│   └── pipeline/     内置 Pipeline 插件（tagger、translator）
├── webui/            前端管理界面（SvelteKit）
└── .rssany/          用户数据目录（自动创建，gitignore）
    ├── sources.json  爬虫信源配置
    ├── channels.json 首页频道配置
    ├── tags.json     系统标签库（用户管理，供 pipeline tagger 使用）
    ├── plugins/      用户插件（sources / enrich / pipeline）
    ├── cache/        运行时缓存
    └── data/rssany.db
```

## 许可证

MIT

欢迎提交 Issue 与 PR 共同改进项目。
