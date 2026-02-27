# 爬虫订阅与首页信息流解耦：Channel 设计

## 1. 角色划分

- **爬虫（Crawler）**
  - 概念：**信源（source）** 扁平列表，无订阅/频道层级。
  - 职责：按配置定期抓取「所有 source」，把条目写入数据库（`items` 表，`source_url` = ref）。
  - 配置：**仅** 使用 **`.rssany/sources.json`**，格式为 `{ "sources": [ { "ref", "label?", "refresh?", "proxy?" }, ... ] }`，即所有要抓取的网站/信源列表。

- **首页信息流（Feed / 聚合展示）**
  - 概念：**Channel** = 一份「要把哪些 source 聚合在一起展示」的清单。
  - 职责：从数据库按「channel 所包含的 source_url 列表」分页查 `items`，聚合成一条时间线展示。
  - 配置：使用**独立配置文件**，与爬虫的订阅解耦。例如 **`.rssany/channels.json`**：定义多个 channel，每个 channel 只列出要聚合的 source ref（即 `source_url`，与 DB 中一致）。

这样：
- 爬虫只管「抓什么、多久抓」——只读 `sources.json`。
- 首页信息流只管「展示哪些 source 的合集」——只读 `channels.json`。
- 两者可以不一致：爬虫抓 sources.json 中的全部信源；首页信息流只展示 channels.json 里配置的 sourceRefs 合集。

---

## 2. 配置文件职责

| 文件 | 使用者 | 含义 |
|------|--------|------|
| **`.rssany/sources.json`** | 爬虫 / Scheduler | 扁平信源列表 `{ sources: [] }`。定义「爬虫要抓哪些 ref、每源 refresh/proxy」。 |
| **`.rssany/channels.json`** | 首页 Feed API / WebUI | Channel → source refs。定义「信息流里要把哪些 source 聚合成一个流、以及频道名等展示用元数据」。 |

---

## 3. Source 的 id：由 ref 派生

- **当前**：source 没有独立 id，**ref** 即唯一标识（DB 里 `items.source_url`、配置里 `sourceRefs[]` 都是 ref）。
- **约定**：可根据 ref **派生** 一个稳定、短小的 **source id**，无需在配置里多写字段：
  - 算法示例：`sourceId = sourceIdFromRef(ref)`，例如对 ref 做 **SHA-256** 取前 **12 位十六进制**（或 8 位），同一 ref 永远得到同一 id。
  - 不在 `sources.json` / `channels.json` 里存 id；需要 id 时现场算即可（API 返回、日志、前端展示用）。
- **存储与配置**：DB 和 channel 配置继续用 **ref** 作为唯一键；id 仅作为「由 ref 派生的展示/API 用短标识」，不做主键或反向查找（若真要 id→ref，可维护一张 id→ref 缓存或只在「已有 ref 的上下文」里用 id）。

```ts
// 示例：src/utils/sourceId.ts
import { createHash } from "node:crypto";

const ID_LEN = 12; // 可配置

export function sourceIdFromRef(ref: string): string {
  return createHash("sha256").update(ref, "utf8").digest("hex").slice(0, ID_LEN);
}
```

---

## 4. Channel 配置格式（channels.json）

建议结构（与现有 subscriptions 风格一致，但只关心「聚合哪些 source」）：

```json
{
  "all": {
    "title": "全部",
    "description": "所有频道聚合",
    "sourceRefs": []
  },
  "tech": {
    "title": "科技",
    "description": "科技媒体与资讯",
    "sourceRefs": [
      "https://www.theinformation.com/",
      "https://techcrunch.com/category/artificial-intelligence/",
      "https://www.technologyreview.com/",
      "https://venturebeat.com/"
    ]
  },
  "hn": {
    "title": "Hacker News",
    "sourceRefs": [
      "https://news.ycombinator.com/newest"
    ]
  }
}
```

- **key**：channel id（URL 或筛选参数用，如 `/feed/tech`、`?channel=tech`）。
- **sourceRefs**：字符串数组，每一项为信源 ref（即爬虫里的 ref，与 DB `items.source_url` 一致）。只有出现在这里的 source 的条目会进入该 channel 的信息流。
- **特殊 channel id `all`**（可选）：
  - 若 `sourceRefs` 为 **空数组 `[]`**：表示「全部」= 当前配置中**所有 channel** 的 sourceRefs 的并集（即所有在任一 channel 里出现过的 source）。
  - 若希望「全部」仅指某几个 source，也可在 `all.sourceRefs` 里显式列出。

这样首页「全部」Tab 与「科技」「HN」等 Tab 都只依赖 channels 配置，不读 subscriptions。

---

## 5. 数据流（与现有实现的关系）

- **爬虫**
  - 读 **sources.json** → 得到扁平信源列表（`getAllSources()`），每项含 ref、refresh、proxy 等。
  - Scheduler 按每个 source 的 refresh 定时调用 `getItems(ref, { writeDb: true, ... })`。
  - 条目写入 DB，`source_url` = ref。

- **首页信息流**
  - 读 **channels.json** → 得到 `getAllChannelConfigs()`（新接口），结构为 `{ id, title, description?, sourceRefs }[]`。
  - `/api/feed`：参数 `channel`（或保留 `sub` 命名但语义为 channel id）。
    - 若 `channel=all` 或未传：使用「所有 channel 的 sourceRefs 的并集」。
    - 若 `channel=tech`：只使用 id 为 `tech` 的 channel 的 `sourceRefs`。
  - 用得到的 `sourceRefs` 列表调 `queryFeedItems(sourceUrls, limit, offset)`，再为每条 item 附上 channel 信息（当前 item 的 source_url 属于哪个 channel，用于 Tab 高亮等可选）。
  - 返回 `{ channels, items, hasMore }`，channels 来自 channels.json，items 来自 DB。

- **解耦结果**
  - Feed 层不再依赖爬虫的 `sources.json` 或任何「订阅」配置。
  - 爬虫 / scheduler 不依赖 channels.json。

---

## 6. 实现要点（建议）

1. **Channel 类型与读取**
   - 新增 `src/channel/types.ts`：`ChannelConfig`（id, title?, description?, sourceRefs: string[]）。
   - 新增 `src/channel/index.ts`：`CHANNELS_CONFIG_PATH`（如 `.rssany/channels.json`），`loadChannels()` → `ChannelConfigWithId[]`，`getAllChannelConfigs()`，`getChannelConfig(id)`。若文件不存在或空，返回默认一个 `all` channel（sourceRefs 为空，表示「暂无 channel 配置」时展示空或全量 source 由产品定）。

2. **Feed API 改为基于 Channel**
   - Router 中 `/api/feed`：从 **channel 模块** 取 `getAllChannelConfigs()`；根据 query 的 `channel`（或 `sub`）选出要用的 `sourceRefs`，合并去重后调 `queryFeedItems(sourceUrls, limit, offset)`；返回 `channels`（列表供 Tab）+ `items` + `hasMore`。不再调用 `getAllSubscriptionConfigs()`。

3. **前端**
   - 信息流页的 Tab/筛选：数据来自 `/api/feed` 的 `channels`；切换 Tab 时请求 `?channel=xxx`。文案可改为「频道」或保持「订阅」仅指 UI 用语，后端语义已是 channel。

4. **Scheduler / 爬虫**
   - 仅依赖 **sources.json**：读该文件得到扁平信源列表（`getAllSources()`），按每源 refresh 独立调度；不做 channel 相关逻辑。

5. **管理面**
   - **爬虫配置（sources）**：直接编辑 `sources.json`（扁平列表），前端不提供编辑入口；可选提供 GET/PUT `/api/sources/raw` 供脚本/调试。
   - **频道管理**：新增「频道」的 CRUD 或 raw 编辑 `channels.json`，与爬虫配置分开；Feed 只消费 channels。

6. **默认 / 迁移**
   - 首次启用 channel：若不存在 `channels.json`，可根据 `sources.json` 生成默认 channels（扁平格式下生成一个 "all" channel，sourceRefs = 所有 ref），之后两者独立演进。

---

## 7. 小结

- **爬虫**：仅用 **sources.json**，file-based；**扁平信源列表**（无订阅/频道层级）；每源按 refresh 定期抓取，写 DB。
- **首页信息流**：仅用 **channels.json**（独立配置），定义 **channel → sourceRefs**；Feed API 只读 channels + DB，不读 sources。
- **Channel** = 展示侧「把哪些 source 聚合成一条流」的配置，与爬虫的 sources 配置完全解耦；同一套 DB 里的 `items`，爬虫按 sources 配置写入，展示按 channel 读取。
