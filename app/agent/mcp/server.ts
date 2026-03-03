// MCP 服务：基于 Streamable HTTP（SSE），从 definitions 转换注册 tools
// 使用 stateless 模式：每个请求新建 transport+server，避免 Cursor 等多客户端/重试时触发 "Server already initialized"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerMcpTools } from "../tools/definitions.js";

let cachedHandler: ((request: Request) => Promise<Response>) | null = null;

export async function createMcpHandler(): Promise<
  (request: Request) => Promise<Response>
> {
  if (cachedHandler) return cachedHandler;

  const handler = async (request: Request): Promise<Response> => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless：每个请求独立，可重复 initialize
    });
    const server = new McpServer(
      { name: "rssany", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    registerMcpTools(server);
    await server.connect(transport);
    return transport.handleRequest(request);
  };

  cachedHandler = handler;
  return handler;
}
