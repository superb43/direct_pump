import type { ProSettings } from './contracts';

/** This preference selects a view; it never grants server execution authority. */
const PREVIEW_KEY = 'dp-pro-preview';
export function proPreviewSelected(): boolean {
  try { return sessionStorage.getItem(PREVIEW_KEY) === 'true'; } catch { return false; }
}
export function selectProPreview(selected: boolean): void {
  try { if (selected) sessionStorage.setItem(PREVIEW_KEY, 'true'); else sessionStorage.removeItem(PREVIEW_KEY); } catch { /* View selection remains available without storage. */ }
}
export function hasProConnection(settings: Pick<ProSettings, 'serverId' | 'deviceId'>): boolean {
  return Boolean(settings.serverId && settings.deviceId);
}
