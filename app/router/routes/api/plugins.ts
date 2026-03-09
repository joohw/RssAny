// /api/plugins

import type { Hono } from "hono";
import { getPluginSites } from "../../../scraper/sources/web/index.js";

export function registerPluginsRoutes(app: Hono): void {
  app.get("/api/plugins", (c) => {
    const plugins = getPluginSites().map((s) => ({
      id: s.id,
      listUrlPattern: typeof s.listUrlPattern === "string" ? s.listUrlPattern : String(s.listUrlPattern),
      hasEnrich: !!s.enrichItem,
      hasAuth: !!(s.checkAuth && s.loginUrl),
    }));
    return c.json(plugins);
  });
}
