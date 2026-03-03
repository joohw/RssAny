# Pipeline 设计：爬虫 → 处理 → 入库

## 现状审查

**当前流程**：爬虫抓取 → **直接入库**

```
fetchItems() → items.forEach(sourceRef) → upsertItems() → DB
                    ↓
              [可选] enrichQueue.submit() → enrichItem() → updateItemContent() → DB
```

- **列表条目**：`fetchItems` 后立即 `upsertItems`，无中间处理
- **详情正文**：`enrichItem` 后立即 `updateItemContent`，无中间处理
- **翻译 / 打标签**：目前依赖插件在 `enrichItem` 内自行实现，无统一 pipeline

## 设计目标

1. **可插拔 pipeline**：在入库前插入可配置的处理链
2. **统一接口**：每个处理函数遵循 `(item, ctx) => Promise<FeedItem>`，保证输出格式一致
3. **多阶段支持**：列表入库前、详情补全后均可经过 pipeline
4. **典型用例**：翻译、打标签、摘要生成、敏感词过滤等

## 接口定义

```ts
/** Pipeline 处理函数：接收 FeedItem，返回处理后的 FeedItem，必须保持类型兼容 */
export type PipelineFn = (
  item: FeedItem,
  ctx: PipelineContext
) => Promise<FeedItem>;

export interface PipelineContext {
  /** 列表页 URL（信源标识） */
  sourceUrl: string;
  /** 是否已 enrich（有 content），用于区分列表阶段与详情阶段 */
  isEnriched?: boolean;
  /** 其他扩展上下文 */
  [key: string]: unknown;
}
```

## 执行时机

| 阶段 | 时机 | 典型用途 |
|------|------|----------|
| **beforeUpsert** | fetchItems 后、upsertItems 前 | 基于 title/summary 的标签、简单翻译 |
| **beforeUpdateContent** | enrichItem 后、updateItemContent 前 | 基于 content 的翻译、摘要、标签 |

两阶段共用同一套 `steps` 配置，处理函数可根据 `ctx.isEnriched` 决定是否执行或做不同逻辑。

## 配置

`.rssany/config.json`：

```json
{
  "pipeline": {
    "enabled": true,
    "steps": ["tag", "translate"]
  }
}
```

- `enabled`：是否启用 pipeline，默认 `false`（保持向后兼容）
- `steps`：处理函数名数组，按顺序执行

## 注册机制

- **内置步骤**：`tag`、`translate` 等由框架提供（可先为空实现）
- **用户步骤**：`.rssany/pipeline/*.rssany.js` 导出 `{ name: string; run: PipelineFn }`，启动时加载并注册

## 数据流（改造后）

```
fetchItems() → pipeline.run(items, { isEnriched: false }) → upsertItems() → DB
                    ↓
              enrichQueue.submit()
                    ↓
              enrichItem() → pipeline.run([item], { isEnriched: true }) → updateItemContent() → DB
```

## 与现有模块的关系

- **enrich**：负责「拉取详情正文」，pipeline 负责「对已有字段做变换」
- **translations**：FeedItem 已有 `translations` 字段，翻译步骤写入 `item.translations[lng]`
- **categories**：FeedItem 已有 `categories` 字段，标签步骤写入 `item.categories`
