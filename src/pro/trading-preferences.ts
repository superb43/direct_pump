import type { ProHealth, ProKind } from './contracts';

export type ProTradingProfile = {
  id: string; name: string; buyPresets: string[]; sellPresets: number[];
  slippageBps: number; priorityFeeLamports: number; maxNetworkLamports: string; expiresHours: number;
};
export type ProTradingPreferences = {
  version: 1; confirmMarket: boolean; confirmLimit: boolean;
  profiles: ProTradingProfile[]; activeProfileId: string; buyKeys: string[]; sellKeys: string[];
};

export function defaultPreferences(): ProTradingPreferences {
  return { version: 1, confirmMarket: false, confirmLimit: true, activeProfileId: 'default',
    profiles: [{ id: 'default', name: 'Default', buyPresets: ['0.01', '0.05', '0.1', '0.5'], sellPresets: [25, 50, 75, 100],
      slippageBps: 100, priorityFeeLamports: 100_000, maxNetworkLamports: '5000000', expiresHours: 24 }],
    buyKeys: Array.from({ length: 8 }, (_, i) => `Digit${i + 1}`),
    sellKeys: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF'] };
}

function fields(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
export function solToLamports(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,9})?$/.test(value)) throw new Error('SOL amount must have at most nine decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const raw = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (raw > 18_446_744_073_709_551_615n) throw new Error('SOL amount is too large.');
  return raw;
}
export function validateTradingPreferences(value: unknown): ProTradingPreferences {
  const p = fields(value, ['version', 'confirmMarket', 'confirmLimit', 'profiles', 'activeProfileId', 'buyKeys', 'sellKeys'], 'trading preferences');
  if (p.version !== 1 || typeof p.confirmMarket !== 'boolean' || typeof p.confirmLimit !== 'boolean') throw new Error('Invalid trading confirmation settings.');
  if (!Array.isArray(p.profiles) || p.profiles.length < 1 || p.profiles.length > 8) throw new Error('Use one to eight profiles.');
  const ids = new Set<string>();
  for (const value of p.profiles) {
    const row = fields(value, ['id', 'name', 'buyPresets', 'sellPresets', 'slippageBps', 'priorityFeeLamports', 'maxNetworkLamports', 'expiresHours'], 'profile') as unknown as ProTradingProfile;
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id)) throw new Error('Profile IDs must be unique.');
    ids.add(row.id);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name !== row.name.trim() || row.name.length > 32) throw new Error('Profile name must be one to 32 characters.');
    if (!Array.isArray(row.buyPresets) || row.buyPresets.length < 1 || row.buyPresets.length > 8 || row.buyPresets.some(amount => typeof amount !== 'string' || solToLamports(amount) <= 0n)) throw new Error('Use one to eight positive SOL buy presets.');
    if (!Array.isArray(row.sellPresets) || row.sellPresets.length < 1 || row.sellPresets.length > 8 || row.sellPresets.some(n => !Number.isInteger(n) || n < 1 || n > 100)) throw new Error('Use one to eight sell percentages from 1 to 100.');
    if (!Number.isInteger(row.slippageBps) || row.slippageBps < 1 || row.slippageBps > 2000) throw new Error('Slippage must be 0.01% to 20%.');
    if (!Number.isSafeInteger(row.priorityFeeLamports) || row.priorityFeeLamports < 0 || row.priorityFeeLamports > 10_000_000) throw new Error('Invalid priority fee.');
    if (typeof row.maxNetworkLamports !== 'string' || !/^[1-9][0-9]{0,19}$/.test(row.maxNetworkLamports) || BigInt(row.maxNetworkLamports) > 18_446_744_073_709_551_615n || BigInt(row.maxNetworkLamports) < BigInt(row.priorityFeeLamports) + 5000n) throw new Error('Network budget cannot cover the selected fee.');
    if (!Number.isFinite(row.expiresHours) || row.expiresHours < 1 / 60 || row.expiresHours > 720 || !Number.isSafeInteger(row.expiresHours * 3_600_000)) throw new Error('Expiry must be one minute to 30 days.');
  }
  if (typeof p.activeProfileId !== 'string' || !ids.has(p.activeProfileId)) throw new Error('Select an existing profile.');
  const keys = new Set<string>();
  for (const list of [p.buyKeys, p.sellKeys]) {
    if (!Array.isArray(list) || list.length !== 8) throw new Error('Assign eight keys per side.');
    for (const code of list) {
      if (typeof code !== 'string' || !/^(?:Digit[0-9]|Key[A-Z])$/.test(code) || keys.has(code)) throw new Error('Hotkeys must be unique letters or digits.');
      keys.add(code);
    }
  }
  return structuredClone(p) as ProTradingPreferences;
}
export function activeProfile(prefs: ProTradingPreferences): ProTradingProfile {
  const profile = prefs.profiles.find(row => row.id === prefs.activeProfileId);
  if (!profile) throw new Error('Selected profile is unavailable.');
  return profile;
}
export function requiresTradeConfirmation(kind: ProKind, prefs: ProTradingPreferences, operation = 'create'): boolean {
  return operation !== 'create' || (kind === 'MARKET' ? prefs.confirmMarket : kind === 'LIMIT' ? prefs.confirmLimit : true);
}
export function validatePreferencesLimits(profile: ProTradingProfile, limits?: ProHealth['limits']): void {
  if (!limits) return;
  if (profile.buyPresets.some(amount => solToLamports(amount) > BigInt(limits.maxBuyLamports))) throw new Error('Buy preset exceeds the server buy limit.');
  if (BigInt(profile.maxNetworkLamports) > BigInt(limits.maxNetworkLamports)) throw new Error('Network budget exceeds the server limit.');
}
