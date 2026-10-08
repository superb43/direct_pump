import { createWalletBridge } from '../src/wallet-bridge';

export default defineUnlistedScript(() => {
  // On-demand MAIN bridge: deserialize the prepared tx, then call Phantom.
  // Reuse pending calls so a restarted worker can inspect without re-signing.
  const previous = window.__directPumpWallet;
  if (previous?.version === 2) return;
  const next = createWalletBridge(() => window.phantom?.solana, () => location.href);
  window.__directPumpWallet = previous ? {
    ...next,
    inspect: id => next.inspect(id) ?? previous.inspect(id),
    send: id => next.inspect(id) ? next.send(id) : previous.send(id),
    cancelPrepared: id => next.inspect(id) ? next.cancelPrepared(id) : previous.cancelPrepared(id),
  } : next;
});
