import { browser } from 'wxt/browser';
import { validateSettings } from '../../src/settings';
import type { WorkerResponse } from '../../src/model';
import './style.css';

document.querySelector('h1')!.textContent = `DIRECT PUMP ${browser.runtime.getManifest().version}`;
const form = document.querySelector('form')!;
const status = document.querySelector<HTMLElement>('#status')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

async function load() {
  const response = await browser.runtime.sendMessage({ type: 'SETTINGS_GET' }) as WorkerResponse;
  if (!response.ok || !response.settings) throw new Error('Could not load settings.');
  const settings = response.settings;
  field('rpcUrl').value = settings.rpcUrl;
  field('slippage').value = String(settings.slippageBps / 100);
  field('spendLimitsEnabled').checked = settings.spendLimitsEnabled;
  updateLimits();
  field('maxBuySol').value = settings.maxBuySol;
  field('priority').value = String(settings.priorityFeeLamports / 1_000_000_000);
  field('buyPresets').value = settings.buyPresets.join(', ');
  field('sellPresets').value = settings.sellPresets.join(', ');
  field('jupiterApiKey').value = settings.jupiterApiKey;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const settings = validateSettings({ spendLimitsEnabled: field('spendLimitsEnabled').checked, rpcUrl: field('rpcUrl').value.trim(), slippageBps: Math.round(Number(field('slippage').value) * 100), maxBuySol: field('maxBuySol').value.trim(), maxQuoteBuyAmount: '1', priorityFeeLamports: Math.round(Number(field('priority').value) * 1_000_000_000), buyPresets: field('buyPresets').value.split(',').map(value => value.trim()), sellPresets: field('sellPresets').value.split(',').map(value => Number(value.trim())), jupiterApiKey: field('jupiterApiKey').value.trim() });
    const origins = [`${new URL(settings.rpcUrl).origin}/*`, ...(settings.jupiterApiKey ? ['https://api.jup.ag/*'] : [])];
    if (!await browser.permissions.request({ origins })) throw new Error('Allow access to the selected RPC and router endpoints.');
    const response = await browser.runtime.sendMessage({ type: 'SETTINGS_SAVE', settings }) as WorkerResponse;
    if (!response.ok) throw new Error(response.error);
    status.textContent = 'Settings saved. Open trading panels have been updated.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not save settings.'; }
});
void load().catch(error => { status.textContent = String(error.message); });

document.querySelector<HTMLButtonElement>('#rpc-test')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true; status.textContent = 'Testing RPC account access…';
  try {
    const rpc = new URL(field('rpcUrl').value.trim());
    if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash) throw new Error('Enter a valid HTTPS RPC URL.');
    if (!await browser.permissions.request({ origins: [`${rpc.origin}/*`] })) throw new Error('Allow access to this RPC endpoint.');
    const response = await browser.runtime.sendMessage({ type: 'RPC_TEST', rpcUrl: rpc.href }) as WorkerResponse;
    if (!response.ok) throw new Error(response.error);
    status.textContent = 'RPC account access succeeded. Save to use this endpoint.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'RPC test failed.'; }
  finally { button.disabled = false; }
});

function updateLimits() { document.querySelector<HTMLElement>('#spend-limits')!.hidden = !field('spendLimitsEnabled').checked; }
field('spendLimitsEnabled').addEventListener('change', updateLimits);
