# app

Router 层：Hono 实现，与 feeder 解耦。

- **router.ts**：`createApp(getRssFn?)` 创建 Hono 应用，getRss 可注入便于测试或换实现
- **index.ts**：启动服务，端口 3751

## 路由

- `GET /`：首页，输入框选择 RSS/Parse/Extractor 并输入 URL 访问；下方展示「需登录的站点」列表，可批量点击「打开登录页」触发有头浏览器登录
- `GET /plugins`：插件管理页面（HTML），显示已生效插件列表，可查看插件信息并触发登录
- `GET /api/plugins`：已生效插件列表（JSON），含 `id`、`listUrlPattern`、`hasParser`、`hasExtractor`、`hasAuth`
- `POST /auth/ensure?url=...` 或 `POST /auth/ensure?siteId=...`：触发该站点的有头浏览器登录（后台执行 ensureAuth），立即返回 JSON `{ ok, message }`
- `GET /rss/*`：路径为目标 URL（可省略 https://），如 `/rss/www.xiaohongshu.com/user/profile/xxx`；调用 feeder.getRss，返回 RSS XML；若需登录则返回 401 页面（含「打开有头登录页」按钮）
- `GET /parse/*`：路径为目标 URL，拉取并解析为条目列表，返回 JSON；若需登录则返回 401 页面（含「打开有头登录页」按钮）
- `GET /extractor/*`：按站点插件或 Readability 提取网页正文，路径为目标 URL，返回 JSON：`{ title, author, summary, content, pubDate }`（标准 RSS 字段名）
- 401 页面（statics/401.html）：展示失败订阅地址，按钮「打开有头登录页」调用 `POST /auth/ensure?url=...`，弹出有头浏览器完成登录

## 解耦

Router 仅负责 HTTP，feeder 负责业务。未来可替换为 Express 等，只需实现相同接口：接收 URL → 调用 getRss → 返回 XML。

## 运行

```bash
pnpm serve:app   # 需 tsx：pnpm add -D tsx
# 或 build 后：node dist/index.js
```
