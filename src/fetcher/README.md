# fetcher

使用无头浏览器（Puppeteer）拉取页面，支持认证与净化。

- **缓存**：由 cacher 负责；写入缓存时保存**原始 HTML**（`page.content()` 的完整结果），不在写入前做 purify，避免净化或解析导致内容丢失；purify 仅在**返回给调用方时**应用（包括读缓存命中时）。
- **认证**：`ensureAuth` + `authFlow`（cookies 存 domains/）；需登录的站点先 `ensureAuth` 再 `fetchHtml`；`preCheckAuth` 用于 feeder 预检，失败则返回 401；各站点 auth 位于插件内（如 `plugins/xiaohongshu.rssany.js`）。
- **净化**：`purify.ts` 基于 node-html-parser，移除 script/style/svg/symbol/nav 等与 RSS 无关的标签与部分属性；配置项 `purify: false` 可关闭。
- **代理**：设置 `HTTP_PROXY` 或 `HTTPS_PROXY` 环境变量，或在 `RequestConfig.proxy` 中传入；Puppeteer 启动时添加 `--proxy-server`。示例：无认证 `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080`；需账号密码时 `http://user:pass@host:port`（代理返回 407 时自动用 `page.authenticate` 应答）。
- **页面复用**：每次 launch 后使用 `browser.pages()[0]` 作为工作页，不再 `newPage()`，避免多出一个 about:blank 标签。