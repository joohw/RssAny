// Signal 仓库投递模块：将条目以 Markdown 写入本地仓库目录（不执行 git commit）

export { loadSignalConfig } from "./config.js";
export type { SignalConfig } from "./types.js";
export { itemToStableId, buildSignalMarkdown, writeItem, writeItems } from "./write.js";
