# RssAny

> Universal RSS/Atom/JSON Feed pipeline — fetches, parses and converts any web content into consumable feeds with plugin support.

RssAny 是一个通用的 RSS/Atom/JSON Feed 生成器，能够将任意网页内容转换为可订阅的 RSS 源，并将条目持久化到本地 SQLite 数据库，供 OpenWebUI 等工具做知识库或 RAG 使用。

## 特性

- **RSS 生成**：根据列表页 URL 自动抓取、解析并生成 RSS XML
- **智能解析**：支持自定义解析器与 LLM 解析两种模式
- **正文提取**：支持自定义提取器、Readability 与 LLM 提取
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
pnpm install
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

```bash
# 开发模式（热重载）
pnpm dev

# 生产模式
pnpm build && pnpm start
```

服务默认监听 `http://localhost:3751`。

## 使用

### 生成 RSS

访问 `http://localhost:3751/rss/<列表页URL>` 即可获得对应的 RSS XML。

示例：
```
http://localhost:3751/rss/https://sspai.com/writers
```

### 订阅管理

访问 `http://localhost:3751/subscriptions` 管理订阅列表，每个订阅可聚合多个信源。

### WebUI

访问 `http://localhost:3751` 打开管理界面，支持：
- 订阅列表浏览与管理
- 插件列表查看
- 解析器 / 提取器调试工具

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
  refreshInterval: "1h",
  proxy: "http://127.0.0.1:7890",
  parser,
  loginUrl: "https://example.com/login",
  domain: "example.com",
};
```

详细插件规范见 [AGENTS.MD](./AGENTS.MD)。

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
├── statics/          静态 HTML 页面
├── tests/            端到端测试
└── .rssany/          用户数据目录（自动创建，gitignore）
    ├── subscriptions.json
    ├── plugins/
    └── data/rssany.db
```

## 许可证

MIT
