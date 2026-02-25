// EmailSource：IMAP 邮件信源，将收件箱最新邮件转为 FeedItem 列表

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";
import type { Source as RssSource, SourceContext } from "../types.js";
import type { FeedItem } from "../../types/feedItem.js";
import { logger } from "../../logger/index.js";



// 解析 IMAP URL：格式 imaps://user%40host:pass@imap.host:993/INBOX?limit=30
function parseImapUrl(sourceId: string): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  folder: string;
  limit: number;
} {
  const url = new URL(sourceId);
  const host = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : 993;
  const secure = url.protocol === "imaps:" || port === 993;
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  const folder = decodeURIComponent(url.pathname.slice(1)) || "INBOX";
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") ?? "30", 10));
  return { host, port, secure, user, pass, folder, limit };
}



// 根据 messageId 或 uid@host 生成唯一 guid
function makeGuid(messageId: string | null | undefined, uid: number, host: string): string {
  const raw = messageId ?? `${uid}@${host}`;
  return createHash("sha256").update(raw).digest("hex");
}



/** 内置 EmailSource：匹配所有 imap:// 和 imaps:// 协议 URL，刷新间隔 30 分钟 */
export const emailSource: RssSource = {
  id: "__email__",
  pattern: /^imaps?:\/\//,
  refreshInterval: "30min",
  async fetchItems(sourceId: string, _ctx: SourceContext): Promise<FeedItem[]> {
    const { host, port, secure, user, pass, folder, limit } = parseImapUrl(sourceId);
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: false,
    });
    await client.connect();
    const items: FeedItem[] = [];
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        const mailbox = client.mailbox;
        if (mailbox === false) return [];
        const total = mailbox.exists ?? 0;
        if (total === 0) return [];
        const start = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${start}:*`, { source: true, envelope: true })) {
          try {
            if (msg.source === undefined || msg.envelope === undefined) continue;
            const parsed = await simpleParser(msg.source);
            const envelope = msg.envelope;
            const guid = makeGuid(envelope.messageId, msg.uid, host);
            const title = parsed.subject ?? envelope.subject ?? "(无主题)";
            const fromAddr = envelope.from?.[0];
            const author = fromAddr?.name || fromAddr?.address || undefined;
            const pubDate = parsed.date ?? envelope.date ?? new Date();
            const link = `imap://${host}/${encodeURIComponent(folder)}#${msg.uid}`;
            const htmlBody = typeof parsed.html === "string" ? parsed.html : undefined;
            const textBody = typeof parsed.text === "string" ? parsed.text : undefined;
            const contentHtml = htmlBody ?? (textBody ? `<pre>${textBody}</pre>` : undefined);
            const summary = textBody?.slice(0, 300) || undefined;
            items.push({ guid, title, link, pubDate, author, summary, contentHtml });
          } catch (err) {
            logger.warn("source", "解析单封邮件失败", { err: err instanceof Error ? err.message : String(err) });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  },
};
