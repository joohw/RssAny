# 为插件提供翻译：字段与扩展设计评估

## 现状简述

- **FeedItem**：`title`、`summary`、`content` 为「原文」；有 `extra` 扩展字段。
- **输出**：RSS 的 `toRssEntry`、写文件模块的 `buildItemMarkdown`、DB 的 `title/summary/content` 均只消费原文。
- **RssChannel** 已有 `language`（频道级），条目级无语言/译文字段。

## 设计目标

1. **插件可产出译文**：插件在 `fetchItems` 或 `enrichItem` 中调用翻译服务后，能把译文交给框架统一消费。
2. **原文保留**：译文与原文并存，下游可按策略选择「只出原文 / 只出译文 / 双语」。
3. **可演进**：先支持「单目标语种」即可，后续可扩展多语种而不破坏现有用法。

---

## 方案一：FeedItem 上增加可选 `translation`（推荐）

### 字段形状

```ts
// src/types/feedItem.ts

/** 单目标语种的译文（插件或框架在 enrich 后填入） */
export interface ItemTranslation {
  /** 目标语种，如 "zh-CN"、"en"（BCP 47） */
  lang: string;
  title?: string;
  summary?: string;
  content?: string;
}

export interface FeedItem {
  // ... 现有字段 ...
  /**
   * 可选译文。存在时，RSS/Signal/API 可根据配置或请求参数优先使用译文作为 title/description/content。
   * 由插件在 enrichItem 中调用翻译 API 后写入，或由框架在 enrich 后统一调用翻译服务写入。
   */
  translation?: ItemTranslation;
}
```

### 优点

- **约定清晰**：所有下游（feeder、rss、writer、db、api）都认同一套结构，便于「有 translation 则优先用译文」的策略。
- **单语种先行**：一个条目只带一种目标语译文，类型简单；后续若要多语种，可改为 `translations?: Record<string, Omit<ItemTranslation, 'lang'>>`，key 为 lang。
- **插件与框架两种用法**：
  - **插件自产**：在 `enrichItem` 里调翻译 API，给 `item.translation = { lang: 'zh-CN', title, summary, content }` 即可。
  - **框架统一**：在 Site 或 FeederConfig 上声明「需要翻译 + 目标语种」，enrich 完成后由框架再调一次翻译服务并写回 `item.translation`（需额外抽象，见下）。

### 下游策略（简述）

- **RSS**：若 `FeederConfig` 或 channel 有「输出语言」且 `item.translation?.lang` 匹配，则 `toRssEntry` 用 `translation.title` / `translation.content` 等生成 `<title>`、`<description>`；否则用原文。
- **writer**：若 config 中有「输出语言」且匹配，则 markdown 用译文；否则用原文。
- **DB**：可新增一列 `translation TEXT`（JSON 序列化 `ItemTranslation`），或 `title_zh`、`summary_zh`、`content_zh` 等；若只存一种译文，JSON 更省事且便于以后多语种。
- **API**：查询时可支持 `?lang=zh-CN`，返回项中若存在匹配的 `translation`，则用译文覆盖或填充到响应字段。

---

## 方案二：仅用 `extra` 存译文

插件自行约定例如 `extra.translation = { lang, title, summary, content }` 或 `extra['translation_zh-CN']`。

- **优点**：不改 FeedItem 核心类型，不改 DB schema 即可试验。
- **缺点**：无统一契约，每个插件形状可能不同；feeder/rss/writer 需要写死若干 key 或约定，难以统一「优先译文」策略，不利于后续框架级翻译集成。**仅适合临时或单插件试验。**

---

## 方案三：多语种一步到位

在 FeedItem 上使用：

```ts
translations?: Record<string, { title?: string; summary?: string; content?: string }>;
```

key 为 BCP 47（如 `"zh-CN"`、`"en"`）。

- **优点**：一条条目可带多种译文，API 可按 `?lang=` 直接取。
- **缺点**：类型和 DB 设计更重（多列或 JSON 大对象）；当前若只需「插件为某一语种提供译文」，优先用方案一更简单，需要时再演进到 `translations`。

---

## 插件 / 配置侧扩展（若采用方案一）

- **仅插件自产译文**：无需改 Site 接口；插件在 `enrichItem` 里写 `item.translation = { ... }` 即可。
- **框架统一翻译**：需要二选一或组合：
  - **Site 可选能力**：如 `translateItem?(item: FeedItem, ctx: SiteContext): Promise<FeedItem>`，在 enrich 完成后由 feeder 调用（若存在），用于「该站点统一走某翻译服务」。
  - **FeederConfig / config.json**：如 `translateTargetLang?: string`、`translateProvider?: 'llm' | 'external'`，由 feeder 在 enrich 后对未带 `translation` 的条目再调一次框架提供的翻译服务并写回 `item.translation`。

两种方式可以并存：插件自己写了 `translation` 就跳过框架翻译，否则由框架按配置补一次。

---

## 小结

| 项目         | 建议 |
|--------------|------|
| **FeedItem** | 增加可选 `translation?: ItemTranslation`（含 `lang` + `title/summary/content`）。 |
| **插件**     | 在 `enrichItem` 中可选地写入 `item.translation`；无需改 Site 接口即可支持「插件自产译文」。 |
| **框架**     | 若要做「统一翻译」，再增加 Site.translateItem 或 FeederConfig + 翻译服务抽象。 |
| **DB**       | 可选一列 `translation TEXT`（JSON），或暂不落库、仅内存/缓存中使用译文，视检索与推送需求再定。 |
| **RSS/writer** | 根据「输出语言」配置与 `item.translation?.lang` 决定用原文还是译文生成 title/description/content。 |

这样设计可以满足「为插件提供翻译」的字段需求，同时为后续多语种和框架级翻译留出扩展空间。
