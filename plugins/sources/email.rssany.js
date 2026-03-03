// 内置 IMAP 邮件插件：匹配 imap://、imaps:// 协议 URL

import { ImapFlow } from "imapflow";
import { logger } from "../../app/core/logger/index.js";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";

function parseImapUrl(sourceId) {
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

function makeGuid(messageId, uid, host) {
  const raw = messageId ?? `${uid}@${host}`;
  return createHash("sha256").update(raw).digest("hex");
}

export default {
  id: "__email__",
  pattern: /^imaps?:\/\//,
  priority: 0,
  refreshInterval: "30min",
  async fetchItems(sourceId, _ctx) {
    const { host, port, secure, user, pass, folder, limit } = parseImapUrl(sourceId);
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: false,
    });

    client.on("error", (err) => {
      logger.error("source", "IMAP 连接异常", { err: err?.message, host, folder });
    });

    const items = [];
    let connected = false;
    try {
      await client.connect();
      connected = true;
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
            const authorRaw = fromAddr?.name || fromAddr?.address || undefined;
            const author = authorRaw ? [authorRaw] : undefined;
            const pubDate = parsed.date ?? envelope.date ?? new Date();
            const link = `imap://${host}/${encodeURIComponent(folder)}#${msg.uid}`;
            const htmlBody = typeof parsed.html === "string" ? parsed.html : undefined;
            const textBody = typeof parsed.text === "string" ? parsed.text : undefined;
            const content = htmlBody ?? (textBody ? `<pre>${textBody}</pre>` : undefined);
            const summary = textBody?.slice(0, 300) || undefined;
            items.push({ guid, title, link, pubDate, author, summary, content });
          } catch (err) {
            logger.warn("source", "解析单封邮件失败", { err: err?.message });
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      logger.warn("source", "拉取 IMAP 邮件失败", { err: err?.message, host, folder });
      return [];
    } finally {
      if (connected && client.usable) {
        try {
          await client.logout();
        } catch (err) {
          logger.warn("source", "IMAP 退出连接失败", { err: err?.message, host, folder });
        }
      } else {
        client.close();
      }
    }
    return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  },
};
