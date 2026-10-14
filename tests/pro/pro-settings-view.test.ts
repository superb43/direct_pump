import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ send: vi.fn(), permission: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: transport.send }, permissions: { request: transport.permission },
} }));
import { mountProSettings } from '../../src/pro/settings-view';
import type { ProSettings } from '../../src/pro/contracts';

// Request/lifetime adapter only; browser-rendered QA verifies wrapping and spacing.
class SettingsElement {
  value = ''; checked = false; textContent = ''; innerHTML = ''; hidden = false; disabled = false;
  className = ''; type = ''; open = false; children: SettingsElement[] = [];
  nodes = new Map<string, SettingsElement>();
  events = new Map<string, () => void>();
  focus() {}
  querySelector(selector: string): SettingsElement {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new SettingsElement());
    return this.nodes.get(selector)!;
  }
  addEventListener(name: string, callback: () => void, options?: { signal: AbortSignal }) {
    this.events.set(name, callback);
    options?.signal.addEventListener('abort', () => this.events.delete(name), { once: true });
  }
  append(...nodes: SettingsElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: SettingsElement[]) { this.children = nodes; }
  fire(name: string) { this.events.get(name)?.(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settings: ProSettings = { enabled: false, serverUrl: '', chromeNotifications: false };
const paired = { ...settings, enabled: true, serverUrl: 'https://pro.example.com', deviceId: 'device' };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function mount() {
  const container = new SettingsElement();
  const controller = mountProSettings(container as unknown as HTMLElement);
  const root = container.querySelector('.pro-settings');
  return { container, root, controller, input: (name: string) => root.querySelector(`[name="${name}"]`), node: (name: string) => root.querySelector(`[data-pro="${name}"]`) };
}
beforeEach(() => {
  transport.send.mockReset(); transport.permission.mockReset();
  transport.permission.mockResolvedValue(true);
  transport.send.mockImplementation(async (request: { action: string; path?: string }) => ({ ok: true, data: request.action === 'SETTINGS' ? settings : request.path === '/v1/health' ? { capabilities: ['withdrawals-v1'] } : [] }));
  vi.stubGlobal('document', { createElement: () => new SettingsElement() });
});
afterEach(() => vi.unstubAllGlobals());

describe('Reusable Pro settings lifetime', () => {
  it('collapses only connection controls without discarding drafts or reviewed recipients', async () => {
    const mounted = mount(); await tick();
    mounted.node('connection').open = true; mounted.node('recipients').open = true;
    mounted.input('proCode').value = 'draft'; mounted.node('recipient-review').hidden = false;
    mounted.controller.collapseConnection();
    expect(mounted.node('connection').open).toBe(false);
    expect(mounted.node('recipients').open).toBe(true);
    expect(mounted.input('proCode').value).toBe('draft');
    expect(mounted.node('recipient-review').hidden).toBe(false);
    mounted.controller.destroy();
  });
  it('requests notification permission synchronously and saves ON/OFF without requesting permission for OFF', async () => {
    let stored = { ...settings };
    transport.send.mockImplementation(async request => {
      if (request.settings) stored = request.settings;
      return { ok: true, data: stored };
    });
    const mounted = mount(); await tick();
    mounted.input('proNotifications').checked = true; mounted.input('proNotifications').fire('change');
    expect(transport.permission).toHaveBeenCalledWith({ permissions: ['notifications'] });
    expect(mounted.input('proNotifications').disabled).toBe(true); await tick();
    expect(stored.chromeNotifications).toBe(true);
    expect(mounted.input('proNotifications').disabled).toBe(false);
    transport.permission.mockClear();
    mounted.input('proNotifications').checked = false; mounted.input('proNotifications').fire('change'); await tick();
    expect(transport.permission).not.toHaveBeenCalled();
    expect(stored.chromeNotifications).toBe(false);
    mounted.controller.destroy();
  });
  it('restores the saved notification state after permission denial or save failure', async () => {
    for (const permissionDenied of [true, false]) {
      const mounted = mount(); await tick();
      if (permissionDenied) transport.permission.mockResolvedValueOnce(false);
      else transport.send.mockImplementationOnce(async () => ({ ok: false, error: 'Save failed.' }));
      const baseline = transport.send.mock.calls.length;
      mounted.input('proNotifications').checked = true; mounted.input('proNotifications').fire('change'); await tick();
      expect(mounted.input('proNotifications').checked).toBe(false);
      expect(mounted.input('proNotifications').disabled).toBe(false);
      expect(mounted.node('status').textContent).toContain(permissionDenied ? 'permission was not granted' : 'Save failed');
      if (permissionDenied) expect(transport.send.mock.calls).toHaveLength(baseline);
      mounted.controller.destroy();
    }
  });
  it('does not save notifications after teardown during permission approval', async () => {
    const permission = deferred<boolean>(); transport.permission.mockReturnValueOnce(permission.promise);
    const mounted = mount(); await tick(); const baseline = transport.send.mock.calls.length;
    mounted.input('proNotifications').checked = true; mounted.input('proNotifications').fire('change');
    mounted.controller.destroy(); permission.resolve(true); await tick();
    expect(transport.send.mock.calls).toHaveLength(baseline);
  });

  it('mounts and refreshes using reads only', async () => {
    const mounted = mount(); await tick(); await mounted.controller.refresh();
    expect(transport.send.mock.calls.map(([request]) => request)).toEqual([
      { type: 'PRO', action: 'SETTINGS' }, { type: 'PRO', action: 'SETTINGS' },
    ]);
    expect(transport.permission).not.toHaveBeenCalled();
    mounted.controller.destroy();
  });
  it('ignores an older settings response when a newer refresh has completed', async () => {
    const old = deferred<{ ok: true; data: ProSettings }>();
    transport.send.mockImplementationOnce(() => old.promise);
    const mounted = mount(); await mounted.controller.refresh();
    old.resolve({ ok: true, data: { ...settings, enabled: true, serverUrl: 'https://stale.example.com' } }); await tick();
    expect(mounted.input('proServer').value).toBe('');
    expect(mounted.node('toggle').textContent).toBe('Enable Pro');
    mounted.controller.destroy();
  });
  it('discards success and error responses and listeners after destroy', async () => {
    for (const fail of [false, true]) {
      const pending = deferred<{ ok: true; data: ProSettings }>();
      transport.send.mockImplementationOnce(() => pending.promise);
      const mounted = mount(); mounted.node('status').textContent = 'Kept'; mounted.controller.destroy();
      if (fail) pending.reject(new Error('Late error')); else pending.resolve({ ok: true, data: paired });
      await tick(); await mounted.controller.refresh(); mounted.node('toggle').fire('click');
      expect(mounted.node('status').textContent).toBe('Kept');
      expect(mounted.input('proServer').value).toBe('');
      expect(mounted.node('toggle').events.size).toBe(0);
    }
  });
  it('stops health/recipient refresh callbacks after destroy', async () => {
    const health = deferred<{ ok: true; data: { capabilities: string[] } }>();
    transport.send.mockImplementation(async (request: { action: string; path?: string }) => request.action === 'SETTINGS' ? { ok: true, data: paired } : health.promise);
    const mounted = mount(); await tick(); mounted.controller.destroy();
    health.resolve({ ok: true, data: { capabilities: ['withdrawals-v1'] } }); await tick();
    expect(mounted.node('recipients').hidden).toBe(true);
    expect(transport.send.mock.calls.map(([request]) => request.path)).not.toContain('/v1/recipients');
  });
  it('does not render a late recipient list response after destroy', async () => {
    const recipients = deferred<{ ok: true; data: unknown[] }>();
    transport.send.mockImplementation(async (request: { action: string; path?: string }) => request.action === 'SETTINGS' ? { ok: true, data: paired } : request.path === '/v1/health' ? { ok: true, data: { capabilities: ['withdrawals-v1'] } } : recipients.promise);
    const mounted = mount(); await tick(); mounted.controller.destroy();
    recipients.resolve({ ok: true, data: [{ id: 'recipient', name: 'Late wallet', address: 'So11111111111111111111111111111111111111112', active: true }] }); await tick();
    expect(mounted.node('recipient-list').children).toHaveLength(0);
  });
  it('does not POST a reviewed recipient when teardown happens during its lookup', async () => {
    const recipients = deferred<{ ok: true; data: unknown[] }>();
    transport.send.mockImplementation(async (request: { action: string; path?: string }) => ({ ok: true, data: request.action === 'SETTINGS' ? paired : request.path === '/v1/health' ? { capabilities: ['withdrawals-v1'] } : [] }));
    const mounted = mount(); await tick();
    mounted.input('recipientName').value = 'Trusted wallet'; mounted.input('recipientAddress').value = 'So11111111111111111111111111111111111111112';
    mounted.node('review-recipient').fire('click'); mounted.input('recipientVerified').checked = true;
    transport.send.mockImplementationOnce(() => recipients.promise);
    mounted.node('save-recipient').fire('click'); mounted.controller.destroy();
    recipients.resolve({ ok: true, data: [] }); await tick();
    expect(transport.send.mock.calls.some(([request]) => request.method === 'POST')).toBe(false);
    expect(mounted.input('recipientName').value).toBe('Trusted wallet');
  });
  it('starts pairing permission in the user gesture and does not pair after teardown', async () => {
    const permission = deferred<boolean>(); transport.permission.mockReturnValue(permission.promise);
    const mounted = mount(); await tick(); mounted.input('proServer').value = 'https://pro.example.com';
    mounted.input('proCode').value = 'test-code';
    mounted.node('pair').fire('click');
    expect(transport.permission).toHaveBeenCalledWith({ origins: ['https://pro.example.com/*'] });
    mounted.controller.destroy(); permission.resolve(true); await tick();
    expect(transport.send.mock.calls.some(([request]) => request.action === 'PAIR')).toBe(false);
  });
  it('explains a missing code before requesting browser permission or pairing', async () => {
    const mounted = mount(); await tick(); mounted.input('proServer').value = 'https://pro.example.com';
    mounted.node('pair').fire('click'); await tick();
    expect(transport.permission).not.toHaveBeenCalled();
    expect(mounted.node('status').textContent).toContain('Generate a code on your server');
    expect((mounted.node('pairing-help') as unknown as HTMLDetailsElement).open).toBe(true);
    expect(transport.send.mock.calls.some(([request]) => request.action === 'PAIR')).toBe(false);
    mounted.controller.destroy();
  });
  it('accepts the quoted JSON string printed by the server CLI', async () => {
    const mounted = mount(); await tick(); mounted.input('proServer').value = 'https://pro.example.com';
    mounted.input('proCode').value = '"test-code"'; mounted.node('pair').fire('click'); await tick();
    expect(transport.send).toHaveBeenCalledWith({ type: 'PRO', action: 'PAIR', serverUrl: 'https://pro.example.com', code: 'test-code' });
    mounted.controller.destroy();
  });
  it('opens code issuance help after an expired code without discarding the entered code', async () => {
    const mounted = mount(); await tick(); mounted.input('proServer').value = 'https://pro.example.com';
    mounted.input('proCode').value = 'old-code';
    transport.send.mockImplementation(async request => request.action === 'PAIR' ? { ok: false, error: 'Pairing code is invalid, expired, or already used. Generate a new code on your server and try again within 5 minutes.' } : { ok: true, data: settings });
    mounted.node('pair').fire('click'); await tick();
    expect((mounted.node('pairing-help') as unknown as HTMLDetailsElement).open).toBe(true);
    expect(mounted.node('status').textContent).toContain('Generate a new code');
    expect(mounted.input('proCode').value).toBe('old-code');
    mounted.controller.destroy();
  });
  it('requires explicit full-address comparison and invalidates review on an edit', async () => {
    transport.send.mockImplementation(async (request: { action: string; path?: string }) => ({ ok: true, data: request.action === 'SETTINGS' ? paired : request.path === '/v1/health' ? { capabilities: ['withdrawals-v1'] } : [] }));
    const mounted = mount(); await tick();
    mounted.input('recipientName').value = 'Trusted wallet'; mounted.input('recipientAddress').value = 'So11111111111111111111111111111111111111112';
    mounted.node('review-recipient').fire('click');
    expect(mounted.node('review-address').textContent).toBe(mounted.input('recipientAddress').value);
    mounted.node('save-recipient').fire('click'); await tick();
    expect(transport.send.mock.calls.some(([request]) => request.method === 'POST')).toBe(false);
    expect(mounted.node('status').textContent).toContain('check the confirmation');
    mounted.input('recipientVerified').checked = true;
    mounted.input('recipientAddress').value = '11111111111111111111111111111111'; mounted.input('recipientAddress').fire('input');
    expect(mounted.input('recipientVerified').checked).toBe(false);
    expect(mounted.node('recipient-review').hidden).toBe(true);
    mounted.controller.destroy();
  });
});
