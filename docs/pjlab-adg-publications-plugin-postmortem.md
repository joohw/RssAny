# pjlab-adg-publications 插件首版失败复盘（2026-02-26）

## 背景
- 目标链接：`https://pjlab-adg.github.io/publications/`
- 首版上线后报错：`[pjlab-adg-publications] 未解析到论文条目，页面结构可能已变化`

## 为什么第一次没有做好
1. 错误前提：把“抓到的 HTML”当成原始页面。  
   实际在 RssAny 默认链路里，`ctx.fetchHtml()` 返回的是净化后 HTML；净化会移除 `class/style`。
2. 解析策略过于依赖 class 选择器。  
   首版主路径依赖 `.publications/.title/.author/.periodical`，在净化后这些类名消失，导致全量失配。
3. 验证场景不一致。  
   首轮验证主要基于 `curl` 原始 HTML，没有同步覆盖“运行时真实输入（purified HTML）”。
4. 缺少语义兜底主路径。  
   没有先做“结构语义解析”（如 `h2 + li + div[id] + abbr + a`），导致抗净化能力不足。

## 修复做了什么
1. 将解析主路径改为结构语义优先，不依赖 class：
   - 年份：`h2` 文本提取
   - 条目：`li` 遍历
   - 主体：优先 `div[id]`
   - 期刊：`em` 文本
   - 分类：`abbr`
   - 链接：优先 `HTML/arXiv/DOI`，其次 `PDF`，否则回退锚点
2. 增加双输入回归验证：
   - `raw HTML`：可解析
   - `purified HTML`：可解析
   - 两者均解析出 `54` 条且必需字段完整

## 这次暴露的工程问题
- 对框架输入约束认识不完整（未先读净化逻辑）。
- 测试用例没有覆盖“真实运行数据形态”。
- 初版实现把“增强路径”当成“主路径”（应反过来）。

## 后续防复发清单（Web 插件）
1. 开发前先确认 `fetchHtml` 是否净化、会移除哪些属性/标签。  
2. 主解析路径必须不依赖 class/style；class 仅可作增强或加速。  
3. 每次提交前至少做两组验证：`purify=true` 与 `purify=false`。  
4. 无结果时抛出可诊断错误，并在错误中标注插件 id。  
5. 对关键站点固定保留 1 条本地回归命令，避免只靠肉眼检查。

