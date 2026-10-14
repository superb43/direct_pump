import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageTarget } from '../../src/model';
const api = vi.hoisted(() => ({ runtime: { id: 'extension', getURL: (path: string) => `chrome-extension://extension${path}`, onConnect: { addListener: vi.fn() }, connect: vi.fn() }, commands: { onCommand: { addListener: vi.fn() } }, windows: { getLastFocused: vi.fn() }, tabs: { query: vi.fn(), sendMessage: vi.fn() }, scripting: { executeScript: vi.fn() } }));
vi.mock('wxt/browser', () => ({ browser: api }));
import { assertProTradeBinding, installProHotkeyBroker, mountProHotkeys, readProTradeBinding, type HotkeyBinding } from '../../src/pro/hotkeys';
const mint = 'So11111111111111111111111111111111111111112';
const session = { serverId: 'server', deviceId: 'device', wallet: mint };
const targets: PageTarget[] = [
  { site: 'GMGN', kind: 'MINT', address: mint, pageUrl: `https://gmgn.ai/sol/token/${mint}` },
  { site: 'AXIOM', kind: 'POOL', address: mint, mintHint: mint, pageUrl: `https://axiom.trade/meme/${mint}` },
  { site: 'FOMO', kind: 'MINT', address: mint, pageUrl: `https://fomo.family/tokens/solana/${mint}` },
];
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function context(target = targets[0]!) {
  api.windows.getLastFocused.mockResolvedValue({ id: 1, focused: true });
  api.tabs.query.mockResolvedValue([{ id: 2, url: target.pageUrl }]);
  api.tabs.sendMessage.mockResolvedValue({ target });
  api.scripting.executeScript.mockImplementation(async ({ func }: { func: Function }) => [{ frameId: 0, documentId: 'doc', result: func.toString().includes('activeElement') ? false : { url: target.pageUrl } }]);
}
function port(url = 'chrome-extension://extension/sidepanel.html', tab?: { id: number }) {
  let receive: (value: unknown) => void = () => {}, disconnect: () => void = () => {};
  const value = { name: 'pro-hotkeys', sender: { id: 'extension', url, tab }, onMessage: { addListener: (handler: typeof receive) => { receive = handler; } }, onDisconnect: { addListener: (handler: typeof disconnect) => { disconnect = handler; } }, disconnect: vi.fn(() => disconnect()), postMessage: vi.fn() };
  return { value, send: (message: unknown) => receive(message) };
}
const binding = (target = targets[0]!): HotkeyBinding => ({ windowId: 1, tabId: 2, documentId: 'doc', target, mint, session, generation: 1 });
beforeEach(() => { vi.clearAllMocks(); context(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Pro trade binding', () => {
  it.each(targets)('captures and revalidates $site identity', async target => {
    context(target);
    const captured = await readProTradeBinding(target, mint, session);
    expect(captured?.documentId).toBe('doc');
    await expect(assertProTradeBinding(captured!)).resolves.toBeUndefined();
  });
  it('rejects a changed document, mint hint, tab, or focused window', async () => {
    api.scripting.executeScript.mockResolvedValue([{ frameId: 0, documentId: 'new-doc', result: { url: targets[0]!.pageUrl } }]);
    await expect(assertProTradeBinding(binding())).rejects.toThrow();
    context(); api.tabs.sendMessage.mockResolvedValue({ target: { ...targets[0], mintHint: 'foreign' } });
    await expect(assertProTradeBinding(binding())).rejects.toThrow();
    context(); api.tabs.query.mockResolvedValue([{ id: 3, url: targets[0]!.pageUrl }]);
    await expect(assertProTradeBinding(binding())).rejects.toThrow();
    context(); api.windows.getLastFocused.mockResolvedValue({ id: 1, focused: false });
    expect(await readProTradeBinding(targets[0]!, mint, session)).toBeUndefined();
  });
});
describe('native hotkey broker', () => {
  function install() {
    installProHotkeyBroker(api as never);
    return { connect: api.runtime.onConnect.addListener.mock.calls[0]![0] as Function, command: api.commands.onCommand.addListener.mock.calls[0]![0] as Function };
  }
  it('rejects content and unrelated native ports', () => {
    const { connect } = install();
    for (const candidate of [port(targets[0]!.pageUrl, { id: 2 }), port('chrome-extension://extension/settings.html'), port('chrome-extension://extension/sidepanel.html', { id: 2 })]) {
      connect(candidate.value); expect(candidate.value.disconnect).toHaveBeenCalledOnce();
    }
  });
  it('only dispatches a browser gesture to one armed current panel', async () => {
    const { connect, command } = install(), panel = port();
    connect(panel.value); panel.send({ type: 'ARM', binding: binding() }); await settle();
    panel.send({ type: 'ACTION', command: 'pro-buy-1' }); await settle();
    expect(panel.value.postMessage).not.toHaveBeenCalled();
    // A malformed native message disconnects; arm a fresh panel.
    const live = port(); connect(live.value); live.send({ type: 'ARM', binding: binding() }); await settle();
    command('pro-buy-1'); await settle();
    expect(live.value.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACTION', command: 'pro-buy-1', binding: binding() }));
    command('pro-buy-1'); await settle(); expect(live.value.postMessage).toHaveBeenCalledOnce();
    live.send({ type: 'DISARM' }); command('pro-sell-1'); await settle(); expect(live.value.postMessage).toHaveBeenCalledOnce();
  });
  it('ignores editing pages and disconnected or ambiguous panels', async () => {
    const { connect, command } = install(), a = port(), b = port();
    connect(a.value); a.send({ type: 'ARM', binding: binding() }); await settle();
    api.scripting.executeScript.mockImplementation(async ({ func }: { func: Function }) => [{ frameId: 0, documentId: 'doc', result: func.toString().includes('activeElement') ? true : { url: targets[0]!.pageUrl } }]);
    command('pro-buy-1'); await settle(); expect(a.value.postMessage).not.toHaveBeenCalled();
    context(); connect(b.value); b.send({ type: 'ARM', binding: binding() }); await settle();
    command('pro-sell-1'); await settle(); expect(a.value.postMessage).not.toHaveBeenCalled(); expect(b.value.postMessage).not.toHaveBeenCalled();
    a.value.disconnect(); b.value.disconnect(); command('pro-buy-2'); await settle(); expect(b.value.postMessage).not.toHaveBeenCalled();
  });
  it('probes editing focus through site shadow roots before browser dispatch', async () => {
    const { connect, command } = install(), panel = port();
    connect(panel.value); panel.send({ type: 'ARM', binding: binding() }); await settle();
    const input = { closest: () => ({}) }, host = { closest: () => null, shadowRoot: { activeElement: input } };
    vi.stubGlobal('document', { activeElement: host });
    api.scripting.executeScript.mockImplementation(async ({ func }: { func: Function }) => [{ frameId: 0, documentId: 'doc', result: func.toString().includes('activeElement') ? func() : { url: targets[0]!.pageUrl } }]);
    command('pro-buy-1'); await settle(); expect(panel.value.postMessage).not.toHaveBeenCalled();
  });
  it('drops broker validation that completes after the original gesture deadline', async () => {
    const { connect, command } = install(), panel = port();
    connect(panel.value); panel.send({ type: 'ARM', binding: binding() }); await settle();
    let now = 10_000, release!: (value: unknown) => void;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    api.tabs.sendMessage.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    command('pro-buy-1'); await settle(); now += 2001; release({ target: targets[0] }); await settle();
    expect(panel.value.postMessage).not.toHaveBeenCalled();
  });
  it('preserves the original command timestamp after successful asynchronous validation', async () => {
    const { connect, command } = install(), panel = port();
    connect(panel.value); panel.send({ type: 'ARM', binding: binding() }); await settle();
    let now = 10_000, release!: (value: unknown) => void;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    api.tabs.sendMessage.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    command('pro-buy-1'); await settle(); now += 1500; release({ target: targets[0] }); await settle();
    expect(panel.value.postMessage).toHaveBeenCalledWith(expect.objectContaining({ issuedAt: 10_000 }));
  });
  it('does not arm a late async reply after disarm', async () => {
    const { connect, command } = install(), panel = port();
    let release!: (value: unknown) => void;
    api.tabs.sendMessage.mockReturnValue(new Promise(resolve => { release = resolve; }));
    connect(panel.value); panel.send({ type: 'ARM', binding: binding() }); await settle(); panel.send({ type: 'DISARM' });
    release({ target: targets[0] }); await settle(); command('pro-buy-1'); await settle();
    expect(panel.value.postMessage).not.toHaveBeenCalled();
  });
});

describe('native hotkey receiver', () => {
  function mount(overrides: { enabled?: () => boolean; binding?: () => Promise<HotkeyBinding | undefined> } = {}) {
    vi.stubGlobal('Element', class Element { constructor(readonly editing = false, readonly shadowRoot?: { activeElement: Element | null }) {} closest() { return this.editing ? this : null; } });
    let receive: (value: unknown) => void = () => {};
    const nativePort = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: (listener: typeof receive) => { receive = listener; }, removeListener: vi.fn() }, onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() } };
    api.runtime.connect.mockReturnValue(nativePort);
    const doc = { activeElement: null as Element | null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: { addEventListener: vi.fn(), removeEventListener: vi.fn() } };
    const onAction = vi.fn(async () => {});
    const controller = mountProHotkeys({ ownerDocument: doc } as unknown as HTMLElement, { enabled: () => true, mapping: () => ({ buyKeys: ['Digit1'], sellKeys: ['KeyQ'] }), binding: async () => binding(), onAction, ...overrides });
    return { controller, onAction, doc, nativePort, receive: (message: unknown) => receive(message) };
  }
  it('rejects old gestures and replays, removes handlers on teardown', async () => {
    const panel = mount(); await panel.controller.sync();
    const armed = panel.nativePort.postMessage.mock.calls.find(([message]) => message.type === 'ARM')![0].binding;
    const action = { type: 'ACTION', command: 'pro-buy-1', binding: armed, gestureId: 'gesture', issuedAt: Date.now() };
    panel.receive({ ...action, issuedAt: Date.now() - 3000 }); await settle(); expect(panel.onAction).not.toHaveBeenCalled();
    panel.receive(action); await settle(); expect(panel.onAction).toHaveBeenCalledOnce();
    panel.receive(action); await settle(); expect(panel.onAction).toHaveBeenCalledOnce();
    panel.controller.destroy(); panel.receive({ ...action, gestureId: 'after-close' }); await settle();
    expect(panel.onAction).toHaveBeenCalledOnce(); expect(panel.doc.removeEventListener).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
  it.each(['browser', 'local'] as const)('cancels pending %s gestures after OFF and ON on the same page', async source => {
    let enabled = true, defer = false, release!: (value: HotkeyBinding) => void;
    const panel = mount({ enabled: () => enabled, binding: () => defer ? new Promise(resolve => { release = resolve; }) : Promise.resolve(binding()) });
    await panel.controller.sync();
    const armed = panel.nativePort.postMessage.mock.calls.find(([message]) => message.type === 'ARM')![0].binding;
    const handler = panel.doc.addEventListener.mock.calls.find(([name]) => name === 'keydown')![1] as Function;
    const key = { isTrusted: true, repeat: false, isComposing: false, target: null, code: 'Space', preventDefault: vi.fn() };
    defer = true;
    if (source === 'browser') panel.receive({ type: 'ACTION', command: 'pro-buy-1', binding: armed, gestureId: 'old-gesture', issuedAt: Date.now() });
    else { handler(key); handler({ ...key, code: 'Digit1' }); }
    const releaseOld = release;
    enabled = false; await panel.controller.sync();
    defer = false; enabled = true; await panel.controller.sync();
    releaseOld(binding()); await settle();
    expect(panel.onAction).not.toHaveBeenCalled();
    // The previous Space chord must also be cleared on sync.
    handler({ ...key, code: 'Digit1' }); await settle();
    expect(panel.onAction).not.toHaveBeenCalled();
    panel.controller.destroy(); vi.unstubAllGlobals();
  });
  it('cancels a gesture when lifecycle changes during document validation', async () => {
    const panel = mount(); await panel.controller.sync();
    const armed = panel.nativePort.postMessage.mock.calls.find(([message]) => message.type === 'ARM')![0].binding;
    let release!: (value: unknown) => void;
    api.tabs.sendMessage.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    panel.receive({ type: 'ACTION', command: 'pro-buy-1', binding: armed, gestureId: 'during-validation', issuedAt: Date.now() });
    await settle(); await panel.controller.sync(); release({ target: targets[0] }); await settle();
    expect(panel.onAction).not.toHaveBeenCalled();
    panel.controller.destroy(); vi.unstubAllGlobals();
  });
  it.each(['binding', 'assertion'] as const)('expires a fresh received command during delayed %s', async phase => {
    let defer = false, releaseBinding!: (value: HotkeyBinding) => void;
    const panel = mount({ binding: () => defer ? new Promise(resolve => { releaseBinding = resolve; }) : Promise.resolve(binding()) });
    await panel.controller.sync();
    const armed = panel.nativePort.postMessage.mock.calls.find(([message]) => message.type === 'ARM')![0].binding;
    let now = 10_000, releaseAssertion!: (value: unknown) => void;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    if (phase === 'binding') defer = true;
    else api.tabs.sendMessage.mockReturnValueOnce(new Promise(resolve => { releaseAssertion = resolve; }));
    panel.receive({ type: 'ACTION', command: 'pro-buy-1', binding: armed, gestureId: 'expires-while-awaiting', issuedAt: now });
    await settle(); now += 2001;
    if (phase === 'binding') releaseBinding(binding()); else releaseAssertion({ target: targets[0] });
    await settle(); expect(panel.onAction).not.toHaveBeenCalled(); panel.controller.destroy();
  });
  it('blocks retargeted editing inputs from a shadow DOM composed path', async () => {
    const panel = mount();
    const handler = panel.doc.addEventListener.mock.calls.find(([name]) => name === 'keydown')![1] as Function;
    const TestElement = Element as unknown as new (editing?: boolean, shadowRoot?: { activeElement: Element | null }) => Element;
    const input = new TestElement(true), host = new TestElement();
    const key = { isTrusted: true, repeat: false, isComposing: false, target: host, code: 'Space', preventDefault: vi.fn(), composedPath: () => [input, host] };
    handler(key); handler({ ...key, code: 'Digit1' }); await settle();
    expect(panel.onAction).not.toHaveBeenCalled();
    panel.controller.destroy();
  });
  it('blocks browser commands and local keys when deep shadow focus is editing', async () => {
    const panel = mount(); await panel.controller.sync();
    const armed = panel.nativePort.postMessage.mock.calls.find(([message]) => message.type === 'ARM')![0].binding;
    const TestElement = Element as unknown as new (editing?: boolean, shadowRoot?: { activeElement: Element | null }) => Element;
    const input = new TestElement(true), inner = new TestElement(false, { activeElement: input }), host = new TestElement(false, { activeElement: inner });
    panel.doc.activeElement = host;
    panel.receive({ type: 'ACTION', command: 'pro-buy-1', binding: armed, gestureId: 'editing-shadow', issuedAt: Date.now() });
    const handler = panel.doc.addEventListener.mock.calls.find(([name]) => name === 'keydown')![1] as Function;
    const key = { isTrusted: true, repeat: false, isComposing: false, target: host, code: 'Space', preventDefault: vi.fn(), composedPath: () => [host] };
    handler(key); handler({ ...key, code: 'Digit1' }); await settle();
    expect(panel.onAction).not.toHaveBeenCalled(); panel.controller.destroy();
  });
  it('uses physical key codes and ignores untrusted, repeat, composing and modified events', async () => {
    const panel = mount();
    const handler = panel.doc.addEventListener.mock.calls.find(([name]) => name === 'keydown')![1] as Function;
    const key = { isTrusted: true, repeat: false, isComposing: false, target: null, code: 'Space', key: ' ', preventDefault: vi.fn() };
    handler(key);
    for (const extra of [{ isTrusted: false }, { repeat: true }, { isComposing: true }, { ctrlKey: true }]) handler({ ...key, code: 'Digit1', key: '1', ...extra });
    await settle(); expect(panel.onAction).not.toHaveBeenCalled();
    handler({ ...key, code: 'Digit1', key: '!' }); await settle();
    expect(panel.onAction).toHaveBeenCalledWith('BUY', 0, expect.objectContaining({ documentId: 'doc' }));
    panel.controller.destroy(); vi.unstubAllGlobals();
  });
});
