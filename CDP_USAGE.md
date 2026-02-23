# Chrome DevTools Protocol (CDP) 使用指南

RssAny 现在支持通过 Chrome DevTools Protocol (CDP) 控制 Chrome，避免安装 Puppeteer 自带的 Chrome。

## 使用方式

### 方式 1：连接到已启动的 Chrome（推荐，类似 OpenClaw）

1. **手动启动 Chrome 并开启 CDP 端口**：

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\temp\chrome-debug
```

2. **设置环境变量启用 CDP 模式**：

```bash
export USE_CDP=1
export CDP_PORT=9222  # 可选，默认 9222
```

3. **运行应用**：

```bash
npm run dev
```

### 方式 2：自动启动系统 Chrome（使用指定路径）

1. **设置环境变量**：

```bash
export USE_CDP=1
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# 或 Linux: export CHROME_PATH="/usr/bin/google-chrome"
# 或 Windows: export CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

2. **运行应用**：

应用会自动启动 Chrome 并连接到 CDP。

### 方式 3：在代码中配置

在调用 `fetchHtml` 时传入配置：

```typescript
import { fetchHtml } from "./fetcher/index.js";

// 连接到已启动的 Chrome
const result = await fetchHtml(url, {
  useCDP: true,
  cdpPort: 9222,
});

// 或使用指定路径的 Chrome
const result = await fetchHtml(url, {
  useCDP: true,
  chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
```

## 环境变量说明

- `USE_CDP`: 设置为 `1` 或 `true` 启用 CDP 模式
- `CHROME_PATH`: Chrome 可执行文件路径（可选，不设置则自动查找）
- `CDP_PORT`: CDP 端口号（可选，默认 9222）

## 优势

1. **减少体积**：不需要 Puppeteer 下载专属 Chrome（~300MB）
2. **使用系统 Chrome**：可以使用已安装的 Chrome/Chromium/Edge
3. **灵活控制**：可以手动启动 Chrome 并保持运行，多个应用共享同一个浏览器实例
4. **类似 OpenClaw**：通过 CDP 协议控制，更轻量级

## 注意事项

1. 使用方式 1（连接到已启动的 Chrome）时，需要确保 Chrome 在应用运行期间保持运行
2. `userDataDir` 仍然有效，用于持久化 cookies 等数据
3. 如果 `USE_CDP=1` 但未找到 Chrome 或无法连接，会抛出错误
4. 未设置 `USE_CDP` 时，默认使用 Puppeteer 方式（自动下载 Chrome）

## 故障排查

### 无法连接到 Chrome

- 确保 Chrome 已启动并开启了 `--remote-debugging-port`
- 检查端口号是否正确（默认 9222）
- 检查防火墙是否阻止了本地连接

### 找不到 Chrome 可执行文件

- 设置 `CHROME_PATH` 环境变量指向正确的路径
- 或在代码中传入 `chromeExecutablePath` 参数
