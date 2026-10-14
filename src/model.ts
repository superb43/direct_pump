export type SiteId = 'GMGN' | 'AXIOM' | 'FOMO';

export type PageTarget = {
  site: SiteId;
  address: string;
  kind: 'MINT' | 'POOL';
  pageUrl: string;
  poolHint?: string;
  mintHint?: string;
};

export type PageContext = { target: PageTarget | null; market?: MarketHint };

export type TradeIntent = { side: 'BUY'; sol: string } | { side: 'BUY'; amount: string; paymentMint: string } | { side: 'SELL'; percent: number };

export type Settings = {
  rpcUrl: string;
  priceWsUrl?: string;
  slippageBps: number;
  spendLimitsEnabled: boolean;
  maxBuySol: string;
  maxQuoteBuyAmount: string;
  priorityFeeLamports: number;
  buyPresets: string[];
  sellPresets: number[];
  jupiterApiKey: string;
};

export const DEFAULT_SETTINGS: Settings = {
  rpcUrl: 'https://solana-rpc.publicnode.com',
  slippageBps: 500,
  spendLimitsEnabled: false,
  maxBuySol: '1',
  maxQuoteBuyAmount: '1',
  priorityFeeLamports: 100_000,
  buyPresets: ['0.01', '0.05', '0.1', '0.25', '0.5', '1'],
  sellPresets: [25, 50, 75, 100],
  jupiterApiKey: '',
};

export type TokenInfo = { mint: string; symbol?: string; quoteMint?: string; quoteSymbol?: string; routeError?: string; venue?: Venue };
export type PublicSettings = Pick<Settings, 'buyPresets' | 'sellPresets' | 'slippageBps' | 'maxBuySol' | 'maxQuoteBuyAmount' | 'priorityFeeLamports'>;

export type Venue = 'PUMP_CURVE' | 'PUMP_SWAP' | 'RAYDIUM_LAUNCHLAB' | 'RAYDIUM_CPMM' | 'METEORA_DBC' | 'METEORA_DAMM' | 'JUPITER';
export type Receipt = {
  orderId?: string;
  frame?: { tabId: number; documentId: string };
  wallet: string;
  mint: string;
  symbol?: string;
  venue: Venue;
  side: 'BUY' | 'SELL';
  pageUrl: string;
  message: string;
  blockhash: string;
  lastValidBlockHeight: number;
  observedSlot?: number;
  confirmedSlot?: number;
  createdAt: number;
  status: 'SIGNING' | 'SUBMITTED' | 'UNKNOWN' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  signature?: string;
  error?: string;
  diagnostic?: TradeDiagnostic;
  inputAmount?: string;
  feeManifest?: ManifestInstruction[];
  feeReceipt?: FeeReceipt;
};

export type TradeDiagnostic = {
  stage: 'SIMULATION' | 'PHANTOM_PREPARE' | 'PHANTOM_REQUEST' | 'CHAIN';
  code?: string | number;
  instructionIndex?: number;
  program?: string;
  instruction?: string;
  error: string;
  logs?: string[];
};

export type WorkerRequest =
  | import('./pro/contracts').ProRequest
  | { type: 'DIAGNOSTICS'; action: 'EXPORT' | 'DEBUG' }
  | { type: 'CONNECT'; target: PageTarget }
  | { type: 'WALLET_RESTORE'; target: PageTarget }
  | { type: 'WALLET_SWITCH'; target: PageTarget }
  | { type: 'TOKEN_INFO'; target: PageTarget }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'HISTORY'; wallet?: string; mint?: string }
  | { type: 'PORTFOLIO'; wallet: string; refresh?: boolean }
  | { type: 'PORTFOLIO_PRICES'; wallet: string }
  | { type: 'POSITION'; target: PageTarget; wallet: string; market?: MarketHint; holdingsOnly?: boolean; refresh?: boolean }
  | { type: 'MARKET_UPDATE'; target: PageTarget; market?: MarketHint }
  | { type: 'TRADE'; target: PageTarget; wallet: string; intent: TradeIntent }
  | { type: 'STATUS'; wallet: string }
  | { type: 'SAVINGS' }
  | { type: 'VERIFY_FEES'; wallet: string; signature: string }
  | { type: 'SETTINGS_GET' }
  | { type: 'SETTINGS_PUBLIC' }
  | { type: 'RPC_TEST'; rpcUrl: string }
  | { type: 'SETTINGS_SAVE'; settings: Settings };

export type WorkerResponse =
  | { ok: true; data?: unknown; wallet?: string; receipt?: Receipt; settings?: Settings; publicSettings?: PublicSettings; token?: TokenInfo; savings?: Savings; receipts?: Receipt[]; position?: PositionSnapshot; portfolio?: PortfolioSnapshot }
  | { ok: false; error: string; diagnostic?: TradeDiagnostic };

export type ManifestInstruction = { program: string; accounts: string[]; data: string };
export type FeeAmount = { label: string; rawAmount: string; mint: string; decimals: number; symbol: string };
export type UsdSnapshot = { priceMicros: string; capturedAt: number; source: 'Coinbase spot' | 'Coinbase 1m candle' | 'Coinbase daily estimate' };
export type FeeReceipt = {
  auditVersion?: number;
  differences?: string[];
  tokenBeforeRaw?: string;
  tokenAfterRaw?: string;
  tokenDeltaRaw?: string;
  state: 'PENDING' | 'VERIFIED' | 'UNAVAILABLE' | 'MISMATCH';
  checkedAt: number;
  note: string;
  slot?: number;
  blockTime?: number;
  totalNetworkLamports?: string;
  priorityLamports?: string;
  baseNetworkLamports?: string;
  rentDepositedLamports?: string;
  rentRefundedLamports?: string;
  protocolFees: FeeAmount[];
  protocolBreakdownIncomplete: boolean;
  zeroExtraFeesVerified: boolean;
  terminalFeeLamports?: string;
  terminalFeeSource?: 'VERIFIED_PLAN' | 'USER_CONFIRMED';
  executionSucceeded?: boolean;
  executionError?: string;
  diagnostic?: TradeDiagnostic;
  volumeLamports?: string;
  volumeUsdMicros?: string;
  usd?: UsdSnapshot;
};
export type Savings = { volumeUsdMicros: string; savedUsdMicros: string; verifiedTrades: number; pricedTrades: number; unpricedTrades: number; benchmarkBps: 100 };
export type LedgerTrade = { signature: string; wallet: string; mint: string; side: 'BUY' | 'SELL'; createdAt: number; feeReceipt: FeeReceipt };

export type MarketHint = {mint:string;observedAt:number;priceUsd?:string;marketCapUsd?:string;source:'GMGN page'|'Axiom page'|'FOMO page'};
export type QuoteIssue = {kind:'RPC'|'ROUTE'|'USD';message:string;retryable:boolean;retryAt?:number;status?:number};
export type PositionSnapshot = {
 chartEntry?:import('./chart/chart-entry').ChartEntry;
 chartEntryNote?:string;
 wallet:string;mint:string;balanceRaw:string;decimals:number;supplyRaw:string;updatedAt:number;balanceUpdatedAt?:number;
 openedAt?:number;
 costBasisUsdMicros?:string;costBasisSolLamports?:string;
 costBasisEstimated?:boolean;
 expectedExitLamports?:string;exitNetworkLamports?:string;exitSetupLamports?:string;
 pricePool?:string;
 solUsd?:UsdSnapshot;market?:MarketHint;warning?:string;
 quoteIssue?:QuoteIssue;usdIssue?:QuoteIssue;
};

export type PriceMode = 'LIVE' | 'POLLING' | 'STALE';
export type PortfolioHolding = { mint: string; symbol?: string; pageUrl?: string; position?: PositionSnapshot; error?: string; pricingPending?: boolean; priceMode?: PriceMode; priceUpdatedAt?: number };
export type PortfolioSnapshot = { wallet: string; updatedAt: number; holdings: PortfolioHolding[]; balanceError?: string; nextRefreshAt?: number };
