import { describe, it, expect } from "vitest";
import { fetchHtml, ensureAuth } from "../src/fetcher/index.js";
import { parseHtml } from "../src/parser/index.js";
import { extractItem } from "../src/extractor/index.js";
import { toAuthFlow } from "../src/sites/index.js";
import xiaohongshuPlugin from "../plugins/xiaohongshu.rssany.js";


const CACHE_DIR = "cache";
const xiaohongshuAuthFlow = toAuthFlow(xiaohongshuPlugin);
const TIMEOUT_MS = 30000;
const TEST_TIMEOUT = 60000;


describe("e2e - fetch → parse → extract", () => {
  it("小红书预处理登录：手动登录并保存（需要手动操作，本地测试）", async () => {
    if (!xiaohongshuAuthFlow) throw new Error("xiaohongshu plugin must have auth flow");
    await ensureAuth(xiaohongshuAuthFlow, CACHE_DIR);
  }, TEST_TIMEOUT);
  it("完整流程：fetch 列表页 → parse 解析条目 → extract 第一条详情", async () => {
    const listUrl = "https://www.xiaohongshu.com/user/profile/5ec9441700000000010051ee?xsec_token=ABj8_gKcF7ubIA6wqHYF4j3QKTVWEO0thkFy_663bCeJU=&xsec_source=pc_feed";
    const listRes = await fetchHtml(listUrl, {
      timeoutMs: TIMEOUT_MS,
      cacheDir: CACHE_DIR,
      useCache: false,
      authFlow: xiaohongshuAuthFlow,
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(1000);
    const parsed = await parseHtml(listRes.body, {
      url: listRes.finalUrl ?? listUrl,
      customParser: xiaohongshuPlugin.parser,
      cacheDir: CACHE_DIR,
      includeContent: false,
    });
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0].link).toBeDefined();
    const firstItem = parsed.items[0];
    const extracted = await extractItem(firstItem, {
      cacheDir: CACHE_DIR,
      customExtractor: xiaohongshuPlugin.extractor,
      useCache: false,
    }, { cacheDir: CACHE_DIR, authFlow: xiaohongshuAuthFlow });
    expect(extracted.title).toBeDefined();
    expect(extracted.title!.length).toBeGreaterThan(0);
    expect(extracted.contentHtml).toBeDefined();
  }, TEST_TIMEOUT);
});
