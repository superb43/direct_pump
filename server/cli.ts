import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from '../src/model';
import { positiveRaw, type ProHealth } from '../src/pro/contracts';
import { createKeystore, keystoreWallet, backupKeystore, unlockKeystore } from './keystore';
import { SignerClient, startSignerDaemon, type SignerConfig } from './signer';
import { ProStore } from './store';
import { ProEngine } from './engine';
import { RpcMarket, httpsUrl } from './market';
import { createProServer } from './api';
import { TelegramOutbox } from './notify';
import { WithdrawalService } from './withdrawal-service';
import { watchWalletBalance } from './wallet-events';
export function installSignerShutdown(daemon: { authority: { lock(): void }; close(): Promise<void> }, runtime: Pick<NodeJS.Process, 'once' | 'exit'> = process): void {
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        daemon.authority.lock();
        void daemon.close().then(() => runtime.exit(0), () => runtime.exit(1));
    };
    runtime.once('SIGINT', stop);
    runtime.once('SIGTERM', stop);
}
type Config = {
    serverId: string;
    rpcUrl: string;
    wallet: string;
    port: number;
    limits: ProHealth['limits'];
    signerStateDir: string;
    socketPath: string;
    adminSocketPath: string;
    backupVerified: boolean;
    backupHash: string;
};
function args() {
    const argv = process.argv.slice(2), command = argv.shift() ?? 'help';
    const options = new Map<string, string>();
    while (argv.length) {
        const k = argv.shift()!, v = argv.shift();
        if (!k.startsWith('--') || !v || v.startsWith('--'))
            throw new Error(`Missing value for ${k}`);
        options.set(k.slice(2), v);
    }
    return { command, options };
}
async function password(prompt: string) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error('Password input requires an interactive TTY.');
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    return new Promise<string>((resolve, reject) => {
        let value = '';
        const restore = () => { process.stdin.off('data', data); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
        const data = (bytes: Buffer) => {
            for (const c of bytes.toString('utf8')) {
                if (c === '\u0003') {
                    restore();
                    reject(new Error('Cancelled.'));
                    return;
                }
                if (c === '\r' || c === '\n') {
                    restore();
                    resolve(value);
                    return;
                }
                if (c === '\u007f' || c === '\b')
                    value = value.slice(0, -1);
                else if (c >= ' ')
                    value += c;
            }
        };
        process.stdin.on('data', data);
    });
}
function signerConfig(dir: string, config: Config): SignerConfig { const privateDir = config.signerStateDir ?? dir; return { serverId: config.serverId, socketPath: config.socketPath ?? join(privateDir, 'signer.sock'), adminSocketPath: config.adminSocketPath ?? join(privateDir, 'admin.sock'), keystorePath: join(privateDir, 'key.enc'), authPath: join(privateDir, 'auth.sqlite'), journalPath: join(privateDir, 'signer.sqlite'), rpcUrl: config.rpcUrl, settings: { ...DEFAULT_SETTINGS, rpcUrl: config.rpcUrl, jupiterApiKey: process.env.DP_JUPITER_API_KEY ?? '' }, limits: config.limits }; }
export function startServiceLoops(engine: Pick<ProEngine, 'tick'>, notify: Pick<TelegramOutbox, 'flush'>, store: Pick<ProStore, 'diagnostics'>, withdrawals?: Pick<WithdrawalService, 'poll'>) {
    let running = false, lastFailure = 0;
    const engineTimer = setInterval(async () => { if (running)
        return; running = true; try {
        await engine.tick();
    }
    catch {
        if (Date.now() - lastFailure >= 60000) {
            lastFailure = Date.now();
            store.diagnostics.log({ component: 'engine', type: 'engine.operation.failed', level: 'error', code: 'BACKGROUND_OPERATION_FAILED' });
        }
    }
    finally {
        running = false;
    } }, 500);
    const deliveryTimer = setInterval(() => { void notify.flush(); }, 2000);
    const withdrawalTimer = withdrawals ? setInterval(() => { void withdrawals.poll(); }, 1000) : undefined;
    return () => { clearInterval(engineTimer); clearInterval(deliveryTimer); if (withdrawalTimer) clearInterval(withdrawalTimer); };
}
export async function main() {
    process.umask(0o077);
    const { command, options } = args();
    const dir = resolve(options.get('state-dir') ?? './pro-state'), path = join(dir, 'config.json');
    if (command === 'help') {
        console.log('Pro Node24 server: setup --state-dir DIR --backup-file FILE --rpc-url HTTPS --max-buy-lamports N --daily-buy-lamports N --max-network-lamports N [--port 8788] [--signer-state-dir PRIVATE_DIR --socket-path SHARED_SOCKET --admin-socket-path PRIVATE_SOCKET]; signer; unlock; lock; pair-code; revoke --device-id ID; serve; pause. Server binds 127.0.0.1; expose only behind HTTPS reverse proxy.');
        return;
    }
    if (command === 'setup') {
        if (existsSync(path))
            throw new Error('State already configured.');
        const backupArgument = options.get('backup-file');
        if (!backupArgument)
            throw new Error('An encrypted backup file is required.');
        const backupFile = resolve(backupArgument), signerStateDir = resolve(options.get('signer-state-dir') ?? dir), socketPath = resolve(options.get('socket-path') ?? join(signerStateDir, 'signer.sock')), adminSocketPath = resolve(options.get('admin-socket-path') ?? join(signerStateDir, 'admin.sock'));
        if (signerStateDir !== dir && existsSync(join(signerStateDir, 'config.json')))
            throw new Error('Signer state is already configured; copy its public configuration into the separate API state directory.');
        if (backupFile === join(signerStateDir, 'key.enc') || existsSync(backupFile))
            throw new Error('Choose a new separate encrypted backup file.');
        const rpcUrl = httpsUrl(options.get('rpc-url') ?? '');
        const limits = { maxBuyLamports: positiveRaw(options.get('max-buy-lamports'), 'Maximum buy cap'), dailyBuyLamports: positiveRaw(options.get('daily-buy-lamports'), 'Daily buy cap'), maxNetworkLamports: positiveRaw(options.get('max-network-lamports'), 'Network cap') };
        if (BigInt(limits.maxBuyLamports) > BigInt(limits.dailyBuyLamports) || BigInt(limits.maxNetworkLamports) < 5000n)
            throw new Error('Invalid risk caps.');
        const port = Number(options.get('port') ?? 8788);
        if (!Number.isInteger(port) || port < 1024 || port > 65535)
            throw new Error('Invalid port.');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        mkdirSync(signerStateDir, { recursive: true, mode: 0o700 });
        chmodSync(signerStateDir, 0o700);
        const pass = await password('New keystore password: '), confirm = await password('Confirm password: ');
        if (pass !== confirm)
            throw new Error('Passwords differ.');
        if (existsSync(join(signerStateDir, 'key.enc'))) {
            const recovered = await unlockKeystore(join(signerStateDir, 'key.enc'), pass);
            recovered.secretKey.fill(0);
        }
        else
            await createKeystore(join(signerStateDir, 'key.enc'), pass);
        const backupHash = await backupKeystore(join(signerStateDir, 'key.enc'), backupFile);
        const actualHash = createHash('sha256').update(readFileSync(backupFile)).digest('hex');
        if (actualHash !== backupHash)
            throw new Error('Encrypted backup verification failed.');
        const config: Config = { serverId: randomUUID(), rpcUrl, wallet: await keystoreWallet(join(signerStateDir, 'key.enc')), port, limits, signerStateDir, socketPath, adminSocketPath, backupVerified: true, backupHash };
        writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
        if (signerStateDir !== dir)
            writeFileSync(join(signerStateDir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
        console.log(`Configured server ${config.serverId}; wallet ${config.wallet}. Fund this wallet separately. Encrypted backup verified. Signer remains locked.`);
        console.log(`For separate OS users: keep ${signerStateDir} owned by signer with mode 0700; copy only config.json into the API user state directory. Use a signer-owned shared socket directory with mode 0750 and API group traversal/connect access; API must have no directory write permission. Run signer with --state-dir ${signerStateDir} and serve with the separate API --state-dir. Admin socket stays private.`);
        return;
    }
    const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
    httpsUrl(config.rpcUrl);
    if (config.backupVerified !== true || !/^[a-f0-9]{64}$/.test(config.backupHash ?? ''))
        throw new Error('A verified encrypted backup is required before starting this server.');
    const sc = signerConfig(dir, config), client = new SignerClient(sc.socketPath, sc.adminSocketPath);
    if (command === 'signer') {
        const daemon = await startSignerDaemon(sc);
        installSignerShutdown(daemon);
        console.log('Signer daemon started locked.');
        return;
    }
    if (command === 'unlock') {
        await client.unlock(await password('Keystore password: '));
        console.log('Signer unlocked. Explicitly resume engine from paired device.');
        return;
    }
    if (command === 'lock' || command === 'pause') {
        await client.lock();
        console.log('Signer locked; automated signing paused.');
        return;
    }
    if (command === 'pair-code') {
        const result = await client.issuePairCode();
        console.log(JSON.stringify(result));
        return;
    }
    if (command === 'revoke') {
        await client.revoke(options.get('device-id') ?? '');
        console.log('Device revoked.');
        return;
    }
    if (command !== 'serve')
        throw new Error('Unknown command.');
    const connection = new Connection(config.rpcUrl, 'confirmed'), wallet = new PublicKey(config.wallet);
    const store = new ProStore(join(dir, 'engine.sqlite')), market = new RpcMarket(connection, wallet,fetch,true), engine = new ProEngine(store, market, client, config.wallet, config.limits), notify = new TelegramOutbox(store);
    market.onInvalidated=()=>{void engine.tick().catch(()=>{store.diagnostics.log({level:'error',component:'engine',type:'engine.invalidated.failed'});});};
    market.onStreamError=error=>store.diagnostics.log({level:'warn',component:'market',type:'price.watch.failed',details:{error}});
    const server = createProServer(engine, client, config.serverId);
    server.listen(config.port, '127.0.0.1', () => console.log(`Pro API listening on 127.0.0.1:${config.port}; engine recovering.`));
    const stopWalletBalance = watchWalletBalance(connection, wallet, store);
    const stopLoops = startServiceLoops(engine, notify, store, new WithdrawalService(client, store));
    const watchTimer=setInterval(()=>market.retainWatches(engine.state==='RUNNING'?store.orders().filter(order=>order.state==='OPEN'||order.state==='BLOCKED'&&!order.pendingAction).map(order=>order.spec):[]),1000);
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        const walletStopped = stopWalletBalance();
        stopLoops();clearInterval(watchTimer);market.close();
        server.close(() => { void walletStopped.then(() => { store.close(); process.exit(0); }); });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}
if (process.argv[1]?.endsWith('cli.mjs') || process.argv[1]?.endsWith('cli.ts'))
    main().catch(() => { console.error('Command failed. Check configuration, local file permissions and signer availability.'); process.exitCode = 1; });
