# baidu-research 插件误标题问题复盘（2026-02-26）

## 背景
- 目标站点：`https://research.baidu.com/`
- 目标能力：将 Baidu Research Blog 列表稳定解析为 RSS 条目并写入 SQLite。

## 问题现象
1. 信息流里出现了“`Jan 1st，`”作为文章标题的条目。
2. 这些条目会被显示为“刚抓到”（例如“22 分钟前”），看起来像新内容重复发布。
3. 典型受影响链接：
   - `https://research.baidu.com/Blog/index-view?id=171`
   - `https://research.baidu.com/Blog/index-view?id=175`
   - `https://research.baidu.com/Blog/index-view?id=176`

## 根因分析
1. 插件解析层误判（首因）  
   日期文本 `Jan 1st，`（有逗号、无年份）未被日期解析规则识别，落入标题候选，最终被写成 `title`。
2. 数据库写入策略放大问题（次因）  
   `upsertItems` 使用 `INSERT OR IGNORE`，同一 `id` 的旧记录存在时，新的正确标题不会覆盖旧错数据。
3. 结果表现  
   旧错记录的 `pub_date` 曾被回退为抓取时间，排序时会被当作“新发布”，造成重复刷屏感。

## 修复动作
1. 插件修复（`plugins/baidu-research.rssany.js`）
   - 增强日期匹配：支持 `Jan 1st，` / `Jan 1st,` 这类“月日+可选年份”格式。
   - 增加 `isDateLikeText` 过滤：日期样式文本即便未成功解析成完整 `Date`，也不允许参与标题候选。
   - 保留年份推断：当日期缺少年份时，尝试从同条目标题/摘要文本中的年份补全。
2. DB 自愈修复（`src/db/index.ts`）
   - 在 `upsertItems` 中保留插入逻辑不变（仍先 `INSERT OR IGNORE`）。
   - 对已存在记录增加“条件修复更新”：
     - 旧标题是日期占位（如 `Jan 1st`）且新标题可信时，更新 `title`。
     - 旧 `pub_date` 看起来是 fallback（接近 `fetched_at`）且新日期更可信时，更新 `pub_date`。
     - `summary/author` 在新值更优时同步修复。

## 验证结果
- 修复后目标条目恢复正确：
  - `id=171` -> `Baidu Presents Top 10 Frontier Technology Inventions of 2022`（`2022-01-01`）
  - `id=175` -> `Baidu Research Releases Top 10 Tech Trends for 2023`（`2023-01-01`）
  - `id=176` -> `Baidu Research Releases Top 10 Tech Trends for 2023`（`2023-01-01`）
- 检查结果：
  - `bad_titles=0`（无 `Jan...` 作为标题）
  - `npx eslint src/db/index.ts plugins/baidu-research.rssany.js` 通过

## 快速排查命令
```bash
sqlite3 .rssany/data/rssany.db "
SELECT url, title, pub_date, fetched_at
FROM items
WHERE source_url='https://research.baidu.com/'
  AND (url LIKE '%id=171' OR url LIKE '%id=175' OR url LIKE '%id=176')
ORDER BY url;"
```

## 防复发清单
1. 日期文本要区分“可解析日期”和“日期样式文本”两个层级，后者也必须排除出标题候选。
2. 对 `INSERT OR IGNORE` 的表，关键字段（title/pub_date）需要有受控的修复更新路径。
3. 插件回归要同时验证：
   - 解析结果质量（标题不是日期占位）
   - 入库后排序表现（`pub_date` 不回退到抓取时间）
4. 对重点站点保留固定 SQL 巡检脚本，优先核验 DB 真值，而不是只看前端展示。
