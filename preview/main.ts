import { mountPanel } from '../src/panel/panel';
import { DEFAULT_SETTINGS, type PageTarget, type WorkerResponse, type Receipt } from '../src/model';

let count = 0;
let current: Receipt | undefined;
let panel: ReturnType<typeof mountPanel> | undefined;
let target: PageTarget = { site: 'GMGN', kind: 'MINT', address: 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP', pageUrl: location.href };
const wallets = ['9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW', '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump'];
let walletIndex = 0;
function mount() {
  panel?.destroy();
  panel = mountPanel(target, async request => {
    const wallet = wallets[walletIndex]!;
    if (request.type === 'SAVINGS') return {ok:true,savings:{volumeUsdMicros:'0',savedUsdMicros:'0',verifiedTrades:0,pricedTrades:0,unpricedTrades:0,benchmarkBps:100}};
    if (request.type === 'SETTINGS_PUBLIC') return { ok: true, publicSettings: DEFAULT_SETTINGS };
    if (request.type === 'TOKEN_INFO') return { ok: true, token: { mint: target.address, venue: 'PUMP_CURVE', symbol: target.address.startsWith('DEW') ? 'SI' : 'TEST' } };
    if (request.type === 'CONNECT' || request.type === 'WALLET_RESTORE') return { ok: true, wallet };
    if (request.type === 'OPEN_SETTINGS') { document.querySelector('#settings-status')!.textContent = 'Settings requested from the panel.'; return { ok: true }; }
    if (request.type === 'STATUS') return { ok: true, receipt: current };
    if (request.type !== 'TRADE') return { ok: false, error: 'This request is not supported by the mock UI.' };
    count++; document.querySelector('#calls')!.textContent = `Trade requests: ${count}`;
    await new Promise(resolve => setTimeout(resolve, 700));
    const scenario = (document.querySelector('#scenario') as HTMLSelectElement).value;
    if (scenario === 'simulation') return { ok: false, error: 'Protocol error: MintDoesNotMatchBondingCurve (6004)', diagnostic: { stage: 'SIMULATION', code: 6004, instructionIndex: 2, error: '{"InstructionError":[2,{"Custom":6004}]}', logs: ['Program log: AnchorError. Error Code: MintDoesNotMatchBondingCurve. Error Number: 6004.', 'Program failed: custom program error: 0x1774'] } };
    current = { wallet, mint: request.target.address, venue: 'PUMP_CURVE', side: request.intent.side, pageUrl: request.target.pageUrl, message: '', blockhash: '', lastValidBlockHeight: 100, createdAt: Date.now(), status: scenario === 'confirmed' ? 'CONFIRMED' : scenario === 'rejected' ? 'FAILED' : 'UNKNOWN', error: scenario === 'rejected' ? 'Phantom approval was rejected.' : undefined };
    if (scenario === 'walletError') { current.status = 'FAILED'; current.error = 'Phantom rejected the transaction (-32003): Invalid transaction'; current.diagnostic = { stage: 'PHANTOM_REQUEST', code: -32003, error: 'Invalid transaction' }; }
    return { ok: true, receipt: current } satisfies WorkerResponse;
  }, { container: document.querySelector<HTMLElement>('#panel') ?? document.body });
}
document.querySelector('#navigate')!.addEventListener('click', () => { target = { ...target, address: target.address.startsWith('DEW') ? wallets[1]! : 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP' }; mount(); });
mount();

document.querySelector('#change-wallet')!.addEventListener('click', () => { walletIndex = 1 - walletIndex; });
