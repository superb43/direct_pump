import type { WorkerRequest } from './model';
import type { ChartOverlayCommand } from './chart-overlay-contract';

type Access = 'PAGE_TARGET' | 'PANEL_PUBLIC' | 'SETTINGS_PRIVATE' | 'DASHBOARD_PRIVATE' | 'PORTFOLIO_PRIVATE' | 'PRO_PRIVATE';
// One policy table governs both the content relay and the worker sender checks.
const REQUESTS = {
  PRO: { access: 'PRO_PRIVATE', panel: false },
  DIAGNOSTICS: { access: 'PRO_PRIVATE', panel: false },
  CONNECT: { access: 'PAGE_TARGET', panel: true },
  WALLET_RESTORE: { access: 'PAGE_TARGET', panel: true },
  WALLET_SWITCH: { access: 'PAGE_TARGET', panel: true },
  TOKEN_INFO: { access: 'PAGE_TARGET', panel: true },
  POSITION: { access: 'PAGE_TARGET', panel: true },
  TRADE: { access: 'PAGE_TARGET', panel: true },
  MARKET_UPDATE: { access: 'PAGE_TARGET', panel: false },
  OPEN_SETTINGS: { access: 'PANEL_PUBLIC', panel: true },
  OPEN_DASHBOARD: { access: 'PANEL_PUBLIC', panel: true },
  STATUS: { access: 'PANEL_PUBLIC', panel: true },
  SAVINGS: { access: 'PANEL_PUBLIC', panel: true },
  VERIFY_FEES: { access: 'PANEL_PUBLIC', panel: true },
  SETTINGS_PUBLIC: { access: 'PANEL_PUBLIC', panel: true },
  SETTINGS_GET: { access: 'SETTINGS_PRIVATE', panel: false },
  SETTINGS_SAVE: { access: 'SETTINGS_PRIVATE', panel: false },
  RPC_TEST: { access: 'SETTINGS_PRIVATE', panel: false },
  HISTORY: { access: 'DASHBOARD_PRIVATE', panel: false },
  PORTFOLIO: { access: 'PORTFOLIO_PRIVATE', panel: false },
  PORTFOLIO_PRICES: { access: 'PORTFOLIO_PRIVATE', panel: false },
} as const satisfies Record<WorkerRequest['type'], { access: Access; panel: boolean }>;

export function requestPolicy(type: unknown): { access: Access; panel: boolean } | undefined {
  return typeof type === 'string' && Object.hasOwn(REQUESTS, type) ? REQUESTS[type as keyof typeof REQUESTS] : undefined;
}

export type PanelMessage = { type: 'PANEL_CONTEXT' } | { type: 'PANEL_REQUEST'; request: WorkerRequest }
  | { type: 'PANEL_CHART_ENTRY'; command: ChartOverlayCommand };
