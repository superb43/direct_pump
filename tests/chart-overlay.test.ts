import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_CONTEXTS, TEST_MINT } from './fixtures/site-contexts';
import { targetKey } from '../src/sites/catalog';
import { overlayCommand, validOverlayCommand } from '../src/chart-overlay-contract';
import { chartBasis } from '../src/sites/charts';
import type { ChartEntry } from '../src/chart-entry';

const mocks = vi.hoisted(() => ({ hints: vi.fn(), binding: vi.fn() }));
vi.mock('../src/adapters', () => ({ readPageHints: mocks.hints }));
vi.mock('../src/sites/charts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/sites/charts')>();
  return { ...original, readChartBinding: mocks.binding };
});
import { createChartOverlay } from '../src/chart-overlay';
const entry: ChartEntry = { mint: TEST_MINT, wallet: 'private-wallet', priceUsd: '0.01', marketCapUsd: '10000000', supplyRaw: '1000000000000000', decimals: 6, balanceRaw: '200000000', updatedAt: 1000 };
const modeDocument = (selected?: string) => ({ querySelectorAll: () => selected ? [{ querySelectorAll: () => [{ textContent: selected }] }] : [] }) as unknown as Document;
const axiomDocument = (selected?: string) => ({ querySelectorAll: () => [{ querySelectorAll: () => ['MarketCap', 'Price'].map(textContent => ({ textContent, style: { color: textContent === selected ? 'rgb(82, 111, 255)' : 'rgb(200, 201, 209)' } })) }] }) as unknown as Document;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });
it('projects only display values and suppresses wrong mint/expired/future evidence', () => {
  const target = SITE_CONTEXTS[0]!.target;
  const command = overlayCommand(target, entry, 1000);
  expect(command.entry).toEqual({ mint: TEST_MINT, priceUsd: '0.01', marketCapUsd: '10000000' });
  expect(JSON.stringify(command)).not.toContain('private-wallet');
  expect(validOverlayCommand(command, 1000)).toBe(true);
  expect(overlayCommand(target, { ...entry, mint: 'other' }, 1000).entry).toBeNull();
  expect(overlayCommand(target, entry, 92000).entry).toBeNull();
  expect(overlayCommand(target, entry, 999).entry).toBeNull();
  expect(validOverlayCommand({ ...command, expiresAt: 999999 }, 1000)).toBe(false);
  expect(validOverlayCommand({ ...command, entry: { ...command.entry, priceUsd: 'Infinity' } }, 1000)).toBe(false);
});
it('uses verified GMGN symbol units and identity', () => {
  const target = SITE_CONTEXTS[0]!.target;
  expect(chartBasis('GMGN', `sol/${TEST_MINT}/USD/MCAP`, target, entry, modeDocument())).toBe('MC');
  expect(chartBasis('GMGN', `sol/${TEST_MINT}/USD/PRICE`, target, entry, modeDocument())).toBe('PRICE');
  expect(chartBasis('GMGN', `sol/${TEST_MINT}/SOL/MCAP`, target, entry, modeDocument())).toBeUndefined();
  expect(chartBasis('GMGN', 'sol/other/USD/MCAP', target, entry, modeDocument())).toBeUndefined();
});
it('pins Axiom pool and currency independently from mint identity', () => {
  const target = SITE_CONTEXTS.find(row => row.site === 'AXIOM')!.target;
  const ticker = `axiom-chart-v1|pair|sol|USD|1|${target.address}|`;
  expect(chartBasis('AXIOM', ticker, target, entry, axiomDocument('MarketCap'))).toBe('MC');
  expect(chartBasis('AXIOM', ticker.replace('|1|', '|7|'), target, entry, axiomDocument('Price'))).toBe('PRICE');
  expect(chartBasis('AXIOM', ticker.replace('|1|', '|23|'), target, entry, axiomDocument('MarketCap'))).toBe('MC');
  expect(chartBasis('AXIOM', ticker, target, entry, axiomDocument())).toBeUndefined();
  expect(chartBasis('AXIOM', ticker.replace('|USD|', '|SOL|'), target, entry, axiomDocument('MarketCap'))).toBeUndefined();
  expect(chartBasis('AXIOM', ticker.replace(target.address, 'other'), target, entry, axiomDocument('MarketCap'))).toBeUndefined();
});
it('uses the explicit FOMO toolbar mode and hides unrecognized modes', () => {
  const target = SITE_CONTEXTS.find(row => row.site === 'FOMO')!.target;
  expect(chartBasis('FOMO', `${TEST_MINT}:1399811149`, target, entry, modeDocument('MCap'))).toBe('MC');
  expect(chartBasis('FOMO', `${TEST_MINT}:42`, target, entry, modeDocument('Price'))).toBe('PRICE');
  expect(chartBasis('FOMO', `${TEST_MINT}:42`, target, entry, modeDocument())).toBeUndefined();
  expect(chartBasis('FOMO', 'other:42', target, entry, modeDocument('MCap'))).toBeUndefined();
});

describe.each(SITE_CONTEXTS)('$site owned line lifecycle', ({ target }) => {
  function setup() {
    let clock = 1000, url = target.pageUrl;
    const chart = { dataReady: vi.fn().mockReturnValue(true), createShape: vi.fn().mockResolvedValue('owned'), removeEntity: vi.fn(), getShapeById: vi.fn().mockReturnValue({}) };
    const frame = {};
    let binding = { chart, frame, symbol: 'current', basis: 'MC' };
    mocks.hints.mockReturnValue({ mintHint: target.mintHint, poolHint: target.poolHint });
    mocks.binding.mockImplementation(() => binding);
    const overlay = createChartOverlay({} as Document, () => url, () => clock);
    const command = { ...overlayCommand(target, entry, clock), key: targetKey(target) };
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return { overlay, command, chart, flush, setClock: (value: number) => { clock = value; }, setUrl: (value: string) => { url = value; }, setBinding: (next: typeof binding) => { binding = next; }, binding };
  }
  it('draws a dotted locked line, keeps one across zoom ticks, and removes only its own line', async () => {
    const { overlay, command, chart, flush } = setup();
    overlay.update(command); await flush(); await overlay.sync();
    expect(chart.createShape).toHaveBeenCalledOnce();
    expect(chart.createShape).toHaveBeenCalledWith({ price: 10000000 }, expect.objectContaining({ disableSave: true, disableSelection: true, lock: true, text: 'Avg Entry', overrides: expect.objectContaining({ linestyle: 1 }) }));
    overlay.update({ ...command, entry: null }); await flush();
    expect(chart.removeEntity).toHaveBeenCalledWith('owned');
    overlay.destroy();
  });
  it('moves to price units and survives a recreated chart without duplicates', async () => {
    const state = setup(); state.overlay.update(state.command); await state.flush();
    state.setBinding({ ...state.binding, basis: 'PRICE' }); await state.overlay.sync();
    expect(state.chart.removeEntity).toHaveBeenCalledWith('owned');
    expect(state.chart.createShape).toHaveBeenLastCalledWith({ price: 0.01 }, expect.anything());
    state.setBinding({ ...state.binding, frame: {} }); await state.overlay.sync();
    expect(state.chart.createShape).toHaveBeenCalledTimes(3); state.overlay.destroy();
  });
  it('clears expired leases, navigation, and hint drift', async () => {
    const state = setup(); state.overlay.update(state.command); await state.flush();
    state.setClock(state.command.expiresAt); await state.overlay.sync();
    expect(state.chart.removeEntity).toHaveBeenCalledOnce();
    state.setClock(1000); state.overlay.update(state.command); await state.flush();
    mocks.hints.mockReturnValue({ poolHint: 'changed' }); await state.overlay.sync();
    expect(state.chart.removeEntity).toHaveBeenCalledTimes(2);
    mocks.hints.mockReturnValue({ mintHint: target.mintHint, poolHint: target.poolHint });
    state.overlay.update(state.command); await state.flush(); state.setUrl('https://unsupported.test/'); await state.overlay.sync();
    expect(state.chart.removeEntity).toHaveBeenCalledTimes(3); state.overlay.destroy();
  });
  it('deletes a late creation after wallet/entry changes or teardown', async () => {
    const state = setup(); let resolve!: (id: string) => void;
    state.chart.createShape.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    state.overlay.update(state.command); await state.flush(); state.overlay.update({ ...state.command, entry: null });
    resolve('late'); await state.flush();
    expect(state.chart.removeEntity).toHaveBeenCalledWith('late');
    state.chart.createShape.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    state.overlay.update(state.command); await state.flush(); state.overlay.destroy(); resolve('late-destroy'); await state.flush();
    expect(state.chart.removeEntity).toHaveBeenCalledWith('late-destroy');
  });
  it('rejects a pending line when its axis or chart changes, including between ticks', async () => {
    const state = setup(); let resolve!: (id: string) => void;
    state.chart.createShape.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    state.overlay.update(state.command); await state.flush();
    state.setBinding({ ...state.binding, basis: 'PRICE' }); await state.overlay.sync();
    resolve('old-mc'); await state.flush(); expect(state.chart.removeEntity).toHaveBeenCalledWith('old-mc');
    await state.overlay.sync(); expect(state.chart.createShape).toHaveBeenLastCalledWith({ price: .01 }, expect.anything());
    state.chart.createShape.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    state.setBinding({ ...state.binding, frame: {} }); void state.overlay.sync(); await state.flush();
    state.setBinding({ ...state.binding, frame: {} }); resolve('old-frame'); await state.flush();
    expect(state.chart.removeEntity).toHaveBeenCalledWith('old-frame'); state.overlay.destroy();
  });
  it('waits for data and rejects the old token before starting a shape', async () => {
    const state = setup(); let ready!: (value: boolean) => void;
    state.chart.dataReady.mockImplementationOnce(() => new Promise(done => { ready = done; }));
    state.overlay.update(state.command); await state.flush(); expect(state.chart.createShape).not.toHaveBeenCalled();
    state.setUrl('https://unsupported.test/'); ready(true); await state.flush();
    expect(state.chart.createShape).not.toHaveBeenCalled(); state.overlay.destroy();
  });
  it('clears on history suspension and requires a fresh lease when restored', async () => {
    const state = setup(); state.overlay.update(state.command); await state.flush();
    state.overlay.reset(); await state.overlay.sync(); expect(state.chart.removeEntity).toHaveBeenCalledWith('owned');
    expect(state.chart.createShape).toHaveBeenCalledOnce();
    state.overlay.update(state.command); await state.flush(); expect(state.chart.createShape).toHaveBeenCalledTimes(2);
    state.overlay.destroy();
  });
  it('hides inaccessible charts and retries library failure without throwing', async () => {
    const state = setup(); mocks.binding.mockReturnValue(undefined);
    state.overlay.update(state.command); await state.flush(); expect(state.chart.createShape).not.toHaveBeenCalled();
    mocks.binding.mockReturnValue(state.binding); state.chart.createShape.mockRejectedValueOnce(new Error('loading'));
    await state.overlay.sync(); await state.overlay.sync(); expect(state.chart.createShape).toHaveBeenCalledTimes(2); state.overlay.destroy();
  });
});
