# RssAny

> 将任意内容源统一为可订阅的信息流 —— 网页、RSS Feed、邮件收件箱，一站聚合。

RssAny 是一个通用的内容聚合与信息流平台。它不仅能将任意网页转换为标准 RSS 源供阅读器订阅，还能将多个异构信源（网页、RSS、IMAP 邮件）聚合为统一的信息流，持久化到本地 SQLite 数据库，供 RSS 阅读器、OpenWebUI 知识库或 RAG 管道消费。

## 特性

- **RSS 生成**：根据列表页 URL 自动抓取、解析并生成 RSS XML，可直接投喂给任意 RSS 阅读器
- **信息流聚合**：将多个信源（网页 + RSS Feed + 邮件）聚合为单一时间线，支持分页与过滤
- **邮件收件箱**：通过 IMAP 协议抓取邮件，将 Newsletter 纳入统一信息流
- **智能解析**：支持自定义解析器与 LLM 解析两种模式
- **正文提取**：支持自定义提取器、Readability 与 LLM 提取
- **实时通知**：新内容到达时通过 SSE 实时推送前端，无需手动刷新
- **认证管理**：支持需要登录的站点，通过 Puppeteer 管理 cookies
- **插件系统**：内置插件（`plugins/`）+ 用户插件（`.rssany/plugins/`）双目录加载
- **缓存机制**：多级缓存策略，提升性能与稳定性
- **持久化存储**：SQLite 数据库增量存储所有条目，支持 FTS5 全文检索
- **订阅聚合**：将多个信源聚合为单一信息流，支持分页与过滤.

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
cp subscriptions.example.json .rssany/subscriptions.json
```

配置 LLM（用于智能解析与正文提取，可选）：

```bash
export OPENAI_API_KEY=your_key
export OPENAI_BASE_URL=https://api.openai.com/v1  # 可替换为兼容接口
export OPENAI_MODEL=gpt-4o-mini
```

### 启动

**开发模式**（推荐，前端 HMR + 后端热重载）：

```bash
# 终端 1：后端
pnpm dev

# 终端 2：前端 dev server（访问 http://localhost:5173）
cd webui && pnpm dev
```

**生产模式**（前端静态文件由后端直接服务）：

```bash
# 构建前端
cd webui && pnpm build && cd ..

# 启动后端（访问 http://localhost:3751）
pnpm start
```

服务默认监听 `http://localhost:3751`。启动时会输出 Admin Token，用于访问管理功能：

```
RssAny 本机: http://127.0.0.1:3751/
[Admin] Token: a3f8c2...  →  http://127.0.0.1:3751/admin
```

## WebUI

访问 `http://localhost:3751`（生产）或 `http://localhost:5173`（开发）打开管理界面。

| 页面 | 说明 |
|------|------|
| **信息流** | 多源聚合时间线，实时推送新内容 |
| **Web2RSS** | 输入任意网页 URL，生成 RSS 订阅源 |
| **订阅管理** | 编辑 `subscriptions.json`，管理聚合订阅 |
| **Admin** | 需要 Token 验证，包含开发工具与插件管理 |

### Admin 页面

Admin 需要服务器启动时输出的 Token 才能进入（Token 保存在 `.rssany/admin-token.txt`，重启不变）。包含以下功能：

- **RSS** — 测试 Web2RSS 转换（支持 Headful 模式）
- **Parse** — 解析列表页，返回条目 JSON（支持 Headful）
- **Extract** — 提取详情页正文，返回 JSON（支持 Headful）
- **插件** — 查看已加载插件，检查登录状态，打开有头浏览器完成授权

**Headful 模式**：勾选后使用有头浏览器（可见窗口）加载页面，便于调试与手动登录。登录完成后 cookies 自动保存，后续请求无需重复登录。

## 使用

### 生成 RSS（供阅读器订阅）

访问 `http://localhost:3751/rss/<列表页URL>` 即可获得对应的 RSS XML，可直接粘贴到 Reeder、NetNewsWire、FreshRSS 等任意 RSS 阅读器中订阅。

示例：
```
http://localhost:3751/rss/https://sspai.com/writers
```

### 信息流聚合

在 `.rssany/subscriptions.json` 中定义订阅，将多个信源合并为一条时间线：

```json
{
  "my-feed": {
    "title": "我的信息流",
    "pullInterval": "10min",
    "sources": [
      { "ref": "https://sspai.com/feed", "label": "少数派" },
      { "ref": "https://example.com/blog", "label": "某博客" },
      { "ref": "imaps://me%40163.com:authcode@imap.163.com:993/INBOX", "label": "邮件订阅" }
    ]
  }
}
```

### 邮件收件箱

支持通过 IMAP 将邮件 Newsletter 纳入信息流，格式：

```
imaps://用户名%40域名:授权码@imap服务器:993/INBOX?limit=50
```

## 插件开发

在 `.rssany/plugins/` 目录下创建 `*.rssany.js` 文件即可定义自定义站点插件：

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

用户插件（`.rssany/plugins/`）会覆盖同 `id` 的内置插件（`plugins/`），无需修改项目代码。详细插件规范见 [AGENTS.MD](./AGENTS.MD)。

## 目录结构

```
├── src/              源代码
│   ├── app/          HTTP 路由层（Hono）
│   ├── feeder/       RSS 生成核心
│   ├── sources/      信源抽象层（web / rss / email）
│   ├── db/           SQLite 数据库层
│   ├── cacher/       缓存管理
│   ├── auth/         认证抽象
│   ├── llm/          LLM 调用封装
│   ├── scheduler/    定时刷新调度
│   └── subscription/ 订阅配置加载
├── plugins/          内置站点插件
├── webui/            前端管理界面（SvelteKit）
├── tests/            端到端测试
└── .rssany/          用户数据目录（自动创建，gitignore）
    ├── subscriptions.json
    ├── admin-token.txt
    ├── plugins/
    └── data/rssany.db
```

## 许可证

MIT

欢迎提交 Issue 与 PR 共同改进项目。
