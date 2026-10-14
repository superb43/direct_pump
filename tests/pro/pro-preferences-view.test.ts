import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTradingPreferences } from '../../src/pro/preferences-view';
import { defaultPreferences } from '../../src/pro/trading-preferences';

// Lifetime/control adapter; browser-rendered QA covers the actual settings layout.
class Element {
  value = ''; checked = false; textContent = ''; innerHTML = ''; disabled = false;
  nodes = new Map<string, Element>(); children: Element[] = [];
  events = new Map<string, () => void>();
  querySelector(selector: string): Element { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector)!; }
  querySelectorAll() { return [...this.nodes.values()]; }
  replaceChildren(...children: Element[]) { this.children = children; }
  addEventListener(event: string, listener: () => void, options: { signal: AbortSignal }) {
    this.events.set(event, listener); options.signal.addEventListener('abort', () => this.events.delete(event), { once: true });
  }
  fire(event: string) { this.events.get(event)?.(); }
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function mount(overrides = {}) {
  const container = new Element(), changed = vi.fn(), save = vi.fn(async value => value);
  const controller = mountTradingPreferences(container as unknown as HTMLElement, { load: async () => defaultPreferences(), save, changed, ...overrides });
  const root = container.querySelector('.pro-trading-preferences');
  return { controller, changed, save, root, input: (name: string) => root.querySelector(`[name="${name}"]`), node: (name: string) => root.querySelector(`[data-pref="${name}"]`) };
}
beforeEach(() => vi.stubGlobal('document', { createElement: () => new Element() }));
afterEach(() => vi.unstubAllGlobals());

describe('Pro preference settings', () => {
  it('loads without writing and applies profile/confirmation changes only after save', async () => {
    const view = mount(); await tick();
    expect(view.save).not.toHaveBeenCalled(); expect(view.input('profileName').value).toBe('Default');
    view.input('profileName').value = 'Fast'; view.input('confirmMarket').checked = true;
    view.node('save').fire('click'); await tick();
    expect(view.save).toHaveBeenCalledOnce(); expect(view.changed).toHaveBeenCalledOnce();
    expect(view.changed.mock.calls[0]![0].confirmMarket).toBe(true);
    expect(view.changed.mock.calls[0]![0].profiles[0].name).toBe('Fast'); view.controller.destroy();
  });
  it('adds, duplicates and deletes draft profiles with a protected last profile', async () => {
    const view = mount(); await tick();
    view.node('add').fire('click'); expect(view.input('profileName').value).toBe('Profile 2');
    view.node('clone').fire('click'); expect(view.input('profileName').value).toBe('Profile 2 copy');
    view.node('delete').fire('click'); view.node('delete').fire('click');
    expect(view.node('delete').disabled).toBe(true); expect(view.save).not.toHaveBeenCalled();
    view.node('save').fire('click'); await tick(); expect(view.changed.mock.calls[0]![0].profiles).toHaveLength(1); view.controller.destroy();
  });
  it('blocks invalid duplicate keys and server limit violations before saving', async () => {
    const view = mount({ limits: () => ({ maxBuyLamports: '500000000', maxNetworkLamports: '5000000', dailyBuyLamports: '1' }) }); await tick();
    view.input('sellKey0').value = '1'; view.node('save').fire('click');
    expect(view.node('status').textContent).toContain('unique'); expect(view.save).not.toHaveBeenCalled();
    view.input('sellKey0').value = 'Q'; view.input('buyPresets').value = '1'; view.node('save').fire('click');
    expect(view.node('status').textContent).toContain('server buy limit'); expect(view.save).not.toHaveBeenCalled(); view.controller.destroy();
  });
  it('keeps load failures explicit and save failures unapplied', async () => {
    const failed = mount({ load: async () => { throw new Error('Corrupt settings'); } }); await tick();
    expect(failed.node('status').textContent).toContain('Corrupt settings'); expect(failed.node('save').disabled).toBe(true); failed.controller.destroy();
    const view = mount({ save: async () => { throw new Error('Disk failure'); } }); await tick();
    view.node('save').fire('click'); await tick(); expect(view.node('status').textContent).toContain('were not saved'); expect(view.changed).not.toHaveBeenCalled(); view.controller.destroy();
  });
  it.each([false, true])('settles storage updates before a pending save reply (different value: %s)', async different => {
    const pending = deferred<ReturnType<typeof defaultPreferences>>(), view = mount({ save: () => pending.promise }); await tick();
    view.input('profileName').value = 'Saved'; view.node('save').fire('click');
    expect(view.node('status').textContent).toBe('Saving trading preferences…'); expect(view.node('save').disabled).toBe(true);
    const saved = defaultPreferences(); saved.profiles[0]!.name = 'Saved';
    const stored = structuredClone(saved); if (different) stored.profiles[0]!.name = 'Other view';
    view.controller.update(stored);
    expect(view.node('status').textContent).toBe('Trading preferences updated.'); expect(view.node('save').disabled).toBe(false);
    pending.resolve(saved); await tick();
    expect(view.input('profileName').value).toBe(stored.profiles[0]!.name); expect(view.node('status').textContent).toBe('Trading preferences updated.');
    expect(view.changed).not.toHaveBeenCalled(); view.controller.destroy();
  });
  it('drops late save completion and listeners after teardown', async () => {
    const pending = deferred<ReturnType<typeof defaultPreferences>>(), view = mount({ save: () => pending.promise }); await tick();
    view.node('save').fire('click'); view.controller.destroy(); pending.resolve(defaultPreferences()); await tick();
    expect(view.changed).not.toHaveBeenCalled(); expect(view.node('save').events.size).toBe(0);
  });
  it('discards stale load when externally updated and sends preview saves to setup', async () => {
    const pending = deferred<ReturnType<typeof defaultPreferences>>(), setup = vi.fn(), view = mount({ load: () => pending.promise, preview: true, onSetup: setup });
    const newer = defaultPreferences(); newer.profiles[0]!.name = 'New'; view.controller.update(newer); pending.resolve(defaultPreferences()); await tick();
    expect(view.input('profileName').value).toBe('New'); view.node('save').fire('click'); expect(setup).toHaveBeenCalledOnce(); expect(view.save).not.toHaveBeenCalled(); view.controller.destroy();
  });
});
