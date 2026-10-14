import { browser } from 'wxt/browser';
import { solIcon } from '../ui/icons';
import { validateProData } from './client';
import { canonicalJson, type ProBalance, type ProHealth } from './contracts';
import { validateWithdrawalSpec, type Recipient, type WithdrawalSpec, type WithdrawalPreview, type Withdrawal } from './withdrawals';
import { sendPro } from './settings-view';
import { amountToRaw, rawToAmount, safeSolscanUrl, SOL_MINT } from './view';

/** Max discovery may return zero; its identity and expiry still bind to the local intent. */
function matchedWithdrawalPreview(spec: WithdrawalSpec, preview: WithdrawalPreview, now = Date.now()): WithdrawalPreview {
  validateWithdrawalSpec(spec);
  if (canonicalJson(spec) !== canonicalJson(preview.spec) || preview.expiresAt <= now) throw new Error('Withdrawal changed or review expired. Preview again.');
  return structuredClone(preview);
}
/** Bind an affordable transfer to the exact reviewed local intent. */
export function reviewedWithdrawal(spec: WithdrawalSpec, preview: WithdrawalPreview, now = Date.now()): WithdrawalPreview {
  const matched = matchedWithdrawalPreview(spec, preview, now);
  if (BigInt(spec.amountRaw) > BigInt(matched.maxRaw)) throw new Error('Amount exceeds the maximum available after reserved funds and withdrawal costs. Select Max and review again.');
  return matched;
}
export function restorePendingWithdrawal(value: unknown): WithdrawalPreview {
  validateProData('/v1/withdrawals/preview', value);
  return structuredClone(value) as WithdrawalPreview;
}
export function findReviewedWithdrawal(preview: WithdrawalPreview, rows: Withdrawal[]): Withdrawal | undefined {
  const existing = rows.find(row => row.id === preview.spec.requestId);
  if (existing && canonicalJson(existing.spec) !== canonicalJson(preview.spec)) throw new Error('Withdrawal response does not match the reviewed intent.');
  return existing;
}
export class WithdrawalReview {
  private revision = 0;
  private value?: WithdrawalPreview;
  invalidate(): void { this.revision++; this.value = undefined; }
  version(): number { return this.revision; }
  accept(spec: WithdrawalSpec, preview: WithdrawalPreview, revision: number): void {
    if (revision !== this.revision) throw new Error('Form changed. Preview again.');
    this.value = reviewedWithdrawal(spec, preview);
  }
  current(spec: WithdrawalSpec): WithdrawalPreview {
    if (!this.value) throw new Error('Preview the withdrawal first.');
    return reviewedWithdrawal(spec, this.value);
  }
}
export function mountWithdrawalView(container: HTMLElement, currentMint: () => string = () => '', onPendingChange?: (pending: boolean) => void): { refresh(health: ProHealth, enabled: boolean, deviceId: string, visible?: boolean): Promise<void>; destroy():void } {
  container.classList.add('pro-withdrawal');
  container.hidden = true;
  container.innerHTML = `<h2>Withdraw</h2><p>Send only unreserved funds. Orders continue running.</p><form><label>Saved recipient<select name="recipient" required></select></label><p data-address class="mono"></p><label><span class="pro-field-label">Asset <span data-asset-icon hidden>${solIcon()}</span></span><select name="asset"></select></label><details><summary>Load another token</summary><label>Token mint<input name="tokenMint" autocomplete="off" spellcheck="false"></label><button type="button" data-load-token>Load token balance</button></details><label>Amount<input name="amount" inputmode="decimal" autocomplete="off" required></label><button type="button" data-max>Max available</button><button type="submit">Review withdrawal</button></form><section class="pro-withdraw-review" data-review hidden aria-label="Withdrawal review"></section><div class="pro-withdraw-actions" data-actions hidden><button type="button" data-back>Back to withdrawal form</button><button type="button" data-confirm hidden>Confirm withdrawal</button></div><p data-status role="status" aria-live="polite"></p><h3>Withdrawal history</h3><div data-history></div>`;
  const form = container.querySelector('form')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const node = (key: string) => container.querySelector<HTMLElement>(`[data-${key}]`)!;
  const confirm = node('confirm') as HTMLButtonElement;
  const api = (method: string, path: string, body?: unknown) => sendPro({ action: 'REQUEST', method, path, body });
  const review = new WithdrawalReview();
  let recipients: Recipient[] = [], balances: ProBalance[] = [];
  let requestId: string = crypto.randomUUID();
  let feeCap = '5000000';
  let alive = true, generation = 0, historyRevision = 0, unresolvedHistory = false;
  let pendingLoad: Promise<void> | undefined, pendingLoaded = false, loadingPending = true;
  const owned = (owner: number) => alive && owner === generation;
  const unresolvedIds = new Set<string>();
  const trackHistory = (rows: Withdrawal[]) => {
    for (const row of rows) {
      if (['AUTHORIZED', 'SIGNED', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED'].includes(row.state)) unresolvedIds.add(row.id);
      else if (['FINALIZED', 'FAILED', 'EXPIRED'].includes(row.state)) unresolvedIds.delete(row.id);
    }
    unresolvedHistory = unresolvedIds.size > 0;
  };
  let busy = false, allowed = false, uncertain: WithdrawalPreview | undefined, session: string | undefined, pendingKey: string | undefined, extraMint = '', blockedPending = false;
  const forgetPending = async (owner: number) => { if (owned(owner) && pendingKey) await browser.storage.local.remove(pendingKey); };
  const invalidate = () => { if (!alive) return; review.invalidate(); node('review').hidden = true; node('actions').hidden = true; confirm.hidden = true; form.hidden = false; };
  const renderSolValue = (element: HTMLElement, value: string) => {
    element.className = 'asset-value';
    element.textContent = value;
    const unit = document.createElement('span');
    unit.innerHTML = solIcon();
    element.append(unit);
    element.setAttribute('aria-label', `${value} SOL`.trim());
  };
  const updateAssetIcon = () => { node('asset-icon').hidden = field('asset').value !== SOL_MINT; };
  const showReview = (preview: WithdrawalPreview, recipientName?: string) => {
    const intended = preview.spec, pending = Boolean(uncertain);
    const heading = document.createElement('h3');
    heading.textContent = pending ? 'Pending withdrawal review' : 'Review withdrawal';
    const details = document.createElement('dl');
    const rows = [
      ['Recipient', recipientName ?? intended.recipientId],
      ['Full address', intended.address],
      ['Asset', intended.mint === SOL_MINT ? '' : intended.mint],
      ['Amount', `${rawToAmount(intended.amountRaw, intended.decimals)}${intended.mint === SOL_MINT ? '' : ' tokens'}`],
      ['Estimated fee', `${rawToAmount(preview.feeLamports, 9)}`],
      ['Account rent', `${rawToAmount(preview.rentLamports, 9)}`],
      ['Maximum network budget', `${rawToAmount(intended.maxNetworkLamports, 9)}`],
      ['Review expires', new Date(preview.expiresAt).toLocaleString()],
      ...(pending ? [['Request', intended.requestId]] : []),
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label!;
      if (['Estimated fee', 'Account rent', 'Maximum network budget'].includes(label!) || (['Asset', 'Amount'].includes(label!) && intended.mint === SOL_MINT)) renderSolValue(description, value!);
      else description.textContent = value!;
      if (label === 'Full address' || label === 'Request' || (label === 'Asset' && intended.mint !== SOL_MINT)) description.className = 'mono';
      row.append(term, description); details.append(row);
    }
    node('review').replaceChildren(heading, details);
    form.hidden = true; node('review').hidden = false; node('actions').hidden = false; confirm.hidden = false;
    node('back').hidden = pending;
    confirm.textContent = pending ? 'Check status & retry same withdrawal' : 'Confirm withdrawal';
  };
  const controls = () => {
    if (!alive) return;
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,select,button')) input.disabled = loadingPending || busy || !allowed || Boolean(uncertain) || blockedPending;
    confirm.disabled = loadingPending || busy || !allowed || blockedPending;
    node('back').hidden = Boolean(uncertain) || blockedPending;
    (node('back') as HTMLButtonElement).disabled = loadingPending || busy;
    onPendingChange?.(Boolean(uncertain) || blockedPending || unresolvedHistory);
  };
  const selected = () => {
    const recipient = recipients.find(r => r.id === field('recipient').value && r.active);
    const balance = balances.find(b => b.mint === field('asset').value);
    if (!recipient || !balance) throw new Error('Choose a verified saved recipient and supported asset.');
    return { recipient, balance };
  };
  const spec = (minimum = false): WithdrawalSpec => {
    const { recipient, balance } = selected();
    return validateWithdrawalSpec({ requestId, recipientId: recipient.id, recipientVersion: recipient.version, address: recipient.address, mint: balance.mint, decimals: balance.decimals, amountRaw: minimum ? '1' : amountToRaw(field('amount').value, balance.decimals), maxNetworkLamports: feeCap });
  };
  const run = async (job: (owner: number) => Promise<void>) => {
    if (!alive || loadingPending || blockedPending || !allowed || busy) return; const owner = generation; busy = true; controls();
    try { await job(owner); } catch (error) { if (owned(owner)) node('status').textContent = error instanceof Error ? error.message : 'Withdrawal request failed.'; }
    finally { if (owned(owner)) { busy = false; controls(); } }
  };
  node('back').addEventListener('click', () => {
    if (!alive || loadingPending || busy || uncertain || blockedPending) return;
    invalidate(); node('status').textContent = 'Update the withdrawal and review again before confirming.';
  });
  form.addEventListener('input', invalidate);
  form.addEventListener('change', () => { if (!alive) return; invalidate(); updateAssetIcon(); node('address').textContent = recipients.find(r => r.id === field('recipient').value)?.address ?? ''; });
  form.addEventListener('submit', event => { event.preventDefault(); if (uncertain) return; void run(async owner => {
    invalidate(); const version = review.version(), intended = spec();
    const preview = await api('POST', '/v1/withdrawals/preview', intended) as WithdrawalPreview;
    if (!owned(owner)) return;
    review.accept(intended, preview, version);
    showReview(review.current(intended), selected().recipient.name);
    node('status').textContent = 'Check the full address and amount above before confirming.';
  }); });
  node('load-token').addEventListener('click', () => void run(async owner => {
    const mint = field('tokenMint').value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error('Enter a full Solana token mint.');
    const version = review.version();
    const data = await api('GET', `/v1/wallet?mint=${mint}`) as ProBalance[] | { balances: ProBalance[] };
    if (!owned(owner)) return;
    if (version !== review.version()) throw new Error('Form changed. Load the token again.');
    const rows = Array.isArray(data) ? data : data.balances;
    if (!rows.some(b => b.mint === mint)) throw new Error('Supported token balance or decimals unavailable.');
    extraMint = mint; balances = rows;
    const select = field('asset') as unknown as HTMLSelectElement; select.replaceChildren();
    for (const balance of rows) { const option = document.createElement('option'); option.value = balance.mint; option.textContent = balance.mint === SOL_MINT ? 'Solana' : balance.mint; select.append(option); }
    select.value = mint; invalidate(); updateAssetIcon();
    node('status').textContent = 'Token balance loaded. Enter the amount and review the full withdrawal.';
  }));
  node('max').addEventListener('click', () => void run(async owner => {
    invalidate(); const version = review.version(), intended = spec(true);
    const preview = matchedWithdrawalPreview(intended, await api('POST', '/v1/withdrawals/preview', intended) as WithdrawalPreview);
    if (!owned(owner)) return;
    if (version !== review.version()) throw new Error('Form changed. Select Max again.');
    if (BigInt(preview.maxRaw) === 0n) throw new Error('No amount is available after reserved funds and estimated withdrawal costs.');
    field('amount').value = rawToAmount(preview.maxRaw, intended.decimals); invalidate();
    node('status').textContent = 'Maximum unreserved amount selected. Review before confirming.';
  }));
  async function accepted(withdrawal: Withdrawal, owner: number) {
    if (!owned(owner)) return;
    if (uncertain && canonicalJson(withdrawal.spec) !== canonicalJson(uncertain.spec)) throw new Error('Withdrawal response does not match the reviewed intent.');
    await forgetPending(owner); if (!owned(owner)) return;
    historyRevision++; trackHistory([withdrawal]); uncertain = undefined; invalidate(); requestId = crypto.randomUUID(); field('amount').value = '';
    node('status').textContent = `Withdrawal ${withdrawal.id} · ${withdrawal.state}. Confirmation and finalization appear in history.`;
  }
  confirm.addEventListener('click', () => void run(async owner => {
    if (!allowed) return;
    const approved = uncertain ?? review.current(spec());
    if (uncertain) {
      const history = await api('GET', '/v1/withdrawals') as Withdrawal[];
      if (!owned(owner)) return;
      const existing = findReviewedWithdrawal(approved, history);
      if (existing) { await accepted(existing, owner); return; }
      if (approved.expiresAt <= Date.now()) { await forgetPending(owner); if (!owned(owner)) return; uncertain = undefined; invalidate(); throw new Error('Review expired and no withdrawal was found. Preview again using the same request ID.'); }
      reviewedWithdrawal(approved.spec, approved);
    }
    // Preserve the same reviewed ID and bytes across a lost acknowledgement.
    if (!pendingKey) throw new Error('Pro session is still loading.');
    await browser.storage.local.set({ [pendingKey]: approved });
    if (!owned(owner)) return;
    historyRevision++; uncertain = structuredClone(approved); controls();
    try { await accepted(await api('POST', '/v1/withdrawals', { previewId: approved.id, spec: approved.spec }) as Withdrawal, owner); }
    catch (error) { if (!owned(owner)) return; confirm.textContent = 'Check status & retry same withdrawal'; throw new Error(`Outcome unconfirmed for ${approved.spec.requestId}. The pending review is saved; check history before retrying the same withdrawal. ${error instanceof Error ? error.message : ''}`); }
  }));
  return { destroy(){alive=false;generation++;allowed=false;review.invalidate();}, async refresh(health, enabled, deviceId, visible = true) {
    if(!alive)return;
    const cap = BigInt(health.limits.maxNetworkLamports);
    const nextCap = String(cap < 5000000n ? cap : 5000000n);
    if (nextCap !== feeCap) { feeCap = nextCap; if (!uncertain) invalidate(); }
    const available = health.capabilities?.includes('withdrawals-v1') === true;
    container.hidden = !available || !visible;
    allowed = available && enabled && health.signer === 'READY'; controls();
    const nextSession = `${health.serverId}:${deviceId}`;
    if (session !== nextSession) {
      generation++; busy = false; unresolvedIds.clear(); unresolvedHistory = false; uncertain = undefined; invalidate(); requestId = crypto.randomUUID(); session = nextSession;
      pendingKey = `proWithdrawalPending:${nextSession}`;
      pendingLoad = undefined; pendingLoaded = false; loadingPending = true; blockedPending = false; controls();
    }
    const owner = generation;
    if (!pendingLoaded && !pendingLoad) {
      loadingPending = true; controls();
      const key = pendingKey!;
      pendingLoad = (async () => {
        try {
          const stored = (await browser.storage.local.get(key))[key];
          if (!owned(owner)) return;
          if (stored !== undefined) {
            try { uncertain = restorePendingWithdrawal(stored); }
            catch { throw new Error('Saved pending withdrawal is invalid. Check server withdrawal history before clearing the local record.'); }
            requestId = uncertain.spec.requestId;
            showReview(uncertain);
          }
          blockedPending = false; pendingLoaded = true;
        } catch (error) {
          if (!owned(owner)) return;
          blockedPending = true; pendingLoad = undefined;
          throw error;
        } finally {
          if (owned(owner)) { loadingPending = false; controls(); }
        }
      })();
    }
    await pendingLoad;
    if (!owned(owner)) return;
    if (!available || busy) return;
    const historyVersion = historyRevision;
    const [nextRecipients, data, history] = await Promise.all([
      visible ? api('GET', '/v1/recipients') : Promise.resolve(undefined),
      visible ? api('GET', `/v1/wallet${/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(extraMint || currentMint()) ? `?mint=${extraMint || currentMint()}` : ''}`) : Promise.resolve(undefined),
      api('GET', '/v1/withdrawals'),
    ]);
    if (!owned(owner) || historyVersion !== historyRevision || busy) return;
    trackHistory(history as Withdrawal[]);
    if (visible) {
      const nextBalances = Array.isArray(data) ? data as ProBalance[] : (data as { balances: ProBalance[] }).balances;
      const active = (nextRecipients as Recipient[]).filter(r => r.active);
      if (canonicalJson(active) !== canonicalJson(recipients) || canonicalJson(nextBalances) !== canonicalJson(balances)) {
        recipients = active; balances = nextBalances;
        if (!uncertain) invalidate();
        for (const [name, options] of [['recipient', recipients.map(r => [r.id, r.name])], ['asset', balances.map(b => [b.mint, b.mint === SOL_MINT ? 'Solana' : b.mint])]] as const) {
          const select = field(name) as unknown as HTMLSelectElement, previous = select.value; select.replaceChildren();
          for (const [value, label] of options) { const option = document.createElement('option'); option.value = value!; option.textContent = label!; select.append(option); }
          if ([...select.options].some(o => o.value === previous)) select.value = previous;
        }
        updateAssetIcon();
        node('address').textContent = recipients.find(r => r.id === field('recipient').value)?.address ?? '';
      }
    }
    const list = node('history'); list.replaceChildren();
    for (const withdrawal of (history as Withdrawal[]).slice(0, 30)) {
      const row = document.createElement('article'), text = document.createElement('p');
      text.className = 'mono'; text.textContent = `${withdrawal.state} · `;
      const amount = document.createElement('span');
      const value = rawToAmount(withdrawal.spec.amountRaw, withdrawal.spec.decimals);
      if (withdrawal.spec.mint === SOL_MINT) renderSolValue(amount, value);
      else amount.textContent = `${value} · ${withdrawal.spec.mint}`;
      text.append(amount);
      const identity = document.createElement('span');
      identity.textContent = `\n${withdrawal.spec.address}\n${withdrawal.id}${withdrawal.error ? ` · ${withdrawal.error}` : ''}`;
      text.append(identity); row.append(text);
      const url = safeSolscanUrl(withdrawal.signature); if (url) { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'View transaction'; row.append(link); } list.append(row);
      if (uncertain?.spec.requestId === withdrawal.id) { await accepted(withdrawal, owner); if (!owned(owner)) return; }
    }
    if (!list.childElementCount) list.textContent = 'No withdrawals yet.';
    if (visible && !recipients.length) node('status').textContent = 'Add a verified recipient in Pro settings first.';
    controls();
  } };
}
