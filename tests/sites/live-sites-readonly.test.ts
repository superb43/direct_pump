import { expect, it } from 'vitest';
import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { resolveExecution } from '../../src/execution';
import { detectPage } from '../../src/sites/catalog';
import { DEFAULT_SETTINGS } from '../../src/model';

// Explicit opt-in: public account reads only. Never constructs or sends a trade.
it.skipIf(process.env.DIRECT_PUMP_SITES_READONLY !== '1')('resolves the same SI token from all three site contexts on mainnet', async () => {
  const mint = 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP';
  const pool = 'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ';
  const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl, 'confirmed');
  const targets = [
    { ...detectPage(`https://gmgn.ai/sol/token/${mint}`)!, poolHint: pool },
    { ...detectPage(`https://axiom.trade/meme/${pool}?chain=sol`)!, mintHint: mint },
    detectPage(`https://fomo.family/tokens/solana/${mint}`)!,
  ];
  for (const target of targets) {
    const route = await resolveExecution(rpc, target);
    expect(route.mint.equals(new PublicKey(mint))).toBe(true);
    expect(route.quoteMint.equals(NATIVE_MINT)).toBe(true);
    expect(route.venue).toBe('JUPITER');
    console.info('SITE_IDENTITY_READONLY_PASS', { site: target.site, mint: route.mint.toBase58(), venue: route.venue });
  }
}, 30_000);
