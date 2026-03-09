// API 路由汇总：server、rss、items、feed、sources、channels、enrich、scheduler、plugins、logs、events、admin、topics

import type { Hono } from "hono";
import { registerServerRoutes } from "./server.js";
import { registerRssApiRoutes } from "./rss.js";
import { registerEnrichRoutes } from "./enrich.js";
import { registerSchedulerRoutes } from "./scheduler.js";
import { registerPluginsRoutes } from "./plugins.js";
import { registerPipelineRoutes } from "./pipeline.js";
import { registerDeliverRoutes } from "./deliver.js";
import { registerFeedRoutes } from "./feed.js";
import { registerItemsRoutes } from "./items.js";
import { registerLogsRoutes } from "./logs.js";
import { registerAdminApiRoutes } from "./admin.js";
import { registerSourcesRoutes } from "./sources.js";
import { registerTopicsRoutes } from "./topics.js";
import { registerChannelsRoutes } from "./channels.js";
import { registerTasksRoutes } from "./tasks.js";

export function registerApiRoutes(app: Hono): void {
  registerServerRoutes(app);
  registerRssApiRoutes(app);
  registerEnrichRoutes(app);
  registerSchedulerRoutes(app);
  registerPluginsRoutes(app);
  registerPipelineRoutes(app);
  registerDeliverRoutes(app);
  registerFeedRoutes(app);
  registerItemsRoutes(app);
  registerLogsRoutes(app);
  registerAdminApiRoutes(app);
  registerSourcesRoutes(app);
  registerTopicsRoutes(app);
  registerChannelsRoutes(app);
  registerTasksRoutes(app);
}
