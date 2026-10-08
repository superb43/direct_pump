import { expect, it } from 'vitest';
import { bindPanelRequest } from '../src/panel-relay';
import { DEFAULT_SETTINGS, type PageTarget } from '../src/model';
import { validateSettings } from '../src/settings';

const target: PageTarget = { site: 'GMGN', kind: 'MINT', address: 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP', pageUrl: 'https://gmgn.ai/sol/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP' };
it('keeps toolbar trade requests bound to the current token and canonical page context', () => {
  const request = { type: 'TRADE' as const, target: { ...target, pageUrl: 'https://gmgn.ai/stale' }, wallet: 'wallet', intent: { side: 'BUY' as const, sol: '0.1' } };
  expect(bindPanelRequest(request, target)).toEqual({ ...request, target });
  expect(() => bindPanelRequest(request, { ...target, address: 'another-mint' })).toThrow('page changed');
  expect(() => bindPanelRequest(request, null)).toThrow('supported token page');
});
it('blocks private settings and arbitrary requests through the toolbar relay', () => {
  expect(() => bindPanelRequest({ type: 'SETTINGS_GET' }, target)).toThrow();
  expect(() => bindPanelRequest({ type: 'SETTINGS_SAVE', settings: DEFAULT_SETTINGS }, target)).toThrow();
  expect(() => bindPanelRequest({ type: 'RPC_TEST', rpcUrl: DEFAULT_SETTINGS.rpcUrl }, target)).toThrow();
});
it('migrates old settings to optional limits disabled and preserves explicit opt-in', () => {
  const { spendLimitsEnabled: _, ...legacy } = DEFAULT_SETTINGS;
  expect(validateSettings(legacy).spendLimitsEnabled).toBe(false);
  expect(validateSettings({ ...legacy, spendLimitsEnabled: true }).spendLimitsEnabled).toBe(true);
  expect(() => validateSettings({ ...legacy, spendLimitsEnabled: 'yes' })).toThrow();
});

it('rejects changed pool or mint hints even when the page URL address is unchanged', () => {
  const axiom: PageTarget = {site:'AXIOM',kind:'POOL',address:'AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ',mintHint:target.address,pageUrl:'https://axiom.trade/meme/AG1EhPjsBrkxQWkViuLXF6pQnHwfr9f9sdNneeoykcEJ?chain=sol'};
  const request={type:'TRADE' as const,target:axiom,wallet:'wallet',intent:{side:'BUY' as const,sol:'0.1'}};
  expect(()=>bindPanelRequest(request,{...axiom,mintHint:'So11111111111111111111111111111111111111112'})).toThrow('page changed');
  expect(()=>bindPanelRequest({...request,target:{...target,poolHint:'spoofed'}},target)).toThrow('page changed');
});
