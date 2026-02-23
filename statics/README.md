# statics

静态 HTML 页面：home（首页）、401、404。

- **home.html**：首页，含 Try This 示例链接；下方「需登录的站点」从 `/plugins` 拉取，每个站点可点击「打开登录页」调用 `POST /auth/ensure?siteId=...` 批量做登录。
- **401.html**：需登录时返回；占位符 `{{listUrl}}` 由 router 注入为失败请求的订阅地址；页内「打开有头登录页」按钮调用 `POST /auth/ensure?url=...` 弹出有头浏览器完成登录。
- **404.html**：无匹配站点时返回。
