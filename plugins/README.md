# plugins

RssAny 外部站点插件目录。所有 `*.rssany.js` 会在启动时被加载并合并到站点列表，用于声明列表 URL 形态、解析器、正文提取器及登录认证。

## 规范

- 文件命名：`*.rssany.js`
- 实现 `Site` 接口（见 `src/sites/types.ts`）：必填 `id`、`listUrlPattern`，可选 `detailUrlPattern`（详情页 URL 模式，供 /extractor 匹配）、`parser`、`extractor`、`checkAuth`、`loginUrl`、`domain`、`proxy` 等
- 插件为 ESM 模块，`export default` 为 Site 对象
- **代理配置**：在 Site 对象中添加 `proxy` 字段，该站点的所有请求将使用此代理；不设置则使用环境变量 `HTTP_PROXY`/`HTTPS_PROXY`。示例：
  - 无认证：`proxy: "http://127.0.0.1:7890"`、`proxy: "socks5://127.0.0.1:1080"`
  - 带账号密码：`proxy: "http://用户名:密码@proxy.example.com:8080"`（密码含特殊字符时需做 URL 编码）

## 当前插件

| 文件 | 站点 | 列表 URL 形态 | 说明 |
|------|------|----------------|------|
| `xiaohongshu.rssany.js` | 小红书 | `https://www.xiaohongshu.com/user/profile/{userId}` | 用户主页笔记列表、详情提取、登录预检 |
| `lingowhale.rssany.js` | 语鲸 | `https://lingowhale.com/channels`（含 `?channel_id=...`） | 频道列表（parser：卡片结构，封面+标题+描述+元信息）；登录态通过 `/home` 页用户元素判断 |

## 子项目约束

- 新增站点时在此目录新增 `xxx.rssany.js`，并在此 README 的「当前插件」中补充一行说明
- 不在此目录放置与 Site 插件无关的脚本
