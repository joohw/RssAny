import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import xiaohongshuPlugin from "../plugins/xiaohongshu.rssany.js";


const CACHE_DIR = "cache";
const htmlFile = "5cdd520f5b1b8d1a28de6522e207d91a21247c11bab616f336fd542d4052f48a.html";


describe("xiaohongshu site parser", () => {
  it("从用户主页 HTML 解析出笔记列表", async () => {
    const htmlPath = join(CACHE_DIR, "fetched", htmlFile);
    const html = await readFile(htmlPath, "utf-8");
    const url = "https://www.xiaohongshu.com/user/profile/5ec9441700000000010051ee";
    const entries = xiaohongshuPlugin.parser(html, url);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].title).toBe("音乐一响 白月光登场");
    expect(entries[0].link).toContain("/explore/6471a8870000000013014d86");
    expect(entries[0].link).toMatch(/\?xsec_token=/);
    expect(entries[0].link).toMatch(/xsec_source=pc_user/);
    expect(entries[0].author).toBe("艾菲");
  });
});
