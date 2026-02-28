// 写文件模块：将条目以 Markdown 写入配置的本地目录（不执行 git 操作）

export { loadWriterConfig } from "./config.js";
export type { WriterConfig } from "./types.js";
export { itemToStableId, buildItemMarkdown, writeItem, writeItems } from "./write.js";
