import { icon } from '../ui/icons';
import { mountProSettings } from './settings-view';
import onboardingCss from './onboarding.css?inline';

export const PRO_TELEGRAM_CHANNEL = 'https://t.me/+7hhDF-MG724yYjg1';
export const PRO_SETUP_GUIDE = 'https://github.com/superb43/direct_pump/blob/main/Docs/PROJECT.md#pro-setup';

type SetupView = 'intro' | 'choices' | 'managed-view' | 'self-view';

export function mountProOnboarding(container: HTMLElement, options: { onExplore?: () => void } = {}) {
  const id = `pro-setup-${crypto.randomUUID()}`;
  const features = ['Instant Trade', 'Limit Orders', 'TP/SL & Trailing', 'Split Exit', 'Entry Protection', 'Background Orders', 'Chrome / Telegram Alerts'];
  const host = document.createElement('div');
  host.innerHTML = `<style>${onboardingCss}</style><dialog class="pro-onboarding" aria-labelledby="${id}">
    <div class="pro-onboarding-head"><h2 id="${id}">Set up Pro</h2><button type="button" data-setup-close aria-label="Close Pro setup">${icon('x')}</button></div>
    <section class="pro-intro" data-setup-intro hidden>
      <div class="pro-intro-scroll" tabindex="0" role="region" aria-label="Basic vs Pro comparison">
        <p>Pro runs reviewed orders on a separate server wallet.</p>
        <table class="pro-comparison"><caption>Basic vs Pro</caption><colgroup><col class="pro-comparison-feature"><col><col></colgroup>
          <thead><tr><th scope="col">Feature</th><th scope="col">Basic</th><th scope="col">Pro</th></tr></thead>
          <tbody>${features.map(feature => `<tr><th scope="row">${feature}</th><td><span role="img" aria-label="Not supported">❌</span></td><td><span role="img" aria-label="Supported">✅</span></td></tr>`).join('')}</tbody>
        </table>
        <p class="pro-comparison-note">Instant Trade skips a separate Phantom approval. Orders run while your server and signer are online.</p>
      </div>
      <button type="button" data-setup-next>Continue to setup</button>
    </section>
    <section data-setup-choices hidden><h3>Do you have your own server?</h3><p>Connect your own server, or follow managed Pro launch updates.</p>
      <button type="button" class="pro-setup-choice" data-setup-self>${icon('settings')}<span><strong>I have a server</strong><small>Read the setup guide and connect your server.</small></span></button>
      <button type="button" class="pro-setup-choice" data-setup-managed>${icon('orders')}<span><strong>I don’t have a server</strong><small>One-click Managed Pro · Coming soon</small></span></button>
      <button type="button" data-setup-explore>Explore Pro preview</button>
    </section>
    <section data-setup-managed-view hidden><h3>One-click Managed Pro is coming soon</h3><p>Launch updates will be announced in our Telegram channel.</p>
      <a class="pro-telegram-link" href="${PRO_TELEGRAM_CHANNEL}" target="_blank" rel="noopener noreferrer">Open Telegram channel</a>
      <button type="button" data-setup-back>Back to setup options</button>
    </section>
    <section data-setup-self-view hidden><h3>Connect your server</h3><p>Follow the guide to set up your server, then pair it here. Pairing does not start trading.</p>
      <a class="pro-setup-guide" href="${PRO_SETUP_GUIDE}" target="_blank" rel="noopener noreferrer">How to set up Pro ↗</a>
      <button type="button" data-setup-back>Back to setup options</button><div data-setup-connection></div>
    </section>
  </dialog>`;
  container.append(host);
  const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
  const abort = new AbortController();
  let settings: ReturnType<typeof mountProSettings> | undefined;
  let opener: HTMLElement | undefined;
  let alive = true;
  function focus(view: SetupView) {
    host.querySelector<HTMLElement>(view === 'intro' ? '.pro-intro-scroll' : view === 'choices' ? '[data-setup-self]' : `[data-setup-${view}] [data-setup-back]`)!.focus();
  }
  function select(view: SetupView) {
    for (const name of ['intro', 'choices', 'managed-view', 'self-view']) host.querySelector<HTMLElement>(`[data-setup-${name}]`)!.hidden = name !== view;
    dialog.classList.toggle('pro-onboarding-intro', view === 'intro');
    host.querySelector('h2')!.textContent = view === 'intro' ? 'What Pro adds' : 'Set up Pro';
    if (view === 'self-view' && !settings) settings = mountProSettings(host.querySelector<HTMLElement>('[data-setup-connection]')!);
    dialog.scrollTop = 0;
    host.querySelector<HTMLElement>('.pro-intro-scroll')!.scrollTop = 0;
    if (dialog.open) focus(view);
  }
  function close() {
    if (!dialog.open) return;
    dialog.close(); settings?.destroy(); settings = undefined;
    host.querySelector('[data-setup-connection]')!.replaceChildren();
    if (opener?.isConnected) opener.focus();
  }
  host.addEventListener('click', event => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    if (button.hasAttribute('data-setup-close')) close();
    else if (button.hasAttribute('data-setup-explore')) { close(); options.onExplore?.(); }
    else if (button.hasAttribute('data-setup-next')) select('choices');
    else if (button.hasAttribute('data-setup-self')) select('self-view');
    else if (button.hasAttribute('data-setup-managed')) select('managed-view');
    else if (button.hasAttribute('data-setup-back')) select('choices');
  }, { signal: abort.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: abort.signal });
  return {
    open(view: 'intro' | 'choices' = 'choices') {
      if (!alive || dialog.open) return;
      opener = (container.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | undefined;
      select(view); dialog.showModal(); focus(view);
    },
    close,
    destroy() { alive = false; abort.abort(); settings?.destroy(); if (dialog.open) dialog.close(); host.remove(); }
  };
}
