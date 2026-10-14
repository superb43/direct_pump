import type { ProHealth } from './contracts';
import { activeProfile, solToLamports, validatePreferencesLimits, validateTradingPreferences, type ProTradingPreferences } from './trading-preferences';

export type TradingPreferencesOptions = {
  load: () => Promise<ProTradingPreferences>; save: (prefs: ProTradingPreferences) => Promise<ProTradingPreferences>;
  changed: (prefs: ProTradingPreferences) => void; limits?: () => ProHealth['limits'] | undefined;
  preview?: boolean; onSetup?: () => void;
};
export function mountTradingPreferences(container: HTMLElement, options: TradingPreferencesOptions) {
  container.innerHTML = `<section class="pro-trading-preferences"><fieldset class="pro-execution"><legend>Trading preferences</legend>
    <div class="pro-fields"><label>Active profile<select name="profile"></select></label><label>Profile name<input name="profileName" maxlength="32" autocomplete="off"></label></div>
    <div class="pro-step-tools"><button type="button" data-pref="add">New</button><button type="button" data-pref="clone">Duplicate</button><button type="button" data-pref="delete">Delete</button></div>
    <div class="pro-fields"><label>Buy presets · SOL<input name="buyPresets" placeholder="0.01, 0.05, 0.1, 0.5"></label><label>Sell presets · %<input name="sellPresets" placeholder="25, 50, 75, 100"></label>
    <label>Slippage %<input name="profileSlippage" inputmode="decimal"></label><label>Expires · hours<input name="profileExpires" type="number" min="0.0166667" max="720" step="any"></label>
    <label>Priority fee · SOL<input name="profilePriority" inputmode="decimal"></label><label>Network budget · SOL<input name="profileBudget" inputmode="decimal"></label></div>
    <label class="pro-settings-check"><input name="confirmMarket" type="checkbox"><span>Confirm market orders</span></label>
    <label class="pro-settings-check"><input name="confirmLimit" type="checkbox"><span>Confirm limit orders</span></label>
    <p>Comma-separated presets. Confirmation and hotkeys apply to every profile.</p>
    <details><summary>Panel hotkeys</summary><p>Hold Space and a key. Keys use letters or digits and must be unique.</p><div class="pro-fields">${['buy', 'sell'].flatMap(side => Array.from({ length: 8 }, (_, index) => `<label>${side === 'buy' ? 'Buy' : 'Sell'} slot ${index + 1}<input name="${side}Key${index}" maxlength="1" autocomplete="off" spellcheck="false"></label>`)).join('')}</div></details>
    <button type="button" data-pref="save">Save trading preferences</button>
    <p data-pref="status" role="status" aria-live="polite">Loading trading preferences…</p>
  </fieldset></section>`;
  const root = container.querySelector<HTMLElement>('.pro-trading-preferences')!;
  const abort = new AbortController(), events = { signal: abort.signal };
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const node = (name: string) => root.querySelector<HTMLElement>(`[data-pref="${name}"]`)!;
  const profileSelect = input('profile') as unknown as HTMLSelectElement;
  let alive = true, busy = false, generation = 0, draft: ProTradingPreferences | undefined;
  const controls = () => {
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(control => { control.disabled = busy || !draft; });
    (node('add') as HTMLButtonElement).disabled ||= (draft?.profiles.length ?? 8) >= 8;
    (node('clone') as HTMLButtonElement).disabled ||= (draft?.profiles.length ?? 8) >= 8;
    (node('delete') as HTMLButtonElement).disabled ||= (draft?.profiles.length ?? 1) === 1;
  };
  const sol = (raw: string | number) => `${BigInt(raw) / 1_000_000_000n}.${(BigInt(raw) % 1_000_000_000n).toString().padStart(9, '0')}`.replace(/0+$/, '').replace(/\.$/, '');
  function render() {
    if (!draft || !alive) return;
    const profile = activeProfile(draft);
    profileSelect.replaceChildren(...draft.profiles.map(row => {
      const option = document.createElement('option'); option.value = row.id; option.textContent = row.name; return option;
    }));
    profileSelect.value = profile.id;
    input('profileName').value = profile.name; input('buyPresets').value = profile.buyPresets.join(', '); input('sellPresets').value = profile.sellPresets.join(', ');
    input('profileSlippage').value = String(profile.slippageBps / 100); input('profileExpires').value = String(profile.expiresHours);
    input('profilePriority').value = sol(profile.priorityFeeLamports); input('profileBudget').value = sol(profile.maxNetworkLamports);
    input('confirmMarket').checked = draft.confirmMarket; input('confirmLimit').checked = draft.confirmLimit;
    for (let i = 0; i < 8; i++) { input(`buyKey${i}`).value = draft.buyKeys[i]!.replace(/^(Key|Digit)/, ''); input(`sellKey${i}`).value = draft.sellKeys[i]!.replace(/^(Key|Digit)/, ''); }
    controls();
  }
  function capture(): ProTradingPreferences {
    if (!draft) throw new Error('Trading preferences are unavailable.');
    const next = structuredClone(draft), profile = activeProfile(next);
    profile.name = input('profileName').value.trim();
    profile.buyPresets = input('buyPresets').value.split(',').map(value => value.trim());
    profile.sellPresets = input('sellPresets').value.split(',').map(value => Number(value.trim()));
    const slippage = input('profileSlippage').value.trim();
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(slippage)) throw new Error('Slippage supports at most two decimal places.');
    profile.slippageBps = Math.round(Number(slippage) * 100); profile.expiresHours = Number(input('profileExpires').value);
    profile.priorityFeeLamports = Number(solToLamports(input('profilePriority').value.trim()));
    profile.maxNetworkLamports = String(solToLamports(input('profileBudget').value.trim()));
    next.confirmMarket = input('confirmMarket').checked; next.confirmLimit = input('confirmLimit').checked;
    const code = (value: string) => { const key = value.trim().toUpperCase(); return /^[A-Z]$/.test(key) ? `Key${key}` : `Digit${key}`; };
    next.buyKeys = Array.from({ length: 8 }, (_, i) => code(input(`buyKey${i}`).value));
    next.sellKeys = Array.from({ length: 8 }, (_, i) => code(input(`sellKey${i}`).value));
    const valid = validateTradingPreferences(next);
    for (const profile of valid.profiles) validatePreferencesLimits(profile, options.limits?.());
    return valid;
  }
  const edit = (action: () => void) => {
    if (!alive || busy || !draft) return;
    try { draft = capture(); action(); render(); node('status').textContent = 'Unsaved changes. Save to apply.'; }
    catch (error) { profileSelect.value = draft!.activeProfileId; node('status').textContent = error instanceof Error ? error.message : 'Invalid trading preferences.'; }
  };
  profileSelect.addEventListener('change', () => edit(() => { draft!.activeProfileId = profileSelect.value; }), events);
  for (const action of ['add', 'clone']) node(action).addEventListener('click', () => edit(() => {
    if (draft!.profiles.length >= 8) throw new Error('Use at most eight profiles.');
    const profile = structuredClone(activeProfile(draft!));
    profile.id = crypto.randomUUID(); profile.name = action === 'clone' ? `${profile.name.slice(0, 27)} copy` : `Profile ${draft!.profiles.length + 1}`;
    draft!.profiles.push(profile); draft!.activeProfileId = profile.id;
  }), events);
  node('delete').addEventListener('click', () => edit(() => {
    if (draft!.profiles.length === 1) throw new Error('Keep at least one profile.');
    draft!.profiles = draft!.profiles.filter(row => row.id !== draft!.activeProfileId); draft!.activeProfileId = draft!.profiles[0]!.id;
  }), events);
  node('save').addEventListener('click', () => {
    if (!alive || busy || !draft) return;
    if (options.preview) { options.onSetup?.(); return; }
    let next: ProTradingPreferences;
    try { next = capture(); } catch (error) { node('status').textContent = error instanceof Error ? error.message : 'Invalid trading preferences.'; return; }
    busy = true; controls(); node('status').textContent = 'Saving trading preferences…'; const version = ++generation;
    void options.save(next).then(value => {
      if (!alive || version !== generation) return;
      draft = validateTradingPreferences(value); render(); node('status').textContent = 'Trading preferences saved.'; options.changed(structuredClone(draft));
    }).catch(error => { if (alive && version === generation) node('status').textContent = `Preferences were not saved. ${error instanceof Error ? error.message : 'Storage unavailable.'}`; })
      .finally(() => { if (alive && version === generation) { busy = false; controls(); } });
  }, events);
  function update(value: ProTradingPreferences) {
    if (!alive) return;
    ++generation; busy = false; draft = validateTradingPreferences(value); render();
  }
  controls(); const version = ++generation;
  void options.load().then(value => { if (!alive || version !== generation) return; draft = validateTradingPreferences(value); render(); node('status').textContent = ''; })
    .catch(error => { if (alive && version === generation) node('status').textContent = `Trading preferences unavailable. ${error instanceof Error ? error.message : 'Storage unavailable.'}`; });
  return { update, destroy: () => { alive = false; ++generation; abort.abort(); } };
}
