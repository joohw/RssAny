// 将频道 + 条目构建为 RSS 2.0 XML

import type { RssChannel, RssEntry } from "./types.js";


function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


function isoToRfc822(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toUTCString();
}


function buildItem(entry: RssEntry): string {
  const title = escapeXml(entry.title);
  const link = escapeXml(entry.link);
  const desc = entry.description.includes("<") || entry.description.includes(">")
    ? `<![CDATA[${entry.description.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`
    : escapeXml(entry.description);
  const pubDate = entry.published ? escapeXml(isoToRfc822(entry.published)) : "";
  const guid = entry.guid ?? entry.link;
  const guidEscaped = escapeXml(guid);
  let buf = `    <item>\n      <title>${title}</title>\n      <link>${link}</link>\n      <description>${desc}</description>\n`;
  if (pubDate) buf += `      <pubDate>${pubDate}</pubDate>\n`;
  buf += `      <guid isPermaLink="true">${guidEscaped}</guid>\n`;
  buf += `    </item>\n`;
  return buf;
}


export function buildRssXml(channel: RssChannel, entries: RssEntry[]): string {
  const title = escapeXml(channel.title);
  const link = escapeXml(channel.link);
  const desc = escapeXml(channel.description ?? "");
  const lang = escapeXml(channel.language ?? "zh-CN");
  const now = new Date().toUTCString();
  const items = entries.map(buildItem).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>${link}</link>
    <description>${desc}</description>
    <language>${lang}</language>
    <lastBuildDate>${now}</lastBuildDate>

${items}  </channel>
</rss>`;
}
