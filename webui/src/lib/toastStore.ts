import { writable } from 'svelte/store';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const toast = writable<{ msg: string; type: string }>({ msg: '', type: '' });

export function showToast(msg: string, type = '') {
  toast.set({ msg, type });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set({ msg: '', type: '' }), 3500);
}
