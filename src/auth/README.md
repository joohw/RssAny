# auth

认证模块：AuthFlow 类型、AuthRequiredError、与 fetcher 的 preCheckAuth 配合使用。

## 结构

- `types.ts`：AuthFlow、CheckAuthFn
- `errors.ts`：AuthRequiredError（预检失败时抛出）
- `index.ts`：聚合导出

## 流程

1. Feeder 调用 getRss 时，若站点有 auth（checkAuth、loginUrl、domain），先执行 preCheckAuth
2. preCheckAuth 检查 domains/{domain}.json 是否存在且 cookies 有效
3. 若不存在或无效，抛出 AuthRequiredError
4. Router 捕获后返回 statics/401.html，状态码 401
