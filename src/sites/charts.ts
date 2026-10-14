import type { PageTarget } from '../model';
import type { ChartOverlayEntry } from '../chart/chart-overlay-contract';

export type ChartEntityId = string;
export type ChartApi = {
  symbolExt(): { ticker?: string };
  dataReady(): boolean | Promise<boolean>;
  createShape(point: { price: number }, options: Record<string, unknown>): Promise<ChartEntityId | null> | ChartEntityId | null;
  removeEntity(id: ChartEntityId): void;
  getShapeById(id: ChartEntityId): { setPoints(points: { price: number }[]): void };
};
export type ChartBinding = { frame: HTMLIFrameElement; chart: ChartApi; symbol: string; basis: 'MC' | 'PRICE' };
type ChartWindow = Window & { tradingViewApi?: { activeChart(): ChartApi } };

/** Fixed, live-verified TradingView formats. Unknown currencies/modes fail closed. */
export function chartBasis(site: PageTarget['site'], ticker: string, target: PageTarget, entry: ChartOverlayEntry, frameDocument: Document): ChartBinding['basis'] | undefined {
  switch (site) {
    case 'GMGN': {
      const parts = /^sol\/([^/]+)\/USD\/(MCAP|PRICE)$/.exec(ticker);
      return parts?.[1] === entry.mint ? parts[2] === 'MCAP' ? 'MC' : 'PRICE' : undefined;
    }
    case 'AXIOM': {
      const parts = ticker.split('|');
      const pool = target.kind === 'POOL' ? target.address : target.poolHint;
      if (parts.length !== 7 || parts[0] !== 'axiom-chart-v1' || parts[1] !== 'pair' || parts[2] !== 'sol'
        || parts[3] !== 'USD' || parts[5] !== pool || !/^[0-9]+$/.test(parts[4]!)) return;
      // The numeric ticker field is a revision, not a market-cap flag.
      const controls = frameDocument.querySelectorAll('[title="Click toggle viewing market cap"]');
      if (controls.length !== 1) return;
      const labels = [...controls[0]!.querySelectorAll<HTMLSpanElement>('span')];
      if (labels.length !== 2 || labels[0]?.textContent?.trim() !== 'MarketCap' || labels[1]?.textContent?.trim() !== 'Price') return;
      // Axiom explicitly writes its selected toolbar label in this accent color.
      const selected = labels.filter(label => ['rgb(82, 111, 255)', '#526fff'].includes(label.style.color.toLowerCase()));
      if (selected.length !== 1) return;
      return selected[0]!.textContent?.trim() === 'MarketCap' ? 'MC' : 'PRICE';
    }
    case 'FOMO': {
      if (!new RegExp(`^${entry.mint}:[0-9]+$`).test(ticker)) return;
      // FOMO encodes mode in a hash; the toolbar explicitly marks the selected mode.
      const controls = frameDocument.querySelectorAll('[title="Toggle chart values between price and market cap"]');
      if (controls.length !== 1) return;
      const selected = controls[0]!.querySelectorAll('span');
      if (selected.length !== 1) return;
      const label = selected[0]!.textContent?.trim();
      return label === 'MCap' ? 'MC' : label === 'Price' ? 'PRICE' : undefined;
    }
  }
}
export function readChartBinding(document: Document, target: PageTarget, entry: ChartOverlayEntry): ChartBinding | undefined {
  const bindings: ChartBinding[] = [];
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[id^="tradingview_"]')) {
    try {
      const frameDocument = frame.contentDocument;
      const chart = (frame.contentWindow as ChartWindow | null)?.tradingViewApi?.activeChart();
      if (!frameDocument || !chart || typeof chart.dataReady !== 'function' || typeof chart.createShape !== 'function' || typeof chart.removeEntity !== 'function'
        || typeof chart.getShapeById !== 'function' || typeof chart.symbolExt !== 'function') continue;
      const symbol = chart.symbolExt().ticker;
      if (!symbol) continue;
      const basis = chartBasis(target.site, symbol, target, entry, frameDocument);
      if (basis) bindings.push({ frame, chart, symbol, basis });
    } catch { /* Cross-origin, loading or replaced charts remain unavailable. */ }
  }
  return bindings.length === 1 ? bindings[0] : undefined;
}
