import { describe, expect, it } from 'vitest';
import { activeProfile, defaultPreferences, requiresTradeConfirmation, validatePreferencesLimits, validateTradingPreferences } from '../../src/pro/trading-preferences';

describe('Pro trading preferences', () => {
  it('uses explicit defaults and returns independent copies', () => {
    const initial = defaultPreferences(), valid = validateTradingPreferences(initial);
    expect(valid.confirmMarket).toBe(false); expect(valid.confirmLimit).toBe(true);
    valid.profiles[0]!.buyPresets[0] = '1'; expect(initial.profiles[0]!.buyPresets[0]).toBe('0.01');
    expect(() => validateTradingPreferences(undefined)).toThrow();
  });
  it('rejects corrupt confirmation settings rather than enabling instant orders', () => {
    for (const change of [{ confirmMarket: undefined }, { confirmLimit: 'false' }, { version: 2 }, { extra: true }]) {
      expect(() => validateTradingPreferences({ ...defaultPreferences(), ...change })).toThrow();
    }
  });
  it('validates profile counts, selection and unique identities', () => {
    const prefs = defaultPreferences(); prefs.profiles.push(structuredClone(prefs.profiles[0]!));
    expect(() => validateTradingPreferences(prefs)).toThrow('unique');
    expect(() => validateTradingPreferences({ ...defaultPreferences(), profiles: [] })).toThrow();
    expect(() => validateTradingPreferences({ ...defaultPreferences(), activeProfileId: 'missing' })).toThrow();
    expect(() => validateTradingPreferences({ ...defaultPreferences(), profiles: Array.from({ length: 9 }, (_, i) => ({ ...defaultPreferences().profiles[0]!, id: `p${i}` })) })).toThrow();
  });
  it('validates monetary precision, fee coverage, expiry and preset ranges', () => {
    for (const change of [{ buyPresets: ['0'] }, { buyPresets: ['0.0000000001'] }, { sellPresets: [0] }, { sellPresets: [25.5] }, { slippageBps: 2001 }, { priorityFeeLamports: -1 }, { maxNetworkLamports: '100000' }, { expiresHours: 721 }, { name: ' ' }]) {
      const prefs = defaultPreferences(); Object.assign(prefs.profiles[0]!, change); expect(() => validateTradingPreferences(prefs)).toThrow();
    }
    const prefs = defaultPreferences(); prefs.profiles[0]!.expiresHours = 1 / 60; expect(validateTradingPreferences(prefs)).toEqual(prefs);
  });
  it('rejects duplicate keys across buy and sell and non-character codes', () => {
    for (const code of ['Digit1', 'Space', 'KeyAA', '']) {
      const prefs = defaultPreferences(); prefs.sellKeys[0] = code; expect(() => validateTradingPreferences(prefs)).toThrow();
    }
  });
  it('applies confirmation flags only to new market and limit orders', () => {
    const prefs = defaultPreferences();
    expect(requiresTradeConfirmation('MARKET', prefs)).toBe(false); expect(requiresTradeConfirmation('LIMIT', prefs)).toBe(true);
    prefs.confirmLimit = false;
    expect(requiresTradeConfirmation('LIMIT', prefs)).toBe(false);
    for (const kind of ['BRACKET', 'TRAILING', 'STRATEGY', 'TAKE_PROFIT', 'STOP_LOSS'] as const) expect(requiresTradeConfirmation(kind, prefs)).toBe(true);
    for (const operation of ['edit', 'retry', 'cancel']) expect(requiresTradeConfirmation('MARKET', prefs, operation)).toBe(true);
  });
  it('enforces advertised limits without mutating the profile', () => {
    const profile = activeProfile(defaultPreferences());
    expect(() => validatePreferencesLimits(profile, { maxBuyLamports: '499999999', maxNetworkLamports: '5000000', dailyBuyLamports: '1' })).toThrow('buy limit');
    expect(() => validatePreferencesLimits(profile, { maxBuyLamports: '500000000', maxNetworkLamports: '4999999', dailyBuyLamports: '1' })).toThrow('Network');
    expect(() => validatePreferencesLimits(profile, { maxBuyLamports: '500000000', maxNetworkLamports: '5000000', dailyBuyLamports: '1' })).not.toThrow();
  });
});
