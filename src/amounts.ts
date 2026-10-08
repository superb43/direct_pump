const U64_MAX = (1n << 64n) - 1n;

export function parseSol(value: string): bigint {
  return parseUnits(value, 9);
}

export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported asset decimals.');
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) {
    throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const lamports = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (lamports <= 0n || lamports > U64_MAX) throw new Error('Invalid trade amount.');
  return lamports;
}

export function sellAmount(balance: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new Error('Sell percentage must be a whole number from 1 to 100.');
  }
  const amount = balance * BigInt(percent) / 100n;
  if (amount <= 0n || amount > U64_MAX) throw new Error('No spendable token balance is available.');
  return amount;
}

export function minimumOutput(expected: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2_000) {
    throw new Error('Slippage must be between 0.01% and 20%.');
  }
  const minimum = expected * BigInt(10_000 - slippageBps) / 10_000n;
  if (minimum <= 0n) throw new Error('The amount is too small or liquidity is insufficient.');
  return minimum;
}
