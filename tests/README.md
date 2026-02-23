# tests

单测与 e2e 测试，统一放在根目录 tests 下。

- `pipeline.e2e.test.ts` - e2e 完整流程：fetch → parse → extract（需 Chrome / Puppeteer）
- `sites-xiaohongshu-parser.test.ts` - 小红书站点 parser 单元测试（依赖 cache/fetched 下预拉取的 HTML）
