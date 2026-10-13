import bs58 from 'bs58';
import type { Recipient } from './withdrawals';
import type { ProHealth } from './contracts';
import { sanitizeDiagnostic } from '../diagnostics';
import { browser } from 'wxt/browser';
import type { ProReply, ProSettings } from './contracts';
import type { ProRequest } from './worker';
export async function sendPro(request: Omit<ProRequest, 'type'>): Promise<unknown> {
  const reply = await browser.runtime.sendMessage({ type: 'PRO', ...request }) as ProReply;
  if (!reply.ok) throw new Error(String(sanitizeDiagnostic(reply.error)));
  return reply.data;
}
export interface ProSettingsController {
  refresh: () => Promise<void>;
  collapseConnection: () => void;
  destroy: () => void;
}
export function mountProSettings(container: HTMLElement): ProSettingsController {
  container.innerHTML = `<section class="pro-settings pro-connection-settings">
    <details class="pro-settings-connection" data-pro="connection">
    <summary class="pro-settings-heading">Pro · Personal server</summary>
    <p class="pro-settings-description">Disabled by default. Orders run on your dedicated server wallet without Phantom approval. Closing this browser does not stop orders.</p>
    <div class="pro-settings-group">
      <label>HTTPS server origin<input name="proServer" type="url" placeholder="https://pro.example.com" autocomplete="off"></label>
      <label>One-time pairing code<input name="proCode" type="password" autocomplete="off" placeholder="Paste the code generated on your server"></label>
      <details class="pro-pairing-help" data-pro="pairing-help"><summary>Get a pairing code</summary><p>Each browser needs its own code. Generate it in the server terminal, paste it above, then click Pair server and allow access. The code expires after 5 minutes and can be used once. You can pair while the signer is locked.</p><p>On your server, run this command (replace the installation and state paths):</p><code>node /path/to/server-dist/cli.mjs pair-code --state-dir /path/to/signer-state</code><p>Paste the returned code; enclosing quotation marks are accepted. This connects the browser without unlocking the wallet or starting trades.</p></details>
      <div class="pro-settings-actions"><button type="button" data-pro="pair">Pair server</button><button type="button" data-pro="toggle" disabled>Enable Pro</button></div>
    </div>
    <label class="pro-settings-notifications"><span>Chrome notifications</span><input name="proNotifications" type="checkbox" role="switch" disabled></label>
    <details class="pro-settings-recipients" data-pro="recipients" hidden>
      <summary>Withdrawal Whitelist</summary>
      <div class="pro-settings-group"><p>Compare the full address with the receive screen in your trusted wallet. Address validation alone does not detect clipboard replacement. Changing an address requires a new recipient.</p>
        <label>Recipient name<input name="recipientName" maxlength="64" autocomplete="off"></label>
        <label>Full receiving address<input name="recipientAddress" autocomplete="off" spellcheck="false"></label>
        <div class="pro-settings-actions"><button type="button" data-pro="review-recipient">Review recipient</button></div>
        <dl class="pro-settings-recipient-review" data-pro="recipient-review" hidden><dt>Recipient name</dt><dd data-pro="review-name"></dd><dt>Full receiving address</dt><dd class="mono" data-pro="review-address"></dd></dl>
        <label class="pro-settings-check" data-pro="recipient-check" hidden><input name="recipientVerified" type="checkbox"><span>I compared the full address with my trusted receiving wallet.</span></label>
        <div class="pro-settings-actions"><button type="button" data-pro="save-recipient" hidden>Save reviewed recipient</button></div>
        <div class="pro-settings-recipient-list" data-pro="recipient-list"></div>
      </div>
    </details>
    </details>
    <p class="pro-settings-status" data-pro="status" role="status" aria-live="polite">Loading Pro settings…</p>
  </section>`;
  // Capture this mount's section so a later mount cannot be reached by old callbacks.
  const root = container.querySelector<HTMLElement>('.pro-settings')!;
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  let alive = true;
  let generation = 0;
  const current = (version: number) => alive && version === generation;
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-pro="toggle"]')!;
  const status = root.querySelector<HTMLElement>('[data-pro="status"]')!;
  let settings: ProSettings | undefined;
  let recipientReview: { id: string; name: string; address: string } | undefined;
  let recipientBusy = false;
  const recipientNode = (key: string) => root.querySelector<HTMLElement>(`[data-pro="${key}"]`)!;
  const invalidateRecipient = () => {
    if (!alive) return;
    recipientReview = undefined; input('recipientVerified').checked = false;
    for (const key of ['recipient-review','recipient-check','save-recipient']) recipientNode(key).hidden = true;
  };
  for (const name of ['recipientName','recipientAddress']) input(name).addEventListener('input', invalidateRecipient, eventOptions);
  const request = (method: string, path: string, body?: unknown) => sendPro({ action: 'REQUEST', method, path, body });
  const refreshRecipients = async (version: number, loaded: ProSettings) => {
    recipientNode('recipients').hidden = true;
    if (!loaded.deviceId) return;
    const health = await request('GET', '/v1/health') as ProHealth;
    if (!current(version) || !health.capabilities?.includes('withdrawals-v1')) return;
    recipientNode('recipients').hidden = false;
    const rows = await request('GET', '/v1/recipients') as Recipient[];
    if (!current(version)) return;
    const list = recipientNode('recipient-list'); list.replaceChildren();
    for (const recipient of rows) {
      const row = document.createElement('article'), label = document.createElement('p'), address = document.createElement('p');
      row.className = 'pro-settings-recipient';
      label.textContent = `${recipient.name} · ${recipient.active ? 'Active' : 'Inactive'}`;
      address.className = 'mono'; address.textContent = recipient.address; row.append(label, address);
      if (recipient.active) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Deactivate'; button.disabled = !loaded.enabled;
        button.addEventListener('click', () => void run(async () => {
          if (!window.confirm(`Deactivate this saved recipient?\n${recipient.name}\n${recipient.address}`)) return;
          await request('POST', `/v1/recipients/${recipient.id}/deactivate`, { version: recipient.version }); invalidateRecipient();
        }), eventOptions); row.append(button);
      }
      list.append(row);
    }
    (recipientNode('review-recipient') as HTMLButtonElement).disabled = !loaded.enabled;
  };
  recipientNode('review-recipient').addEventListener('click', () => {
    if (!alive || !settings?.enabled || recipientBusy) return;
    try {
      const name = input('recipientName').value.trim(), address = input('recipientAddress').value.trim();
      if (!name || name.length > 64 || bs58.decode(address).length !== 32) throw new Error('Enter a name and a valid full Solana address.');
      recipientReview = { id: crypto.randomUUID(), name, address };
      input('recipientVerified').checked = false;
      recipientNode('review-name').textContent = name;
      recipientNode('review-address').textContent = address;
      for (const key of ['recipient-review','recipient-check','save-recipient']) recipientNode(key).hidden = false;
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Invalid recipient.'; }
  }, eventOptions);
  recipientNode('save-recipient').addEventListener('click', () => void run(async () => {
    if (!recipientReview || recipientBusy || !input('recipientVerified').checked) throw new Error('Compare the full address with your trusted receiving wallet and check the confirmation.');
    const reviewed = structuredClone(recipientReview);
    if (reviewed.name !== input('recipientName').value.trim() || reviewed.address !== input('recipientAddress').value.trim()) { invalidateRecipient(); throw new Error('Recipient changed. Review again.'); }
    recipientBusy = true;
    try {
      const existing = await request('GET', '/v1/recipients') as Recipient[];
      if (!alive) return;
      const match = existing.find(r => r.id === reviewed.id);
      if (match && (match.address !== reviewed.address || match.name !== reviewed.name || !match.active)) throw new Error('Saved recipient mismatch.');
      if (!match) await request('POST', '/v1/recipients', reviewed);
      if (!alive) return;
      invalidateRecipient(); input('recipientName').value = ''; input('recipientAddress').value = '';
    } finally { recipientBusy = false; }
  }), eventOptions);
  const update = async () => {
    if (!alive) return;
    const version = ++generation;
    try {
      const loaded = await sendPro({ action: 'SETTINGS' }) as ProSettings;
      if (!current(version)) return;
      settings = loaded;
      input('proServer').value = loaded.serverUrl;
      input('proNotifications').checked = loaded.chromeNotifications;
      input('proNotifications').disabled = false;
      toggle.textContent = loaded.enabled ? 'Pause all & disable Pro' : 'Enable Pro';
      await refreshRecipients(version, loaded);
      if (!current(version)) return;
      toggle.disabled = false;
      status.textContent = `${loaded.enabled ? 'Enabled' : 'Disabled'} · ${loaded.deviceId ? 'Paired' : 'Not paired'}`;
    } catch (error) {
      if (current(version)) status.textContent = error instanceof Error ? error.message : 'Pro settings failed.';
    }
  };
  const run = async (job: () => Promise<void>) => {
    if (!alive) return;
    toggle.disabled = true;
    input('proNotifications').disabled = true;
    try { await job(); if (alive) await update(); }
    catch (error) { if (alive) { input('proNotifications').checked = settings?.chromeNotifications ?? false; status.textContent = error instanceof Error ? error.message : 'Pro settings failed.'; } }
    finally { if (alive) { toggle.disabled = !settings; input('proNotifications').disabled = !settings; } }
  };
  root.querySelector('[data-pro="pair"]')!.addEventListener('click', () => void run(async () => {
    let code = input('proCode').value.trim();
    if (code.startsWith('"') && code.endsWith('"')) {
      try { const decoded: unknown = JSON.parse(code); if (typeof decoded === 'string') code = decoded.trim(); } catch { /* The server will reject a malformed code. */ }
    }
    if (!code) {
      (recipientNode('pairing-help') as HTMLDetailsElement).open = true;
      input('proCode').focus();
      throw new Error('Generate a code on your server and paste it here. See Get a pairing code for the command.');
    }
    const origin = new URL(input('proServer').value.trim());
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Enter an HTTPS origin only.');
    if (!await browser.permissions.request({ origins: [`${origin.origin}/*`] })) throw new Error('Server access was not granted.');
    if (!alive) return;
    try { await sendPro({ action: 'PAIR', serverUrl: origin.origin, code }); }
    catch (error) {
      if (alive && error instanceof Error && /pairing code.*(?:invalid|expired|used)/i.test(error.message)) {
        (recipientNode('pairing-help') as HTMLDetailsElement).open = true;
        input('proCode').focus();
      }
      throw error;
    }
    if (alive) input('proCode').value = '';
  }), eventOptions);
  toggle.addEventListener('click', () => void run(async () => { await sendPro({ action: settings?.enabled ? 'DISABLE' : 'ENABLE' }); }), eventOptions);
  input('proNotifications').addEventListener('change', () => {
    if (!alive) return;
    const enabled = input('proNotifications').checked;
    // Permission request must start synchronously within the user gesture.
    const permission = enabled ? browser.permissions.request({ permissions: ['notifications'] }) : Promise.resolve(true);
    void run(async () => {
      if (!await permission) throw new Error('Notification permission was not granted.');
      if (!alive) return;
      if (!settings) throw new Error('Settings are still loading.');
      await sendPro({ action: 'SETTINGS', settings: { ...settings, chromeNotifications: enabled } });
    });
  }, eventOptions);
  void update();
  return { refresh: update, collapseConnection: () => { if (alive) (recipientNode('connection') as HTMLDetailsElement).open = false; }, destroy: () => { alive = false; generation++; events.abort(); } };
}
