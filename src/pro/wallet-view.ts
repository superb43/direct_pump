import bs58 from 'bs58';
import qrcode from 'qrcode-generator';
import { icon, solIcon } from '../ui/icons';

export function validDepositAddress(address: string): boolean {
  try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && bs58.decode(address).length === 32; }
  catch { return false; }
}

export function depositQrSvg(address: string): string {
  if (!validDepositAddress(address)) throw new Error('Server wallet address unavailable.');
  const code = qrcode(0, 'M');
  code.addData(address, 'Byte');
  code.make();
  return code.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

/** Local receive/withdraw navigation never remounts the withdrawal review. */
export function mountProWallet(container: HTMLElement, headerCopy: HTMLButtonElement, onSelect: () => void) {
  const id = `pro-wallet-${crypto.randomUUID()}`;
  container.innerHTML = `<h2>Wallet</h2>
    <div class="pro-segments pro-wallet-tabs" role="tablist" aria-label="Wallet actions">
      <button type="button" role="tab" data-wallet-view="deposit" id="${id}-deposit-tab" aria-controls="${id}-deposit" aria-selected="true">Deposit</button>
      <button type="button" role="tab" data-wallet-view="withdraw" id="${id}-withdraw-tab" aria-controls="${id}-withdraw" aria-selected="false" tabindex="-1">Withdraw</button>
    </div>
    <section data-deposit id="${id}-deposit" role="tabpanel" aria-labelledby="${id}-deposit-tab">
      <p class="pro-deposit-network">${solIcon()}<strong>SOL</strong><span>Solana network</span></p>
      <p class="pro-caption">Send SOL to your server wallet on Solana.</p>
      <div data-deposit-qr class="pro-deposit-qr" role="img" aria-label="Server wallet deposit QR code" hidden></div>
      <label class="pro-deposit-address">Deposit address<button type="button" data-copy-deposit disabled><span data-deposit-address>Loading server wallet…</span>${icon('copy')}</button></label>
      <p data-copy-status class="pro-copy-status" role="status" aria-live="polite"></p>
    </section>
    <section data-withdraw-pane id="${id}-withdraw" role="tabpanel" aria-labelledby="${id}-withdraw-tab" hidden><div data-withdraw-content></div></section>`;
  const node = <T extends HTMLElement = HTMLElement>(key: string) => container.querySelector<T>(`[data-${key}]`)!;
  const depositCopy = node<HTMLButtonElement>('copy-deposit');
  const abort = new AbortController();
  let alive = true, address = '', binding: string | undefined, generation = 0, copyTimer: number | undefined;
  let destination: 'deposit' | 'withdraw' = 'deposit';
  const resetFeedback = () => {
    if (copyTimer !== undefined) window.clearTimeout(copyTimer);
    copyTimer = undefined;
    headerCopy.querySelector('svg')?.replaceWith(svg('copy'));
    depositCopy.querySelector('svg')?.replaceWith(svg('copy'));
    node('copy-status').textContent = '';
    headerCopy.querySelector('[data-address]')!.textContent = address ? `${address.slice(0, 6)}…${address.slice(-6)}` : 'Unavailable';
    headerCopy.setAttribute('aria-label', address ? `Copy server wallet address ${address}` : 'Server wallet unavailable');
  };
  function svg(name: 'copy' | 'check') {
    const span = document.createElement('span'); span.innerHTML = icon(name);
    return span.firstElementChild!;
  }
  async function copy(button: HTMLButtonElement) {
    if (!alive || !address) return;
    const owner = generation, intended = address;
    try {
      await navigator.clipboard.writeText(intended);
      if (!alive || owner !== generation) return;
      resetFeedback(); button.querySelector('svg')?.replaceWith(svg('check'));
      node('copy-status').textContent = 'Copied';
      if (button === headerCopy) { headerCopy.setAttribute('aria-label', 'Server wallet address copied'); headerCopy.querySelector('[data-address]')!.textContent = 'Copied'; }
      copyTimer = window.setTimeout(resetFeedback, 1000);
    } catch {
      if (!alive || owner !== generation) return;
      resetFeedback();
      node('copy-status').textContent = 'Copy failed. Select the full deposit address and copy it.';
      headerCopy.setAttribute('aria-label', 'Copy failed. Open Wallet to copy the full deposit address.');
      if (button === headerCopy) headerCopy.querySelector('[data-address]')!.textContent = 'Copy failed';
    }
  }
  for (const button of [headerCopy, depositCopy]) button.addEventListener('click', () => void copy(button), { signal: abort.signal });
  function select(next: 'deposit' | 'withdraw', notify = false) {
    destination = next;
    node('deposit').hidden = next !== 'deposit'; node('withdraw-pane').hidden = next !== 'withdraw';
    container.querySelectorAll<HTMLButtonElement>('[data-wallet-view]').forEach(button => {
      const selected = button.dataset.walletView === next;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    if (notify) onSelect();
  }
  container.querySelectorAll<HTMLButtonElement>('[data-wallet-view]').forEach(button => {
    button.addEventListener('click', () => select(button.dataset.walletView as typeof destination, true), { signal: abort.signal });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'deposit' : event.key === 'End' ? 'withdraw' : destination === 'deposit' ? 'withdraw' : 'deposit';
      select(next, true); container.querySelector<HTMLButtonElement>(`[data-wallet-view=${next}]`)!.focus();
    }, { signal: abort.signal });
  });
  return {
    withdrawalVisible: () => destination === 'withdraw',
    showWithdraw() { select('withdraw'); },
    update(next?: { key: string; address: string }) {
      const nextAddress = next && validDepositAddress(next.address) ? next.address : '';
      const nextBinding = nextAddress ? next!.key : '';
      if (nextBinding === binding && nextAddress === address) return;
      generation++; binding = nextBinding; address = nextAddress; resetFeedback();
      headerCopy.disabled = depositCopy.disabled = !address;
      const shortened = address ? `${address.slice(0, 6)}…${address.slice(-6)}` : 'Unavailable';
      headerCopy.querySelector('[data-address]')!.textContent = shortened;
      headerCopy.title = address;
      node('deposit-address').textContent = address || 'Pair your server to load a deposit address.';
      node('deposit-qr').replaceChildren(); node('deposit-qr').hidden = !address;
      if (address) node('deposit-qr').innerHTML = depositQrSvg(address);
      select('deposit');
    },
    destroy() { alive = false; generation++; resetFeedback(); abort.abort(); }
  };
}
