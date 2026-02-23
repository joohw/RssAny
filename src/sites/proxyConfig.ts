// 全局代理配置：从 proxy.json 加载，支持按站点 ID 或 URL 正则表达式匹配

import { readFile } from "node:fs/promises";
import { join } from "node:path";


/** 代理配置映射表：key 为站点 ID 或 URL 正则表达式，value 为代理地址 */
let proxyMap: Record<string, string> = {};


/** 已编译的正则表达式缓存 */
const regexCache = new Map<string, RegExp>();


/** 编译正则表达式（带缓存） */
function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern)!;
  }
  try {
    const regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
    return regex;
  } catch {
    return null;
  }
}


/** 根据站点 ID 或 URL 获取代理配置 */
export function getProxyForSite(siteId: string, url?: string): string | undefined {
  // 优先按站点 ID 匹配
  if (proxyMap[siteId]) {
    return proxyMap[siteId];
  }
  // 如果有 URL，尝试按正则表达式匹配
  if (url) {
    for (const [pattern, proxy] of Object.entries(proxyMap)) {
      // 跳过已经是站点 ID 的 key（避免重复匹配）
      if (pattern === siteId) continue;
      const regex = compileRegex(pattern);
      if (regex && regex.test(url)) {
        return proxy;
      }
    }
  }
  return undefined;
}


/** 根据 URL 获取代理配置（用于没有站点信息的场景） */
export function getProxyForUrl(url: string): string | undefined {
  for (const [pattern, proxy] of Object.entries(proxyMap)) {
    const regex = compileRegex(pattern);
    if (regex && regex.test(url)) {
      return proxy;
    }
  }
  return undefined;
}


/** 加载代理配置文件 */
export async function loadProxyConfig(configPath?: string): Promise<void> {
  const path = configPath ?? join(process.cwd(), "proxy.json");
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      proxyMap = parsed;
      regexCache.clear();
      console.log(`[Proxy] 已加载 ${Object.keys(proxyMap).length} 条代理配置`);
    } else {
      console.warn("[Proxy] proxy.json 格式无效，应为对象");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("[Proxy] proxy.json 不存在，跳过代理配置");
    } else {
      console.warn(`[Proxy] 加载配置失败:`, err instanceof Error ? err.message : String(err));
    }
    proxyMap = {};
  }
}


/** 获取当前代理配置（用于调试） */
export function getProxyMap(): Readonly<Record<string, string>> {
  return { ...proxyMap };
}
