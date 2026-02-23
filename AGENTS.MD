# RssAny 项目架构说明

RssAny 是一个通用的 RSS/Atom/JSON Feed 生成器，能够将任意网页内容转换为可订阅的 RSS 源。项目采用模块化架构，支持插件扩展、认证管理、智能解析与提取。

## 核心功能

- **RSS 生成**：根据列表页 URL 自动抓取、解析并生成 RSS XML
- **智能解析**：支持自定义解析器与 LLM 解析两种模式
- **正文提取**：支持自定义提取器、Readability 与 LLM 提取
- **认证管理**：支持需要登录的站点，通过 Puppeteer 管理 cookies
- **插件系统**：通过 `plugins/*.rssany.js` 扩展新站点支持
- **缓存机制**：多级缓存策略，提升性能与稳定性

## 架构模块

### app（HTTP 路由层）
- **职责**：Hono 框架实现的 HTTP 服务，负责路由分发、参数解析、错误处理
- **路由**：`/rss/*`（生成 RSS）、`/parse/*`（解析列表）、`/extractor/*`（提取正文）、`/auth/*`（认证管理）
- **解耦**：与业务逻辑（feeder）解耦，可替换为 Express 等框架

### feeder（RSS 生成核心）
- **职责**：根据 URL 生成 RSS，协调 fetch → parse → extract 流程
- **流程**：检查缓存 → 匹配站点 → 抓取列表 → 解析条目 → 构建 RSS → 后台补全详情
- **缓存**：feed 级缓存（读+写），fetch/parse/extract 级仅写（供分析）

### fetcher（页面拉取层）
- **职责**：使用 Puppeteer 无头浏览器拉取页面 HTML
- **特性**：支持认证态恢复（cookies/localStorage）、代理配置、HTML 净化
- **认证**：通过 `ensureAuth` 管理登录流程，cookies 持久化到 `domains/{domain}.json`

### parser（列表解析层）
- **职责**：从 HTML 列表页解析出条目列表（title、link、summary 等）
- **模式**：自定义解析器（插件提供）或 LLM 解析（默认）
- **缓存**：解析结果写入 `cache/parsed/`，支持按 URL 或自定义 cacheKey 对齐

### extractor（正文提取层）
- **职责**：从详情页 HTML 提取完整正文内容
- **模式**：自定义提取器（优先）、Readability、LLM 提取
- **输出**：标准 RSS 字段（title、author、summary、content、pubDate）

### sites（站点管理）
- **职责**：聚合内置站点与外部插件，提供站点匹配与能力查询
- **匹配**：按 `listUrlPattern` 计算具体度，返回最匹配的站点
- **插件**：自动加载 `plugins/*.rssany.js`，支持声明 URL 模式、parser、extractor、auth

### auth（认证抽象）
- **职责**：定义 AuthFlow 类型与认证错误，与 fetcher 配合使用
- **流程**：feeder 预检 → 检查 cookies → 失败抛出 AuthRequiredError → router 返回 401

### cacher（缓存管理）
- **职责**：统一管理缓存写入/读取，包括 HTML 缓存与认证档案持久化
- **结构**：`cache/fetched/`、`cache/parsed/`、`cache/extracted/`、`cache/feeds/`、`cache/domains/`

### llm（LLM 统一调用）
- **职责**：封装 OpenAI API 调用，供 parser/extractor 的 LLM 模式使用
- **配置**：从环境变量读取 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL

## 数据流程

1. **RSS 生成流程**：
   ```
   URL → getSite() → preCheckAuth() → fetchHtml() → parseHtml() → buildRssXml()
   → [后台] extractItem() → 更新缓存
   ```

2. **认证流程**：
   ```
   检查 domains/{domain}.json → 无效则 ensureAuth() → 打开有头浏览器 → 
   用户登录 → 保存 cookies → 后续请求自动携带
   ```

3. **插件加载流程**：
   ```
   启动时扫描 plugins/*.rssany.js → 加载 Site 对象 → 合并到 registeredSites → 
   开发模式监听文件变化自动重载
   ```

## 关键特性

- **模块解耦**：各模块职责清晰，通过接口交互，便于测试与替换
- **插件化**：站点规则通过插件扩展，无需修改核心代码
- **智能降级**：自定义解析器 → LLM 解析 → 通用兜底
- **缓存策略**：feed 级缓存复用完整结果，fetch/parse/extract 级仅记录供分析
- **代理支持**：支持 HTTP/SOCKS5 代理，可配置站点级或全局代理
- **认证管理**：自动检测登录状态，支持有头浏览器手动登录

## 目录结构

- `src/app/`：HTTP 路由层
- `src/feeder/`：RSS 生成核心
- `src/fetcher/`：页面拉取
- `src/parser/`：列表解析
- `src/extractor/`：正文提取
- `src/sites/`：站点管理
- `src/auth/`：认证抽象
- `src/cacher/`：缓存管理
- `src/llm/`：LLM 调用
- `src/feed/`：RSS XML 构建
- `plugins/`：外部站点插件
- `statics/`：静态页面（首页、401、404）
- `cache/`：运行时缓存目录

## 插件规则

### 文件规范

- **文件命名**：必须以 `.rssany.js` 结尾，如 `xiaohongshu.rssany.js`
- **文件位置**：必须放在项目根目录的 `plugins/` 目录下
- **模块格式**：必须使用 ESM 模块，通过 `export default` 导出 Site 对象

### Site 接口

插件必须实现 `Site` 接口（定义在 `src/sites/types.ts`），包含以下字段：

#### 必填字段

- **`id`** (string)：站点唯一标识符，如 `"xiaohongshu"`、`"lingowhale"`
- **`listUrlPattern`** (string | RegExp)：列表页 URL 匹配模式
  - 字符串模式：使用 `{placeholder}` 匹配路径段，如 `"https://example.com/user/{userId}"`
  - 支持 query 参数（自动忽略），如 `"https://example.com/channels?channel_id=123"`
  - RegExp 模式：直接使用正则表达式，如 `/^https:\/\/example\.com\/.*$/`
  - 匹配具体度：字符串模式按路径段数计算（段数越多越具体），RegExp 默认为 1

#### 可选字段

- **`detailUrlPattern`** (string | RegExp | null)：详情页 URL 模式，用于 `/extractor` 路由匹配
  - 不填则按 `domain` 字段进行域名匹配兜底
  - 语法同 `listUrlPattern`

- **`parser`** (CustomParserFn | null)：自定义列表页解析函数
  - 函数签名：`(html: string, url: string) => Promise<ParsedEntry[]> | ParsedEntry[]`
  - 返回 `ParsedEntry[]` 数组，每个条目包含：`title`、`link`、`description`、`content`、`author`、`published`、`guid`
  - 不提供则使用 LLM 解析（需要配置 OPENAI_API_KEY）

- **`extractor`** (CustomExtractorFn | null)：自定义正文提取函数
  - 函数签名：`(html: string, url: string) => Promise<ExtractedResult> | ExtractedResult`
  - 返回 `ExtractedResult` 对象，包含：`author`、`title`、`summary`、`content`、`pubDate`
  - 不提供则使用 Readability 或 LLM 提取

- **`checkAuth`** (CheckAuthFn | null)：检查是否已登录的函数
  - 函数签名：`(page: Page, url: string) => Promise<boolean>`
  - 返回 `true` 表示已认证，`false` 表示需要登录
  - 使用 Puppeteer 的 `Page` 对象检查页面元素或状态

- **`loginUrl`** (string | null)：登录页 URL，`checkAuth` 返回 `false` 时打开此页面

- **`domain`** (string | null)：域名，用于保存 cookies 到 `cache/domains/{domain}.json`
  - 如 `"xiaohongshu.com"`、`"lingowhale.com"`

- **`loginTimeoutMs`** (number | null)：等待登录超时时间（毫秒），默认 300000（5分钟）

- **`pollIntervalMs`** (number | null)：轮询 `checkAuth` 的间隔时间（毫秒），默认 2000（2秒）


### URL 模式规则

#### 字符串模式语法

- **占位符**：`{placeholder}` 匹配任意非 `/` 字符，如 `{userId}`、`{noteId}`
- **路径匹配**：只匹配路径部分，query 参数自动忽略
- **转义**：特殊字符（如 `.`、`*`、`+`）会自动转义
- **示例**：
  - `"https://www.xiaohongshu.com/user/profile/{userId}"` 匹配 `/user/profile/123456`
  - `"https://lingowhale.com/channels?channel_id={id}"` 匹配 `/channels?channel_id=abc`

#### 匹配优先级

系统按 `listUrlPattern` 的**具体度**选择站点：
- 字符串模式：路径段数越多，具体度越高
- RegExp 模式：具体度为 1（兜底）
- 多个站点匹配时，选择具体度最高的

### Parser 函数规则

- **输入**：`html`（字符串）、`url`（当前页面 URL）
- **输出**：`ParsedEntry[]` 数组
- **字段要求**：
  - `title`：条目标题（必需）
  - `link`：条目链接（必需，绝对 URL）
  - `description`：摘要（可选）
  - `content`：正文 HTML（可选）
  - `author`：作者（可选）
  - `published`：发布日期 ISO 字符串（可选）
  - `guid`：唯一标识（可选，不填则用 `link`）
- **建议**：优先选择稳定的 DOM 结构特征，避免依赖易变的 class 名称

### Extractor 函数规则

- **输入**：`html`（字符串）、`url`（当前页面 URL）
- **输出**：`ExtractedResult` 对象
- **字段要求**：
  - `author`：作者（可选）
  - `title`：标题（可选）
  - `summary`：摘要（可选）
  - `content`：正文内容，可为 HTML 或 Markdown（可选）
  - `pubDate`：发布时间，ISO 字符串或 Date 对象（可选）
- **建议**：提取完整正文内容，包括图片链接，便于 RSS 阅读器展示

### 认证规则

- **完整认证**：需要同时提供 `checkAuth`、`loginUrl`、`domain`
- **`checkAuth` 实现**：使用 Puppeteer `Page` 对象检查登录状态
  - 检查登录按钮是否存在：`await page.$(".login-btn") == null` 表示已登录
  - 检查用户信息元素：`await page.$(".user-info") != null` 表示已登录
- **登录流程**：
  1. `preCheckAuth` 检查 `cache/domains/{domain}.json` 是否存在且有效
  2. 无效则调用 `ensureAuth`，打开有头浏览器到 `loginUrl`
  3. 用户手动登录后，系统轮询 `checkAuth` 直到返回 `true`
  4. 保存 cookies 到 `cache/domains/{domain}.json`
  5. 后续请求自动携带 cookies

### 代理配置规则

- **全局代理配置**：通过项目根目录的 `proxy.json` 文件配置
  - 格式：JSON 对象，key 为站点 ID 或 URL 正则表达式，value 为代理地址
  - 示例：
    ```json
    {
      "xiaohongshu": "http://127.0.0.1:7890",
      "x": "socks5://127.0.0.1:1080",
      "^https://example\\.com": "http://127.0.0.1:7890"
    }
    ```
  - 匹配优先级：站点 ID 匹配 > URL 正则表达式匹配
  - 代理类型：支持 HTTP、HTTPS、SOCKS5
  - 认证代理：使用 `http://user:pass@host:port` 格式，密码需 URL 编码
- **环境变量兜底**：如果 `proxy.json` 中未匹配到，则使用环境变量 `HTTP_PROXY` 或 `HTTPS_PROXY`
- **插件中不再配置代理**：所有代理配置统一在 `proxy.json` 中管理

### 插件加载规则

- **自动加载**：启动时自动扫描 `plugins/*.rssany.js` 文件
- **验证**：检查是否实现 Site 接口（`id`、`listUrlPattern` 必填）
- **错误处理**：加载失败的插件会输出警告，不影响其他插件
- **开发模式**：监听插件文件变化，自动重新加载（防抖 300ms）

### 示例

```javascript
// plugins/example.rssany.js
import { parse } from "node-html-parser";

function parser(html, url) {
  const root = parse(html);
  const items = root.querySelectorAll(".item");
  return items.map(item => ({
    title: item.querySelector(".title")?.textContent || "",
    link: new URL(item.querySelector("a")?.getAttribute("href"), url).href,
    description: item.querySelector(".summary")?.textContent || "",
    author: "Example Author"
  }));
}

function extractor(html, url) {
  const root = parse(html);
  return {
    title: root.querySelector("h1")?.textContent || "",
    content: root.querySelector(".content")?.innerHTML || "",
    author: root.querySelector(".author")?.textContent || ""
  };
}

async function checkAuth(page, url) {
  const userInfo = await page.$(".user-info");
  return userInfo != null;
}

export default {
  id: "example",
  listUrlPattern: "https://example.com/user/{userId}",
  detailUrlPattern: "https://example.com/post/{postId}",
  parser,
  extractor,
  checkAuth,
  loginUrl: "https://example.com/login",
  domain: "example.com",
  loginTimeoutMs: 300000,
  pollIntervalMs: 2000
  // 注意：代理配置不在插件中，统一在 proxy.json 中配置
};
```

### 代理配置示例

在项目根目录创建 `proxy.json`：

```json
{
  "example": "http://127.0.0.1:7890",
  "^https://example\\.com": "socks5://127.0.0.1:1080"
}
```

配置说明：
- key 可以是站点 ID（如 `"example"`）或 URL 正则表达式（如 `"^https://example\\.com"`）
- value 为代理地址，支持 HTTP、HTTPS、SOCKS5，带认证时使用 `http://user:pass@host:port` 格式
- 匹配优先级：站点 ID 匹配 > URL 正则表达式匹配 > 环境变量 `HTTP_PROXY`/`HTTPS_PROXY`
```

## 扩展指南

- **新增站点**：在 `plugins/` 目录创建 `xxx.rssany.js`，实现 Site 接口
- **自定义解析**：在插件中提供 `parser` 函数
- **自定义提取**：在插件中提供 `extractor` 函数
- **添加认证**：在插件中提供 `checkAuth`、`loginUrl`、`domain` 字段
