// 认证类型：AuthFlow、CheckAuthFn，供 fetcher、feeder 使用

import type { Page } from "puppeteer-core";


/** 检查是否已登录。(page, url) => Promise<boolean>，返回 true 表示已认证，false 表示需登录 */
export type CheckAuthFn = (page: Page, url: string) => Promise<boolean>;


/** 认证流程配置：供 ensureAuth / fetchHtml / preCheckAuth 使用。详见 docs/AUTH_FLOW.md */
export interface AuthFlow {
  /** 检查是否已认证；(page, url) => Promise<boolean> */
  checkAuth: CheckAuthFn;
  /** 登录页 URL， checkAuth 为 false 时打开此页（有头模式）让用户手动登录 */
  loginUrl: string;
  /** 域名，cookies 保存在 domains/{domain}.json；不填则不持久化。未来可扩展为 domains/{domain}/{profileName}.json */
  domain?: string;
  /** 等待登录超时毫秒，默认 300000 */
  loginTimeoutMs?: number;
  /** 轮询 checkAuth 间隔毫秒，默认 2000 */
  pollIntervalMs?: number;
}
