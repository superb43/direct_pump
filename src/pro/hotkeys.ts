import { browser, type Browser } from 'wxt/browser';
import type { PageContext, PageTarget } from '../model';
import { ADDRESS, detectPage, sameTarget, targetKey } from '../sites/catalog';

export type HotkeySession = { serverId: string; deviceId: string; wallet: string };
export type HotkeyBinding = { windowId: number; tabId: number; documentId: string; target: PageTarget; mint: string; session: HotkeySession; generation: number };
type HotkeyOptions = {
  enabled: () => boolean;
  mapping: () => { buyKeys: string[]; sellKeys: string[] };
  binding: () => Promise<HotkeyBinding | undefined>;
  onAction: (side: 'BUY' | 'SELL', slot: number, binding?: HotkeyBinding) => Promise<void>;
  onError?: (message: string) => void;
};
const PORT = 'pro-hotkeys';
const freshGesture = (issuedAt: number) => Number.isFinite(issuedAt) && Date.now() - issuedAt <= 2000 && issuedAt <= Date.now() + 100;
const parseCommand = (command: string) => /^pro-(buy|sell)-([1-8])$/.exec(command);
const sameSession = (a: HotkeySession, b: HotkeySession) => a.serverId === b.serverId && a.deviceId === b.deviceId && a.wallet === b.wallet;
const sameBinding = (a: HotkeyBinding, b: HotkeyBinding) => a.windowId === b.windowId && a.tabId === b.tabId && a.documentId === b.documentId && a.mint === b.mint && targetKey(a.target) === targetKey(b.target) && sameSession(a.session, b.session) && a.generation === b.generation;
function validBinding(value: unknown): value is HotkeyBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as HotkeyBinding;
  return Number.isInteger(b.windowId) && Number.isInteger(b.tabId) && typeof b.documentId === 'string' && !!b.documentId && Number.isInteger(b.generation) && !!b.target && sameTarget(b.target, detectPage(b.target.pageUrl)) && ADDRESS.test(b.mint) && !!b.session && ['serverId', 'deviceId', 'wallet'].every(key => typeof b.session[key as keyof HotkeySession] === 'string' && !!b.session[key as keyof HotkeySession]);
}
async function capture(api: typeof browser, target: PageTarget, mint: string, session: HotkeySession, documentId?: string): Promise<HotkeyBinding | undefined> {
  const focused = await api.windows.getLastFocused();
  if (!focused.focused || focused.id === undefined) return;
  const [tab] = await api.tabs.query({ active: true, windowId: focused.id });
  if (tab?.id === undefined || !sameTarget(target, detectPage(tab.url ?? ''))) return;
  const frames = await api.scripting.executeScript({ target: documentId ? { tabId: tab.id, documentIds: [documentId] } : { tabId: tab.id, frameIds: [0] }, func: () => ({ url: location.href }) });
  const frame = frames.find(item => item.frameId === 0);
  if (!frame?.documentId || !sameTarget(target, detectPage(frame.result?.url ?? ''))) return;
  const context = await api.tabs.sendMessage(tab.id, { type: 'PANEL_CONTEXT' }, { documentId: frame.documentId }) as PageContext;
  if (!context?.target || targetKey(context.target) !== targetKey(target)) return;
  const boundMint = context.target.mintHint ?? (context.target.kind === 'MINT' ? context.target.address : undefined);
  if (boundMint !== mint) return;
  // Recheck browser focus after asynchronous document/context reads.
  const latestWindow = await api.windows.getLastFocused();
  const [latestTab] = await api.tabs.query({ active: true, windowId: focused.id });
  if (!latestWindow.focused || latestWindow.id !== focused.id || latestTab?.id !== tab.id) return;
  return { windowId: focused.id, tabId: tab.id, documentId: frame.documentId, target: structuredClone(context.target), mint, session: { ...session }, generation: 0 };
}
export async function readProTradeBinding(target: PageTarget, mint: string, session: HotkeySession): Promise<HotkeyBinding | undefined> {
  return capture(browser, target, mint, session);
}
async function assertBinding(api: typeof browser, binding: HotkeyBinding): Promise<void> {
  if (!validBinding(binding)) throw new Error('The active token binding is unavailable.');
  const current = await capture(api, binding.target, binding.mint, binding.session, binding.documentId);
  if (!current || !sameBinding({ ...current, generation: binding.generation }, binding)) throw new Error('The active token page changed.');
}
export async function assertProTradeBinding(binding: HotkeyBinding): Promise<void> { await assertBinding(browser, binding); }
export async function readProHotkeyShortcuts() { return browser.commands.getAll(); }

/** Native ports can arm a binding, but only browser commands can emit an action. */
export function installProHotkeyBroker(api: typeof browser): void {
  const panels = new Map<Browser.runtime.Port, { binding?: HotkeyBinding; epoch: number }>();
  const lastCommand = new Map<string, number>();
  api.runtime.onConnect.addListener(port => {
    if (port.name !== PORT) return;
    if (port.sender?.id !== api.runtime.id || port.sender.tab || port.sender.url?.split(/[?#]/)[0] !== api.runtime.getURL('/sidepanel.html') || (port.sender.frameId !== undefined && port.sender.frameId !== 0)) { port.disconnect(); return; }
    const panel: { binding?: HotkeyBinding; epoch: number } = { epoch: 0 };
    panels.set(port, panel);
    port.onMessage.addListener(message => {
      panel.epoch++; panel.binding = undefined;
      if (message?.type === 'DISARM') return;
      if (message?.type !== 'ARM' || !validBinding(message.binding)) { port.disconnect(); return; }
      const binding = structuredClone(message.binding) as HotkeyBinding, epoch = panel.epoch;
      void assertBinding(api, binding).then(() => { if (panels.has(port) && panel.epoch === epoch) panel.binding = binding; }).catch(() => {});
    });
    port.onDisconnect.addListener(() => { panel.epoch++; panels.delete(port); });
  });
  api.commands.onCommand.addListener(command => {
    const action = parseCommand(command);
    if (!action) return;
    const now = Date.now(), previous = lastCommand.get(command);
    lastCommand.set(command, now);
    if (previous !== undefined && now - previous < 1000) return;
    const candidates = [...panels.entries()].filter(([, panel]) => panel.binding);
    void (async () => {
      const matching: { port: Browser.runtime.Port; panel: { binding?: HotkeyBinding; epoch: number }; binding: HotkeyBinding; epoch: number }[] = [];
      for (const [port, panel] of candidates) {
        const binding = panel.binding!, epoch = panel.epoch;
        try {
          await assertBinding(api, binding);
          const frames = await api.scripting.executeScript({ target: { tabId: binding.tabId, documentIds: [binding.documentId] }, func: () => { let el = document.activeElement; while (el) { if (el.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return true; el = el.shadowRoot?.activeElement ?? null; } return false; } });
          if (!frames.some(frame => frame.frameId === 0 && frame.documentId === binding.documentId && frame.result === false)) continue;
          if (panels.has(port) && panel.epoch === epoch && panel.binding === binding) matching.push({ port, panel, binding, epoch });
        } catch { /* An unavailable or changed page never dispatches a trade. */ }
      }
      // More than one native panel claiming the same active context is ambiguous.
      if (matching.length !== 1) return;
      const { port, panel, binding, epoch } = matching[0]!;
      if (!panels.has(port) || panel.epoch !== epoch || !freshGesture(now)) return;
      port.postMessage({ type: 'ACTION', command, binding, gestureId: crypto.randomUUID(), issuedAt: now });
    })().catch(() => {});
  });
}

export function mountProHotkeys(container: HTMLElement, options: HotkeyOptions) {
  let alive = true, space = false, busy = false, epoch = 0, armed: HotkeyBinding | undefined;
  const gestures = new Set<string>();
  const port = browser.runtime.connect({ name: PORT });
  const fail = (error: unknown) => options.onError?.(error instanceof Error ? error.message : 'Hotkey unavailable.');
  const isEditing = (element: EventTarget | null) => element instanceof Element && (!!element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  const editingFocus = () => {
    let element = container.ownerDocument.activeElement;
    while (element) {
      if (isEditing(element)) return true;
      element = element.shadowRoot?.activeElement ?? null;
    }
    return false;
  };
  const run = async (side: 'BUY' | 'SELL', slot: number, binding?: HotkeyBinding, issuedAt = Date.now()) => {
    if (!alive || busy || !options.enabled()) return;
    const sequence = epoch;
    const currentGesture = () => alive && sequence === epoch && freshGesture(issuedAt) && options.enabled() && (!binding || !!armed && sameBinding(armed, binding));
    busy = true;
    try {
      const current = await options.binding();
      if (!currentGesture() || !current || binding && !sameBinding({ ...current, generation: binding.generation }, binding)) return;
      await assertProTradeBinding(current);
      if (!currentGesture()) return;
      await options.onAction(side, slot, current);
    } catch (error) { fail(error); } finally { busy = false; }
  };
  const keydown = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.repeat || event.isComposing || (event.composedPath?.() ?? [event.target]).some(isEditing) || editingFocus() || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Space') { if (options.enabled()) { space = true; event.preventDefault(); } return; }
    if (!space || !options.enabled()) return;
    const mapping = options.mapping(), key = event.code.toLowerCase();
    const buy = mapping.buyKeys.findIndex(value => value.toLowerCase() === key), sell = mapping.sellKeys.findIndex(value => value.toLowerCase() === key);
    if (buy < 0 && sell < 0 || buy >= 0 && sell >= 0) return;
    event.preventDefault(); void run(buy >= 0 ? 'BUY' : 'SELL', buy >= 0 ? buy : sell);
  };
  const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') space = false; };
  const blur = () => { space = false; };
  const message = (value: { type?: string; command?: string; binding?: HotkeyBinding; gestureId?: string; issuedAt?: number }) => {
    if (value?.type !== 'ACTION' || !value.command || !value.gestureId || gestures.has(value.gestureId) || typeof value.issuedAt !== 'number' || !freshGesture(value.issuedAt) || !armed || !value.binding || !sameBinding(armed, value.binding) || editingFocus()) return;
    gestures.add(value.gestureId);
    if (gestures.size > 64) gestures.delete(gestures.values().next().value!);
    const action = parseCommand(value.command);
    if (action) void run(action[1] === 'buy' ? 'BUY' : 'SELL', Number(action[2]) - 1, value.binding, value.issuedAt);
  };
  port.onMessage.addListener(message);
  container.ownerDocument.addEventListener('keydown', keydown);
  container.ownerDocument.addEventListener('keyup', keyup);
  container.ownerDocument.defaultView?.addEventListener('blur', blur);
  const disconnect = () => { space = false; armed = undefined; epoch++; };
  port.onDisconnect.addListener(disconnect);
  return {
    async sync() {
      const sequence = ++epoch;
      space = false;
      armed = undefined;
      if (!alive) return;
      port.postMessage({ type: 'DISARM' });
      if (!options.enabled()) return;
      try {
        const binding = await options.binding();
        if (!alive || sequence !== epoch || !options.enabled() || !binding) return;
        armed = { ...binding, generation: sequence };
        port.postMessage({ type: 'ARM', binding: armed });
      } catch (error) { fail(error); }
    },
    destroy() {
      alive = false; epoch++; armed = undefined;
      container.ownerDocument.removeEventListener('keydown', keydown);
      container.ownerDocument.removeEventListener('keyup', keyup);
      container.ownerDocument.defaultView?.removeEventListener('blur', blur);
      port.onMessage.removeListener(message); port.onDisconnect.removeListener(disconnect); port.disconnect();
    },
  };
}
