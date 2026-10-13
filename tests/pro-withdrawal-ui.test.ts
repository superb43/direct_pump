import { afterEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ request: vi.fn(), remove: vi.fn(), read: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: {
  get: async (key: string) => { transport.read(key); return key === pendingKey && pendingRead ? pendingRead : { [key]: key === pendingKey ? persisted : undefined }; },
  set: async (value: Record<string, unknown>) => { persisted = Object.values(value)[0]; },
  remove: async (key: string) => { transport.remove(key); persisted = undefined; },
} } } }));
vi.mock('../src/pro/settings-view', () => ({ sendPro: (request: { method: string; path: string; body?: unknown }) => transport.request(request) }));
import { mountWithdrawalView, WithdrawalReview, reviewedWithdrawal, restorePendingWithdrawal, findReviewedWithdrawal } from '../src/pro/withdrawal-view';
import { validateProData } from '../src/pro/client';
import { allowedProRequest } from '../src/pro/worker';
import type { WithdrawalSpec, WithdrawalPreview } from '../src/pro/withdrawals';
const id = '123e4567-e89b-42d3-a456-426614174000';
const address = 'So11111111111111111111111111111111111111112';
function spec(): WithdrawalSpec { return { requestId: id, recipientId: id, recipientVersion: 1, address, mint: address, decimals: 9, amountRaw: '10000', maxNetworkLamports: '5000000' }; }
function preview(): WithdrawalPreview { return { id, spec: spec(), expiresAt: Date.now() + 30000, totalRaw: '100000', reservedRaw: '1000', availableRaw: '99000', maxRaw: '94000', feeLamports: '5000', rentLamports: '0' }; }
describe('Withdrawal exact review', () => {
  it('rejects server substitution of any authorized withdrawal field', () => {
    for (const [key, value] of Object.entries({ address: '11111111111111111111111111111111', amountRaw: '999', recipientVersion: 2, mint: '11111111111111111111111111111111', maxNetworkLamports: '6000000', requestId: '123e4567-e89b-42d3-a456-426614174001' })) {
      expect(() => reviewedWithdrawal(spec(), { ...preview(), spec: { ...spec(), [key]: value } })).toThrow('changed');
    }
  });
  it('requires a new review after form mutation including during the request', () => {
    const guard = new WithdrawalReview(), version = guard.version();
    guard.accept(spec(), preview(), version);
    expect(guard.current(spec()).spec).toEqual(spec());
    guard.invalidate(); expect(() => guard.current(spec())).toThrow('Preview');
    expect(() => guard.accept(spec(), preview(), version)).toThrow('Form changed');
  });
  it('restores an expired pending review for status recovery and detects ID conflicts', () => {
    const persisted = { ...preview(), expiresAt: 1 };
    const restored = restorePendingWithdrawal(JSON.parse(JSON.stringify(persisted)));
    persisted.spec.amountRaw = '20000';
    expect(restored.spec.amountRaw).toBe('10000');
    expect(() => reviewedWithdrawal(restored.spec, restored)).toThrow('expired');
    const known = { id, spec: restored.spec, state: 'UNKNOWN' as const, createdAt: 1, updatedAt: 2 };
    expect(findReviewedWithdrawal(restored, [known])).toBe(known);
    expect(findReviewedWithdrawal(restored, [])).toBeUndefined();
    expect(() => findReviewedWithdrawal(restored, [{ ...known, spec: { ...known.spec, amountRaw: '99999' } }])).toThrow('match');
    expect(() => restorePendingWithdrawal({ spec: {} })).toThrow();
  });
  it('freezes server data and rejects expired or oversized transfers', () => {
    const guard = new WithdrawalReview(), response = preview(); guard.accept(spec(), response, guard.version());
    response.spec.address = '11111111111111111111111111111111';
    expect(guard.current(spec()).spec.address).toBe(address);
    expect(() => reviewedWithdrawal(spec(), { ...preview(), expiresAt: 0 })).toThrow();
    expect(() => reviewedWithdrawal(spec(), { ...preview(), maxRaw: '9999' })).toThrow();
  });
});
describe('Withdrawal private request boundary', () => {
  it('allows only exact implemented routes and never editing recipient addresses', () => {
    for (const [method, path] of [['GET','/v1/recipients'],['POST','/v1/recipients'],['POST',`/v1/recipients/${id}/deactivate`],['GET','/v1/withdrawals'],['GET',`/v1/withdrawals/${id}`],['POST','/v1/withdrawals'],['POST','/v1/withdrawals/preview']]) expect(allowedProRequest(method!,path!)).toBe(true);
    for (const [method, path] of [['PATCH',`/v1/recipients/${id}`],['POST','/v1/withdrawals/sign'],['POST',`/v1/recipients/${id}/deactivate?x=1`],['GET','/v1/withdrawals/../sign']]) expect(allowedProRequest(method!,path!)).toBe(false);
  });
  it('rejects malformed recipients, preview balances, and mismatched history IDs', () => {
    const recipient = { id, version: 1, name: 'Phantom', address, active: true, createdAt: 1 };
    expect(() => validateProData('/v1/recipients', [recipient])).not.toThrow();
    for (const patch of [{ version: 0 }, { address: 'javascript:bad' }, { active: 'true' }]) expect(() => validateProData('/v1/recipients', [{ ...recipient, ...patch }])).toThrow();
    expect(() => validateProData('/v1/withdrawals/preview', preview())).not.toThrow();
    expect(() => validateProData('/v1/withdrawals/preview', { ...preview(), maxRaw: '-1' })).toThrow();
    expect(() => validateProData('/v1/withdrawals', [{ id: '123e4567-e89b-42d3-a456-426614174001', spec: spec(), state: 'UNKNOWN', createdAt: 1, updatedAt: 2 }])).toThrow('identity');
  });
});

// Small DOM adapter tests view transitions and request identity; browser QA owns geometry.
class WithdrawalElement {
  hidden = false; disabled = false; value = ''; className = ''; innerHTML = '';
  children: WithdrawalElement[] = []; nodes = new Map<string, WithdrawalElement>();
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  events = new Map<string, (event: { preventDefault(): void }) => void>();
  classList = { add: vi.fn() };
  private text = '';
  constructor(readonly tagName = 'div') {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join('\n'); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get childElementCount() { return this.children.length; }
  get options() { return this.children; }
  elements = { namedItem: (name: string) => this.querySelector(name) };
  append(...children: WithdrawalElement[]) {
    this.children.push(...children);
    if (this.tagName === 'select' && !this.value) this.value = children[0]?.value ?? '';
  }
  replaceChildren(...children: WithdrawalElement[]) { this.text = ''; this.children = []; this.append(...children); }
  querySelector(selector: string): WithdrawalElement {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new WithdrawalElement(['asset', 'recipient'].includes(selector) ? 'select' : selector));
    return this.nodes.get(selector)!;
  }
  querySelectorAll() { return [...this.nodes.values()]; }
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) { this.events.set(name, callback); }
  fire(name: string) { this.events.get(name)!({ preventDefault() {} }); }
}
const health: import('../src/pro/contracts').ProHealth = {
  apiVersion: 1, serverId: 'server', wallet: address, signer: 'READY', engine: 'RUNNING',
  capabilities: ['withdrawals-v1'], at: 1,
  limits: { maxBuyLamports: '1000000000', dailyBuyLamports: '1000000000', maxNetworkLamports: '5000000' },
};
const pendingKey = 'proWithdrawalPending:server:device';
let balanceRaw = '100000', persisted: unknown, lostReply = false;
let pendingRead: Promise<Record<string, unknown>> | undefined;
let historyRows: import('../src/pro/withdrawals').Withdrawal[] = [];
async function mountedWithdrawal(container = new WithdrawalElement(), visible = true) {
  transport.request.mockImplementation(async (request: { method: string; path: string; body?: unknown }) => {
    if (request.path === '/v1/recipients') return [{ id, version: 1, name: 'Phantom', address, active: true, createdAt: 1 }];
    if (request.path.startsWith('/v1/wallet')) return [{ mint: address, decimals: 9, totalRaw: balanceRaw, reservedRaw: '1000', availableRaw: '99000' }];
    if (request.path === '/v1/withdrawals/preview') return { ...preview(), spec: request.body };
    if (request.path === '/v1/withdrawals' && request.method === 'GET') return historyRows;
    if (request.path === '/v1/withdrawals' && request.method === 'POST') {
      if (lostReply) throw new Error('Acknowledgement lost');
      const approved = (request.body as { spec: WithdrawalSpec }).spec;
      return { id: approved.requestId, spec: approved, state: 'UNKNOWN', createdAt: 1, updatedAt: 2 };
    }
    throw new Error('Unexpected route');
  });
  const pending = vi.fn();
  vi.stubGlobal('document', { createElement: (tag: string) => new WithdrawalElement(tag) });
  const view = mountWithdrawalView(container as unknown as HTMLElement, undefined, pending);
  await view.refresh(health, true, 'device', visible);
  const form = container.querySelector('form');
  form.elements.namedItem('amount').value = '0.00001';
  return { view, container, form, pending, node: (key: string) => container.querySelector(`[data-${key}]`) };
}
async function settleWithdrawal() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
afterEach(() => { vi.unstubAllGlobals(); persisted = undefined; pendingRead = undefined; transport.read.mockClear(); lostReply = false; balanceRaw = '100000'; historyRows = []; transport.request.mockClear(); transport.remove.mockClear(); });
describe('Withdrawal mounted review and recovery', () => {
  it('selects the fee-adjusted Max for a 0.001 SOL wallet without submitting a withdrawal', async () => {
    const { form, node } = await mountedWithdrawal();
    transport.request.mockImplementationOnce(async request => ({ ...preview(), spec: request.body, totalRaw: '1000000', reservedRaw: '0', availableRaw: '1000000', maxRaw: '995000' }));
    node('max').fire('click'); await settleWithdrawal();
    expect(form.elements.namedItem('amount').value).toBe('0.000995000');
    expect(node('status').textContent).toContain('Review before confirming');
    expect(node('review').hidden).toBe(true);
    expect(transport.request.mock.calls.some(([request]) => request.method === 'POST' && request.path === '/v1/withdrawals')).toBe(false);
  });
  it('explains a zero Max without reporting an expired review or allowing confirmation', async () => {
    const { form, node } = await mountedWithdrawal();
    transport.request.mockImplementationOnce(async request => ({ ...preview(), spec: request.body, availableRaw: '5000', maxRaw: '0' }));
    node('max').fire('click'); await settleWithdrawal();
    expect(node('status').textContent).toContain('No amount is available');
    expect(node('status').textContent).not.toContain('expired');
    expect(form.elements.namedItem('amount').value).toBe('0.00001');
    expect(node('confirm').hidden).toBe(true);
  });
  it('rejects substituted Max discovery before changing the amount', async () => {
    const { form, node } = await mountedWithdrawal();
    transport.request.mockImplementationOnce(async request => ({ ...preview(), spec: { ...request.body, address: '11111111111111111111111111111111' } }));
    node('max').fire('click'); await settleWithdrawal();
    expect(node('status').textContent).toContain('changed');
    expect(form.elements.namedItem('amount').value).toBe('0.00001');
  });
  it('replaces the form with semantic complete review rows and returns to its preserved draft without sending', async () => {
    const { form, node } = await mountedWithdrawal();
    form.fire('submit'); await settleWithdrawal();
    expect(form.hidden).toBe(true); expect(node('review').hidden).toBe(false);
    expect(node('review').children[1]!.tagName).toBe('dl');
    for (const text of ['Phantom', address, 'Amount', '0.000010000', '0.000005000', 'Account rent', '0.000000000', 'Maximum network budget', '0.005000000', 'Review expires']) expect(node('review').textContent).toContain(text);
    const currencyRows = node('review').children[1]!.children.filter(row => ['Asset', 'Amount', 'Estimated fee', 'Account rent', 'Maximum network budget'].includes(row.children[0]!.textContent));
    expect(currencyRows).toHaveLength(5);
    for (const row of currencyRows) {
      const value = row.children[1]!;
      expect(value.children[0]!.innerHTML).toContain('class="sol-icon"');
      expect(value.children[0]!.innerHTML).toContain('alt="SOL"');
      expect(value.attributes.get('aria-label')).toMatch(/SOL$/);
      expect(value.textContent).not.toContain('SOL');
    }
    expect(form.elements.namedItem('asset').children[0]!.textContent).toBe('Solana');
    expect(node('asset-icon').hidden).toBe(false);
    expect(node('back').hidden).toBe(false);
    node('back').fire('click');
    expect(form.hidden).toBe(false); expect(form.elements.namedItem('amount').value).toBe('0.00001');
    expect(node('review').hidden).toBe(true); expect(node('confirm').hidden).toBe(true);
    node('confirm').fire('click'); await settleWithdrawal();
    expect(node('status').textContent).toContain('Preview the withdrawal first');
    expect(transport.request.mock.calls.some(([request]) => request.method === 'POST' && request.path === '/v1/withdrawals')).toBe(false);
  });
  it('preserves the complete unsent review and draft on an unchanged same-session refresh', async () => {
    const { view, form, node, pending } = await mountedWithdrawal();
    form.fire('submit'); await settleWithdrawal();
    const displayedReview = node('review').textContent;
    const draft = ['recipient', 'asset', 'amount'].map(name => form.elements.namedItem(name).value);
    const postsBeforeRefresh = transport.request.mock.calls.filter(([request]) => request.method === 'POST');
    await view.refresh(health, true, 'device');
    expect(form.hidden).toBe(true); expect(node('review').hidden).toBe(false);
    expect(node('review').textContent).toBe(displayedReview);
    expect(node('actions').hidden).toBe(false); expect(node('back').hidden).toBe(false);
    expect(node('confirm').hidden).toBe(false); expect(node('confirm').disabled).toBe(false);
    expect(['recipient', 'asset', 'amount'].map(name => form.elements.namedItem(name).value)).toEqual(draft);
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(transport.request.mock.calls.filter(([request]) => request.method === 'POST')).toEqual(postsBeforeRefresh);
    expect(transport.remove).not.toHaveBeenCalled();
    expect(persisted).toBeUndefined();
    view.destroy();
  });
  it('invalidates unsent review after balance and pairing changes, and respects capability controls', async () => {
    const { view, form, node, container } = await mountedWithdrawal();
    form.fire('submit'); await settleWithdrawal();
    balanceRaw = '90000'; await view.refresh(health, true, 'device');
    expect(form.hidden).toBe(false); expect(node('review').hidden).toBe(true);
    form.fire('submit'); await settleWithdrawal();
    await view.refresh(health, true, 'other-device');
    expect(node('confirm').hidden).toBe(true); expect(form.hidden).toBe(false);
    await view.refresh({ ...health, signer: 'LOCKED' }, true, 'other-device');
    expect(node('confirm').disabled).toBe(true); expect(form.elements.namedItem('amount').disabled).toBe(true);
    await view.refresh({ ...health, capabilities: [] }, true, 'other-device'); expect(container.hidden).toBe(true);
  });
  it('keeps an unconfirmed request durable and retries exactly the saved intent after remount', async () => {
    lostReply = true;
    const first = await mountedWithdrawal(); first.form.fire('submit'); await settleWithdrawal();
    first.node('confirm').fire('click'); await settleWithdrawal();
    const saved = structuredClone(persisted) as WithdrawalPreview;
    expect(saved.spec.amountRaw).toBe('10000'); expect(first.pending).toHaveBeenLastCalledWith(true);
    expect(first.node('back').hidden).toBe(true); first.node('back').fire('click');
    expect(first.form.hidden).toBe(true); expect(persisted).toEqual(saved); expect(transport.remove).not.toHaveBeenCalled();
    first.view.destroy();
    const recovered = await mountedWithdrawal();
    expect(recovered.form.hidden).toBe(true); expect(recovered.node('review').textContent).toContain(saved.spec.requestId);
    expect(recovered.node('review').textContent).toContain('Review expires'); expect(recovered.pending).toHaveBeenLastCalledWith(true);
    lostReply = false; recovered.node('confirm').fire('click'); await settleWithdrawal();
    const submissions = transport.request.mock.calls.filter(([request]) => request.method === 'POST' && request.path === '/v1/withdrawals');
    expect(submissions.map(([request]) => request.body)).toEqual([1, 2].map(() => ({ previewId: saved.id, spec: saved.spec })));
    expect(transport.remove).toHaveBeenCalledWith(pendingKey); expect(recovered.pending).toHaveBeenLastCalledWith(true);
    expect(recovered.form.hidden).toBe(false);
  });
  it('ignores a delayed confirmation after destroy and remount without dropping the old durable evidence', async () => {
    const first = await mountedWithdrawal(); first.form.fire('submit'); await settleWithdrawal();
    const normal = transport.request.getMockImplementation()!;
    let finish!: (value: import('../src/pro/withdrawals').Withdrawal) => void;
    transport.request.mockImplementation(request => request.method === 'POST' && request.path === '/v1/withdrawals'
      ? new Promise(resolve => { finish = resolve; }) : normal(request));
    first.node('confirm').fire('click'); await settleWithdrawal();
    const saved = structuredClone(persisted) as WithdrawalPreview;
    first.view.destroy(); const previousCallbacks = first.pending.mock.calls.length;
    const remounted = await mountedWithdrawal(first.container);
    remounted.node('status').textContent = 'Remounted owner status';
    const newCallbacks = remounted.pending.mock.calls.length;
    finish({ id: saved.spec.requestId, spec: saved.spec, state: 'FINALIZED', createdAt: 1, updatedAt: 2 });
    await settleWithdrawal();
    expect(first.pending.mock.calls).toHaveLength(previousCallbacks);
    expect(remounted.pending.mock.calls).toHaveLength(newCallbacks);
    expect(remounted.node('status').textContent).toBe('Remounted owner status');
    expect(remounted.form.hidden).toBe(true); expect(persisted).toEqual(saved);
    expect(transport.remove).not.toHaveBeenCalled();
    remounted.view.destroy();
  });
  it('rejects an old-session acknowledgement without changing the new owner or removing its original pending record', async () => {
    const mounted = await mountedWithdrawal(); mounted.form.fire('submit'); await settleWithdrawal();
    const normal = transport.request.getMockImplementation()!;
    let finish!: (value: import('../src/pro/withdrawals').Withdrawal) => void;
    transport.request.mockImplementation(request => request.method === 'POST' && request.path === '/v1/withdrawals'
      ? new Promise(resolve => { finish = resolve; }) : normal(request));
    mounted.node('confirm').fire('click'); await settleWithdrawal();
    const saved = structuredClone(persisted) as WithdrawalPreview;
    await mounted.view.refresh(health, true, 'new-device', false);
    expect(mounted.pending).toHaveBeenLastCalledWith(false);
    mounted.node('status').textContent = 'New session status';
    const callbacks = mounted.pending.mock.calls.length;
    finish({ id: saved.spec.requestId, spec: saved.spec, state: 'FINALIZED', createdAt: 1, updatedAt: 2 });
    await settleWithdrawal();
    expect(mounted.pending.mock.calls).toHaveLength(callbacks);
    expect(mounted.node('status').textContent).toBe('New session status');
    expect(persisted).toEqual(saved); expect(transport.remove).not.toHaveBeenCalled();
    mounted.view.destroy();
  });
  it('shares deferred pending initialization across background and Wallet refreshes and blocks all new submissions', async () => {
    const setup = await mountedWithdrawal(); setup.view.destroy();
    transport.request.mockClear(); transport.read.mockClear();
    const saved = preview(); persisted = saved;
    let finish!: (value: Record<string, unknown>) => void;
    pendingRead = new Promise(resolve => { finish = resolve; });
    const container = new WithdrawalElement(), pending = vi.fn();
    const view = mountWithdrawalView(container as unknown as HTMLElement, undefined, pending);
    const form = container.querySelector('form'), confirm = container.querySelector('[data-confirm]');
    const amount = form.elements.namedItem('amount'); amount.value = '0.00002';
    const background = view.refresh(health, true, 'device', false);
    const wallet = view.refresh(health, true, 'device', true);
    let walletFinished = false; void wallet.then(() => { walletFinished = true; });
    await settleWithdrawal();
    expect(transport.read).toHaveBeenCalledTimes(1); expect(walletFinished).toBe(false);
    expect(amount.disabled).toBe(true); expect(confirm.disabled).toBe(true);
    expect(container.querySelector('[data-review]').children).toHaveLength(0);
    form.fire('submit'); confirm.fire('click'); await settleWithdrawal();
    expect(transport.request).not.toHaveBeenCalled(); expect(persisted).toEqual(saved);
    finish({ [pendingKey]: saved }); await Promise.all([background, wallet]);
    expect(form.hidden).toBe(true); expect(amount.disabled).toBe(true);
    expect(container.querySelector('[data-review]').textContent).toContain(saved.spec.requestId);
    expect(pending).toHaveBeenLastCalledWith(true);
    form.fire('submit'); await settleWithdrawal();
    expect(transport.request.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
    expect(persisted).toEqual(saved); expect(transport.remove).not.toHaveBeenCalled();
    view.destroy();
  });
  it('ignores a deferred pending loader after a session change without restoring the old review', async () => {
    const setup = await mountedWithdrawal(); setup.view.destroy();
    const saved = preview(); persisted = saved;
    let finish!: (value: Record<string, unknown>) => void;
    pendingRead = new Promise(resolve => { finish = resolve; });
    const container = new WithdrawalElement(), pending = vi.fn();
    const view = mountWithdrawalView(container as unknown as HTMLElement, undefined, pending);
    const oldRefresh = view.refresh(health, true, 'device', false);
    await view.refresh(health, true, 'new-device', true);
    const callbacks = pending.mock.calls.length;
    finish({ [pendingKey]: saved }); await oldRefresh;
    expect(container.querySelector('[data-review]').hidden).toBe(true);
    expect(container.querySelector('form').hidden).toBe(false);
    expect(pending.mock.calls).toHaveLength(callbacks); expect(pending).toHaveBeenLastCalledWith(false);
    expect(persisted).toEqual(saved); expect(transport.remove).not.toHaveBeenCalled();
    view.destroy();
  });
  it('restores saved pending in the background and reads history without token wallet or recipient requests', async () => {
    persisted = preview();
    const { view, pending, container } = await mountedWithdrawal(undefined, false);
    expect(pending).toHaveBeenLastCalledWith(true); expect(container.hidden).toBe(true);
    expect(transport.request.mock.calls.map(([request]) => [request.method, request.path])).toEqual([['GET', '/v1/withdrawals']]);
    expect(transport.remove).not.toHaveBeenCalled();
    view.destroy();
  });
  it.each(['AUTHORIZED', 'SIGNED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED'] as const)('keeps %s history visible to the background warning until FINALIZED', async state => {
    historyRows = [{ id, spec: spec(), state, createdAt: 1, updatedAt: 2 }];
    const { view, pending } = await mountedWithdrawal(undefined, false);
    expect(pending).toHaveBeenLastCalledWith(true);
    const known = historyRows[0]!;
    historyRows = [];
    await view.refresh(health, true, 'device', false);
    expect(pending).toHaveBeenLastCalledWith(true);
    historyRows = [{ ...known, state: 'FINALIZED' }];
    await view.refresh(health, true, 'device', false);
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(transport.request.mock.calls.every(([request]) => request.method === 'GET' && request.path === '/v1/withdrawals')).toBe(true);
    view.destroy();
  });
  it('blocks malformed saved uncertainty and never forgets it or permits a return to an editable form', async () => {
    persisted = { spec: {} };
    const container = new WithdrawalElement(), pending = vi.fn();
    vi.stubGlobal('document', { createElement: (tag: string) => new WithdrawalElement(tag) });
    const view = mountWithdrawalView(container as unknown as HTMLElement, undefined, pending);
    await expect(view.refresh(health, true, 'device')).rejects.toThrow('Saved pending withdrawal is invalid');
    expect(pending).toHaveBeenLastCalledWith(true); expect(container.querySelector('[data-confirm]').disabled).toBe(true);
    expect(container.querySelector('[data-back]').hidden).toBe(true); expect(transport.remove).not.toHaveBeenCalled();
  });
});
