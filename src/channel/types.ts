// 频道配置类型：首页信息流「把哪些 source 聚合成一条流」

/** 单个频道的配置（不含 id，id 为 key） */
export interface ChannelConfig {
  /** 频道标题 */
  title?: string;
  /** 频道描述 */
  description?: string;
  /** 要聚合的信源 ref 列表（与 items.source_url 一致） */
  sourceRefs: string[];
}

/** channels.json 的顶层结构：key 为 channel id */
export type ChannelsMap = Record<string, ChannelConfig>;

/** 带 id 的频道配置（API 返回用） */
export type ChannelConfigWithId = { id: string } & ChannelConfig;
