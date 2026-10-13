import { icon } from '../icons';
import { mountProSettings } from './settings-view';
import onboardingCss from './onboarding.css?inline';

// Set the owner's public channel before release. Never substitute an unrelated channel.
export const PRO_TELEGRAM_CHANNEL = 'https://t.me/+8DEJUy4u0sk3ZDNl';

export function mountProOnboarding(container: HTMLElement) {
  const id = `pro-setup-${crypto.randomUUID()}`;
  const host = document.createElement('div');
  host.innerHTML = `<style>${onboardingCss}</style><dialog class="pro-onboarding" aria-labelledby="${id}">
    <div class="pro-onboarding-head"><h2 id="${id}">Set up Pro</h2><button type="button" data-setup-close aria-label="Close Pro setup">${icon('x')}</button></div>
    <section data-setup-choices><p>Connect a server to place orders, use your wallet and save Pro settings. You can keep exploring without connecting.</p>
      <button type="button" class="pro-setup-choice" data-setup-self>${icon('settings')}<span><strong>Self-hosted server</strong><small>Build your own server and connect it here.</small></span></button>
      <button type="button" class="pro-setup-choice" data-setup-managed>${icon('orders')}<span><strong>Managed subscription</strong><small>Server setup handled for you · Coming soon</small></span></button>
      <button type="button" data-setup-explore>Keep exploring</button>
    </section>
    <section data-setup-managed-view hidden><h3>Managed Pro is coming soon</h3><p>Subscriptions are not available yet. Follow our Telegram channel for launch updates.</p><p>No payment or wallet connection is required.</p>
      ${PRO_TELEGRAM_CHANNEL ? `<a class="pro-telegram-link" href="${PRO_TELEGRAM_CHANNEL}" target="_blank" rel="noopener noreferrer">Open Telegram channel</a>` : '<p class="pro-channel-pending">Telegram channel link will be added before release.</p>'}
      <button type="button" data-setup-back>Back to setup options</button>
    </section>
    <section data-setup-self-view hidden><button type="button" data-setup-back>Back to setup options</button><div data-setup-connection></div></section>
  </dialog>`;
  container.append(host);
  const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
  const abort = new AbortController();
  let settings: ReturnType<typeof mountProSettings> | undefined;
  let opener: HTMLElement | undefined;
  let alive = true;
  function select(view: 'choices' | 'managed-view' | 'self-view') {
    for (const name of ['choices', 'managed-view', 'self-view']) host.querySelector<HTMLElement>(`[data-setup-${name}]`)!.hidden = name !== view;
    if (view === 'self-view' && !settings) settings = mountProSettings(host.querySelector<HTMLElement>('[data-setup-connection]')!);
    dialog.scrollTop = 0;
    if(dialog.open)host.querySelector<HTMLButtonElement>(view==='choices'?'[data-setup-self]':`[data-setup-${view}] [data-setup-back]`)!.focus();
  }
  function close() {
    dialog.close(); settings?.destroy(); settings = undefined;
    host.querySelector('[data-setup-connection]')!.replaceChildren();
    if (opener?.isConnected) opener.focus();
  }
  host.addEventListener('click', event => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    if (button.hasAttribute('data-setup-close') || button.hasAttribute('data-setup-explore')) close();
    else if (button.hasAttribute('data-setup-self')) select('self-view');
    else if (button.hasAttribute('data-setup-managed')) select('managed-view');
    else if (button.hasAttribute('data-setup-back')) select('choices');
  }, { signal: abort.signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal: abort.signal });
  return {
    open() {
      if (!alive || dialog.open) return;
      opener = (container.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | undefined;
      select('choices'); dialog.showModal();
      host.querySelector<HTMLButtonElement>('[data-setup-self]')!.focus();
    },
    destroy() { alive = false; abort.abort(); settings?.destroy(); if (dialog.open) dialog.close(); host.remove(); }
  };
}
