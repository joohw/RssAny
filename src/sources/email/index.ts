// EmailSource 存根：IMAP 邮件信源接口占位，待实现

import type { Source, SourceContext } from "../types.js";
import type { FeedItem } from "../../types/feedItem.js";


/**
 * Email 信源配置。
 * 连接字符串格式: imap://user:pass@host:port/INBOX
 * 或              imaps://user:pass@host:port/INBOX（SSL）
 *
 * 待实现：
 *   - 使用 imapflow 或 node-imap 连接 IMAP 服务器
 *   - 读取未读邮件，映射 From/Subject/Date/Body → FeedItem
 *   - 支持 OAuth2 Token 认证
 *   - 支持过滤条件（发件人白名单、文件夹、已读/未读）
 */
export interface EmailSourceConfig {
  /** IMAP 连接字符串，如 imaps://user:pass@imap.gmail.com:993/INBOX */
  connectionString: string;
  /** 最多拉取邮件条数，默认 50 */
  limit?: number;
  /** 是否只拉取未读邮件，默认 true */
  unreadOnly?: boolean;
}


/** 将 IMAP 连接字符串包装为 Source（暂未实现，调用时抛出 NotImplementedError） */
export function createEmailSource(config: EmailSourceConfig): Source {
  let url: URL;
  try {
    url = new URL(config.connectionString);
  } catch {
    throw new Error(`无效的 Email 连接字符串: ${config.connectionString}`);
  }
  const id = `email:${url.hostname}${url.pathname}`;
  return {
    id,
    pattern: new RegExp(`^imaps?://${url.hostname.replace(/\./g, "\\.")}`),
    async fetchItems(_sourceId: string, _ctx: SourceContext): Promise<FeedItem[]> {
      throw new Error(
        "[EmailSource] 尚未实现。\n" +
        "计划依赖：imapflow（已有 npm 包），OAuth2 支持需额外配置。\n" +
        "欢迎贡献：src/sources/email/index.ts"
      );
    },
  };
}
