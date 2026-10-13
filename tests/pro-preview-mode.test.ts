import { afterEach, expect, it, vi } from 'vitest';
import { hasProConnection, proPreviewSelected, selectProPreview } from '../src/pro/preview-mode';
afterEach(() => vi.unstubAllGlobals());
it('keeps browsing selection separate from server execution settings', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const settings = { enabled: false, serverId: undefined, deviceId: undefined };
  selectProPreview(true); expect(proPreviewSelected()).toBe(true); expect(settings.enabled).toBe(false);
  selectProPreview(false); expect(proPreviewSelected()).toBe(false);
});
it('requires both server and device identity for an established connection', () => {
  expect(hasProConnection({ serverId: 'server' })).toBe(false);
  expect(hasProConnection({ deviceId: 'device' })).toBe(false);
  expect(hasProConnection({ serverId: 'server', deviceId: 'device' })).toBe(true);
});
