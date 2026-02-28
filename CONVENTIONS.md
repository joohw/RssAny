# RssAny 开发约定

本文件描述 RssAny 项目的代码规范、架构约定与开发模式，供 AI 编程助手（DeepWiki、Cursor 等）理解开发规范时参考。

---

## 技术栈


| 层次      | 技术                                              |
| ------- | ----------------------------------------------- |
| 运行时     | Node.js >= 20，ESM 模块                            |
| 语言      | TypeScript（严格模式）                                |
| HTTP 框架 | Hono + @hono/node-server                        |
| 数据库     | better-sqlite3（SQLite，同步 API）                   |
| 浏览器自动化  | puppeteer-core                                  |
| HTML 解析 | node-html-parser / jsdom / @mozilla/readability |
| LLM     | OpenAI SDK（兼容任意 OpenAI 格式接口）                    |
| 前端      | SvelteKit（位于 `webui/` 子目录）                      |
| 构建      | Vite                                            |
| 测试      | Vitest                                          |


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
- 插件文件（`*.rssany.{js,ts}`）必须 `export default` 一个实现 `Site` 接口的对象；接口定义见源码

### 命名约定


| 类型      | 风格                        | 示例                                      |
| ------- | ------------------------- | --------------------------------------- |
| 变量 / 函数 | camelCase                 | `fetchItems`, `cacheKey`                |
| 类 / 接口  | PascalCase                | `FeedItem`, `Source`                    |
| 常量      | camelCase（不用 UPPER_SNAKE） | `defaultRefreshInterval`                |
| 文件名     | kebab-case 或 camelCase    | `pluginLoader.ts`, `refreshInterval.ts` |
| 插件文件    | `{id}.rssany.{js,ts}`     | `xiaohongshu.rssany.ts`                 |


---

## 架构约定

### 模块边界

- 各模块通过 `index.ts` 对外暴露接口，模块之间只依赖其公开 API，不直接引用内部文件
- HTTP 层只调用业务模块的公开 API，不内联业务逻辑

### 数据流方向

```
HTTP 请求 → feeder（协调）
  → getSource() → source.fetchItems()（抓取+解析列表）
  → db.upsertItems()（写库）
  → buildRssXml()（构建 XML）
  → [后台] source.enrichItem()（提取正文）
  → db.updateItemContent()（更新正文）
```

### 错误处理

- 业务错误（如认证失败）使用自定义 Error 子类，在对应模块内定义
- HTTP 层统一捕获并转换为适当状态码
- 后台任务（enrichItem）的错误只记录日志，不影响主流程

### 缓存策略

- 缓存 key 由 `cacheKey(url, refreshInterval)` 生成，包含时间窗口（如 `1h_2024010112`）
- 时间窗口过期即视为缓存失效，无需主动清理
- feed 级缓存：仅存 items JSON（读+写），命中后由 JSON 实时生成 RSS XML；fetch/parse/extract 级：仅写（供调试分析）

---

## 测试约定

- 测试文件放在 `tests/` 目录，文件名格式：`{模块}-{功能}.{unit,e2e}.test.ts`
- 端到端测试（e2e）可以真实调用网络，需要在 CI 中跳过或 mock
- 单元测试 mock 外部依赖（Puppeteer、LLM、网络请求）

---

## 环境变量


| 变量                | 说明          | 默认值                         |
| ----------------- | ----------- | --------------------------- |
| `PORT`            | HTTP 监听端口   | `3751`                      |
| `NODE_ENV`        | 运行环境        | `production`                |
| `OPENAI_API_KEY`  | LLM API Key | —                           |
| `OPENAI_BASE_URL` | LLM API 地址  | `https://api.openai.com/v1` |
| `OPENAI_MODEL`    | LLM 模型名     | `gpt-4o-mini`               |
| `HTTP_PROXY`      | 全局代理（兜底）    | —                           |


---

## 常见模式

- **新增信源类型**：在信源模块下实现 `Source` 接口并在 `getSource()` 中注册优先级；类型定义见源码。
- **新增插件**：在插件目录创建 `{id}.rssany.{js,ts}`，实现 `Site` 接口并 `export default`；服务启动或开发模式文件变化时自动加载。
- **新增 API 路由**：在路由层添加路由，业务逻辑委托给对应模块，路由层只做参数解析与错误转换。
- **数据库迁移**：在数据库模块中用 `db.exec()` 执行 DDL；使用 `CREATE TABLE IF NOT EXISTS` 保证幂等，FTS 虚拟表用 `CREATE VIRTUAL TABLE IF NOT EXISTS ... USING fts5(...)`。

