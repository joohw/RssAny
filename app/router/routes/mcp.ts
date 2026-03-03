// MCP 路由：Streamable HTTP、安装脚本

import type { Hono } from "hono";
import { createMcpHandler } from "../../agent/mcp/server.js";

export function registerMcpRoutes(app: Hono): void {
  // MCP：Streamable HTTP（SSE），GET 建 SSE / POST 发 JSON-RPC
  app.all("/mcp", async (c) => {
    const handler = await createMcpHandler();
    return handler(c.req.raw);
  });

  // MCP 一键安装脚本：合并 rssany 到 ~/.cursor/mcp.json
  app.get("/api/mcp/install.sh", (c) => {
    const script = `#!/bin/sh
# RssAny MCP: add streamableHttp server to Cursor (~/.cursor/mcp.json)
set -e
BASE_URL="${"${1:-http://127.0.0.1:3751}"}"
MCP_URL="$BASE_URL/mcp"
CURSOR_DIR="$HOME/.cursor"
MCP_JSON="$CURSOR_DIR/mcp.json"

mkdir -p "$CURSOR_DIR"
if [ -f "$MCP_JSON" ]; then
  CONFIG=$(cat "$MCP_JSON")
else
  CONFIG="{}"
fi

# 使用 node 合并 JSON，避免依赖 jq
NEW_CONFIG=$(node -e "
var config = {};
try { config = JSON.parse(process.argv[1]); } catch (_) {}
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers.rssany = { type: 'streamableHttp', url: process.argv[2] };
console.log(JSON.stringify(config, null, 2));
" "$CONFIG" "$MCP_URL" 2>/dev/null) || {
  echo "Error: need Node.js to merge mcp.json"
  exit 1
}
echo "$NEW_CONFIG" > "$MCP_JSON"
echo "RssAny MCP added: $MCP_URL"
echo "Restart Cursor to take effect."
`;
    return c.text(script, 200, {
      "Content-Type": "application/x-sh; charset=utf-8",
      "Content-Disposition": "inline; filename=install-mcp.sh",
    });
  });
}
