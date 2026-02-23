#!/usr/bin/env node
// 本地静态服务：将 route 目录映射到根路径，便于访问 /test.xml 等

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const ROUTE_DIR = join(ROOT, "route");
const PORT = Number(process.env.PORT) || 3751;

const MIME = {
  ".xml": "application/rss+xml",
  ".json": "application/json",
  ".html": "text/html",
  ".txt": "text/plain",
};

const server = createServer(async (req, res) => {
  const pathname = (req.url?.split("?")[0] ?? "/").replace(/^\//, "") || "index.html";
  const filePath = join(ROUTE_DIR, pathname);
  if (!filePath.startsWith(ROUTE_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(filePath);
    const type = MIME[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch (e) {
    if (e.code === "ENOENT") {
      res.writeHead(404).end("Not Found");
      return;
    }
    res.writeHead(500).end(String(e.message));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`route 目录已映射到 http://127.0.0.1:${PORT}/`);
  console.log(`例如: http://127.0.0.1:${PORT}/test.xml`);
});
