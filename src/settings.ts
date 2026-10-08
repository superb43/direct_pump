import { parseSol } from './amounts';
import { DEFAULT_SETTINGS, type Settings } from './model';

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const settings = value as Settings;
  if (typeof settings.rpcUrl !== 'string' || typeof settings.maxBuySol !== 'string') throw new Error('Invalid settings.');
  const rpc = new URL(settings.rpcUrl);
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash) {
    throw new Error('RPC must be an HTTPS URL without embedded username, password or fragment.');
  }
  if (!Number.isInteger(settings.slippageBps) || settings.slippageBps < 1 || settings.slippageBps > 2_000) {
    throw new Error('Slippage must be between 0.01% and 20%.');
  }
  if (parseSol(settings.maxBuySol) > 10_000_000_000n) throw new Error('Maximum buy cannot exceed 10 SOL.');
  if (!Number.isSafeInteger(settings.priorityFeeLamports) || settings.priorityFeeLamports < 0 || settings.priorityFeeLamports > 10_000_000) {
    throw new Error('Priority fee must be between 0 and 0.01 SOL.');
  }
  const spendLimitsEnabled = settings.spendLimitsEnabled ?? false;
  if (typeof spendLimitsEnabled !== 'boolean') throw new Error('Invalid spend limit setting.');
  const buyPresets = settings.buyPresets ?? DEFAULT_SETTINGS.buyPresets;
  const sellPresets = settings.sellPresets ?? DEFAULT_SETTINGS.sellPresets;
  const jupiterApiKey = settings.jupiterApiKey ?? '';
  const maxQuoteBuyAmount = settings.maxQuoteBuyAmount ?? DEFAULT_SETTINGS.maxQuoteBuyAmount;
  if (typeof maxQuoteBuyAmount !== 'string' || parseSol(maxQuoteBuyAmount) > 1_000_000_000_000_000n) throw new Error('Maximum quote-asset buy must be positive and at most 1,000,000 units.');
  if (!Array.isArray(buyPresets) || !buyPresets.length || buyPresets.length > 8 || buyPresets.some(amount => typeof amount !== 'string' || parseSol(amount) > 10_000_000_000n)) throw new Error('Buy presets must contain 1–8 positive amounts of at most 10 SOL.');
  if (new Set(buyPresets).size !== buyPresets.length) throw new Error('Buy presets must be unique.');
  if (!Array.isArray(sellPresets) || !sellPresets.length || sellPresets.length > 8 || sellPresets.some(percent => !Number.isInteger(percent) || percent < 1 || percent > 100)) throw new Error('Sell presets must contain 1–8 whole percentages from 1 to 100.');
  if (new Set(sellPresets).size !== sellPresets.length) throw new Error('Sell presets must be unique.');
  if (typeof jupiterApiKey !== 'string' || jupiterApiKey.length > 256 || /\s/.test(jupiterApiKey)) throw new Error('The Jupiter API key is invalid.');
  return { spendLimitsEnabled, rpcUrl: rpc.href, maxBuySol: settings.maxBuySol, maxQuoteBuyAmount, slippageBps: settings.slippageBps, priorityFeeLamports: settings.priorityFeeLamports, buyPresets: [...buyPresets], sellPresets: [...sellPresets], jupiterApiKey };
}
