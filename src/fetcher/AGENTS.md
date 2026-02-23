本目录为页面拉取层（Puppeteer）。负责打开页面、必要的认证态恢复（cookies/localStorage/sessionStorage）、等待页面进入可解析状态，并输出最终 HTML（可选净化与缓存）。支持代理，含带账号密码的 URL 形式（如 `http://user:pass@host:port`），通过 `page.authenticate` 应答 407。

