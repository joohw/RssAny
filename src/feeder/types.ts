// Feeder 配置与返回类型

export interface FeederConfig {
  /** 缓存目录，feeds 缓存写入 cacheDir/feeds/ */
  cacheDir?: string;
  /** feeds 缓存最大存活毫秒数，超时则重新抓取，默认 1 小时 */
  feedCacheMaxAgeMs?: number;
  /** 是否抓取详情正文，默认 true；列表会立即返回，详情在后台补全并更新缓存 */
  includeContent?: boolean;
  /** 是否使用无头浏览器，默认 true；设为 false 时使用有头浏览器（可视化） */
  headless?: boolean;
}

export interface FeederResult {
  /** RSS 2.0 XML 字符串 */
  xml: string;
  /** 是否来自缓存 */
  fromCache: boolean;
}
