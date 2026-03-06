// Feeder：根据 URL 生成 RSS / 条目列表，与 router 解耦；支持自生成与转发（/proxy 暂未实现）

export { getItems, feedItemsToRssXml, ingestFromGateway } from "./feeder.js";
export type { FeederConfig } from "./types.js";
export type { GatewayIngestConfig } from "./feeder.js";
