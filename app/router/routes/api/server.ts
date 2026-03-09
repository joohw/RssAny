// /api/server-info

import { networkInterfaces } from "node:os";
import type { Hono } from "hono";

const PORT = Number(process.env.PORT) || 3751;

export function registerServerRoutes(app: Hono): void {
  app.get("/api/server-info", (c) => {
    const lanIp = Object.values(networkInterfaces())
      .flat()
      .find((iface) => iface?.family === "IPv4" && !iface.internal)?.address;
    const lanUrl = lanIp ? `http://${lanIp}:${PORT}` : null;
    return c.json({ port: PORT, lanUrl });
  });
}
