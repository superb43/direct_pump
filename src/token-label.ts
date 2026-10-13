export function cleanSymbol(symbol: string): string | undefined {
  const clean = symbol.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/^\$/, '').slice(0, 24);
  return clean || undefined;
}

