// Feeder 配置与返回类型

import type { FeedItem } from "../types/feedItem.js";
import type { RefreshInterval } from "../utils/refreshInterval.js";


export interface FeederConfig {
  /** 缓存目录，feeds 缓存写入 cacheDir/feeds/ */
  cacheDir?: string;
  /** 是否抓取详情正文，默认 true；列表会立即返回，详情在后台补全并更新缓存 */
  includeContent?: boolean;
  /** 是否使用无头浏览器，默认 true；设为 false 时使用有头浏览器（可视化） */
  headless?: boolean;
  /** 调用方传入的有效时间窗口覆盖：优先级最高，覆盖 source 声明 */
  refreshInterval?: RefreshInterval;
  /** 调用方传入的代理覆盖：优先级最高，覆盖 source 声明 */
  proxy?: string;
  /** 为 true 时跳过数据库写入（upsertItems / updateItemContent），用于调试/预览流程 */
  skipDb?: boolean;
}


export interface FeederResult {
  /** RSS 2.0 XML 字符串 */
  xml: string;
  /** 是否来自缓存 */
  fromCache: boolean;
  /** 当前已抓取到的条目列表（含后台补全状态） */
  items: FeedItem[];
  /** 后台提取任务 ID；fromCache=true 或信源无 enrichItem 时为 undefined */
  enrichTaskId?: string;
}
