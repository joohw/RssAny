/**
 * 安全解析 API 响应为 JSON，避免非 JSON 响应导致的解析错误
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const trimmed = text.trim();
  if (!res.ok) {
    const preview = trimmed.length > 100 ? trimmed.slice(0, 100) + '…' : trimmed;
    throw new Error(`请求失败 ${res.status} ${res.statusText}${preview ? `：${preview}` : ''}`);
  }
  if (!trimmed) {
    throw new Error('API 返回空内容');
  }
  try {
    const parsed = JSON.parse(trimmed) as T;
    if (parsed === null && trimmed === 'null') {
      throw new Error('API 返回 null');
    }
    return parsed;
  } catch (e) {
    if (e instanceof Error && e.message === 'API 返回 null') throw e;
    const msg = e instanceof SyntaxError ? e.message : String(e);
    const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
    throw new Error(`API 返回格式异常: ${msg}。响应预览: ${preview}`);
  }
}
