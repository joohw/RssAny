// Toast 通知状态管理：全局单例，各页面通过 showToast 触发

import { writable } from 'svelte/store';


interface ToastState {
  message: string;
  type: string;
  show: boolean;
}


export const toastStore = writable<ToastState>({ message: '', type: '', show: false });


let _timer: ReturnType<typeof setTimeout>;


/** 显示 Toast 通知，type 可为 '' | 'error' | 'success' */
export function showToast(message: string, type = ''): void {
  clearTimeout(_timer);
  toastStore.set({ message, type, show: true });
  _timer = setTimeout(() => toastStore.update((s) => ({ ...s, show: false })), 3000);
}
