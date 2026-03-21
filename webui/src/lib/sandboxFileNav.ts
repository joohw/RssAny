/** 沙盒浏览：当前目录与待打开文件用 sessionStorage，页面 URL 固定为 /folders、/folders/file（无查询参数）。API 使用查询参数 rel。 */

const KEY_FILE = 'rssany.sandboxFileRel';
const KEY_FOLDER = 'rssany.sandboxFolderRel';

function norm(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function stashSandboxFileRel(rel: string): void {
  try {
    sessionStorage.setItem(KEY_FILE, norm(rel));
  } catch {
    /* 隐私模式等 */
  }
}

export function peekSandboxFileRel(): string {
  try {
    return norm(sessionStorage.getItem(KEY_FILE) ?? '');
  } catch {
    return '';
  }
}

export function stashSandboxFolderRel(rel: string): void {
  try {
    sessionStorage.setItem(KEY_FOLDER, norm(rel));
  } catch {
    /* 隐私模式等 */
  }
}

export function peekSandboxFolderRel(): string {
  try {
    return norm(sessionStorage.getItem(KEY_FOLDER) ?? '');
  } catch {
    return '';
  }
}
