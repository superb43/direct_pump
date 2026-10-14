import {validateProSpecV2} from '../src/pro/contracts';
import { createServer, type IncomingMessage } from 'node:http';
import { canonicalJson, type AuthProof, type ProBalance } from '../src/pro/contracts';
import type { ProEngine } from './engine';
import { sanitizeDiagnostic } from '../src/diagnostics/diagnostics';
import { SOL } from './store';
import {readProChartEntry} from './chart-entry';
import {portfolioConnection,readProPortfolio} from './pro-portfolio';
import {previewRecoverInitials} from './recover-initials';
export interface ApiAuth {
    verify(proof: AuthProof): Promise<string>;
    active?(deviceId:string):Promise<boolean>;
    capabilities?(): Promise<string[]>;
    withdrawal?(method: string, proof?: AuthProof): Promise<unknown>;
    walletBalances?(mint: string): Promise<ProBalance[]>;
    pair(code: string, key: string): Promise<{
        deviceId: string;
        serverId: string;
    }>;
}
const readBody = async (req: IncomingMessage) => {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 16384)
            throw new Error('Request too large.');
    }
    return { raw: text, body: text ? JSON.parse(text) : {} };
};
export function createProServer(engine: ProEngine, auth: ApiAuth, serverId: string) {
    let streamCount=0;
    const capabilities = async (): Promise<string[]> => {
        const chartCapabilities=portfolioConnection(engine)?['chart-entry-v1','portfolio-v1']:[];
        if (!auth.capabilities) return [...chartCapabilities,...(auth.withdrawal ? ['withdrawals-v1'] : [])];
        try {
            const values = await auth.capabilities();
            const signerCaps=Array.isArray(values)?values.filter(v=>['mc-orders-v2','exit-strategies-v2'].includes(v)||v==='withdrawals-v1'&&!!auth.withdrawal):[];
            return [...chartCapabilities,...signerCaps,...(chartCapabilities.includes('portfolio-v1')&&signerCaps.includes('mc-orders-v2')?['recover-initials-preview-v1']:[])];
        } catch {
            engine.store?.diagnostics.log({ component: 'api', type: 'signer.capabilities.unavailable', level: 'warn', code: 'SIGNER_CAPABILITY_UNAVAILABLE' });
            return chartCapabilities;
        }
    };
    const capabilityFields = async () => { const values = await capabilities(); return values.length ? { capabilities: values } : {}; };
    return createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-content-type-options', 'nosniff');
        const started = Date.now();
        let requestId: string | undefined, orderId: string | undefined;
        const diagnostics = engine.store?.diagnostics;
        try {
            const method = req.method ?? 'GET', url = new URL(req.url ?? '/', 'http://localhost'), path = url.pathname;
            const parsed = await readBody(req), body = parsed.body;
            let data: unknown;
            if (path === '/v1/info' && method === 'GET')
                data = { serverId, apiVersion: 1, ...await capabilityFields() };
            else if (path === '/v1/pair' && method === 'POST')
                data = await auth.pair(body.code, body.publicKeySpki);
            else {
                const proof: AuthProof = { method, path: url.pathname + url.search, body: parsed.raw ? canonicalJson(body) : '', envelope: { deviceId: String(req.headers['x-dp-device'] ?? ''), timestamp: Number(req.headers['x-dp-time']), nonce: String(req.headers['x-dp-nonce'] ?? ''), signature: String(req.headers['x-dp-signature'] ?? '') } };
                requestId = proof.envelope.nonce;
                const deviceId=await auth.verify(proof);
                if(path==='/v1/events/stream'&&method==='GET'){
                    const after=Number(url.searchParams.get('after')??0);
                    if(!Number.isSafeInteger(after)||after<0||streamCount>=4||!auth.active)throw new Error('Event stream is unavailable.');
                    res.setHeader('content-type','text/event-stream');res.setHeader('x-accel-buffering','no');res.flushHeaders();
                    let cursor=after,closed=false,reading=false;streamCount++;
                    const cleanup=()=>{if(closed)return;closed=true;streamCount--;clearInterval(timer);clearTimeout(lease);};
                    const send=async()=>{if(closed||reading)return;reading=true;try{
                      if(!await auth.active!(deviceId)){cleanup();res.end();return;}
                      if(res.writableNeedDrain)return;
                      for(const event of engine.store.events(cursor)){if(closed)break;const drained=res.write(`data: ${JSON.stringify(event)}\n\n`);cursor=event.sequence;if(!drained)break;}
                      if(!closed&&!res.writableNeedDrain)res.write(': heartbeat\n\n');
                    }catch{cleanup();res.end();}finally{reading=false;}};
                    const timer=setInterval(()=>{void send();},1000),lease=setTimeout(()=>{cleanup();res.end();},300000);
                    res.on('close',cleanup);void send();return;
                }
                if((method==='POST'||method==='PATCH')&&(path.startsWith('/v2/')||body.expectedWallet!==undefined)&&body.expectedWallet!==engine.wallet)throw new Error('Reviewed signing wallet changed.');
                if(path.startsWith('/v2/')){const caps=await capabilities();const requested=body.spec as {kind?:string;exitStrategy?:unknown}|undefined;if(!caps.includes('mc-orders-v2')||(path.includes('strategies')||requested?.kind==='STRATEGY'||requested?.exitStrategy!==undefined)&&!caps.includes('exit-strategies-v2'))throw new Error('Signer MC capabilities unavailable.');}
                if ((path === '/v2/orders'||path==='/v2/strategies')&&method==='GET')data=engine.store.orders().filter(o=>path==='/v2/orders'||o.spec.kind==='STRATEGY');
                else if(path==='/v2/recover-initials/preview'&&method==='POST'){if(!(await capabilities()).includes('recover-initials-preview-v1'))throw new Error('Recovery preview unavailable.');data=await previewRecoverInitials(engine,body.spec);}
                else if(path==='/v2/preview'&&method==='POST')data=await engine.preview(validateProSpecV2(body.spec));
                else if((path==='/v2/orders'||path==='/v2/strategies')&&method==='POST'){const spec=validateProSpecV2(body.spec);if(path==='/v2/strategies'&&spec.kind!=='STRATEGY')throw new Error('Strategy required.');data=await engine.create(body.orderId,spec,proof);}
                else if (path === '/v1/health' && method === 'GET')
                    data = { ...await engine.health(serverId), ...await capabilityFields() };
                else if (auth.withdrawal && path === '/v1/recipients' && method === 'GET')
                    data = await auth.withdrawal('recipients', proof);
                else if (auth.withdrawal && path === '/v1/recipients' && method === 'POST')
                    data = await auth.withdrawal('addRecipient', proof);
                else if (auth.withdrawal && /^\/v1\/recipients\/[^/]+\/deactivate$/.test(path) && method === 'POST')
                    data = await auth.withdrawal('deactivateRecipient', proof);
                else if (auth.withdrawal && path === '/v1/withdrawals/preview' && method === 'POST')
                    data = await auth.withdrawal('preview', proof);
                else if (auth.withdrawal && path === '/v1/withdrawals' && method === 'POST')
                    data = await auth.withdrawal('approve', proof);
                else if (auth.withdrawal && path === '/v1/withdrawals' && method === 'GET')
                    data = await auth.withdrawal('withdrawals', proof);
                else if (auth.withdrawal && /^\/v1\/withdrawals\/[^/]+$/.test(path) && method === 'GET')
                    data = await auth.withdrawal('withdrawal', proof);
                else if (path === '/v1/orders' && method === 'GET')
                    data = engine.store.orders();
                else if (path === '/v1/events' && method === 'GET') {
                    const after = Number(url.searchParams.get('after') ?? 0);
                    if (!Number.isSafeInteger(after) || after < 0)
                        throw new Error('Invalid event cursor.');
                    const latest=url.searchParams.get('latest');
                    if(latest!==null){
                        const limit=Number(latest);
                        if(url.searchParams.has('after')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error('Invalid latest event limit.');
                        data=engine.store.latestEvents(limit);
                    }else data = engine.store.events(after);
                }
                else if (path === '/v1/diagnostics' && method === 'GET')
                    data = url.searchParams.get('export') === '1' ? { diagnostics: diagnostics?.latest(5000) ?? [], events: engine.store.events().map(event => sanitizeDiagnostic(event)) } : diagnostics?.latest() ?? [];
                else if (path === '/v1/diagnostics/debug' && method === 'POST') {
                    if (!diagnostics)
                        throw new Error('Diagnostics are unavailable.');
                    data = diagnostics.setDebug(body.minutes);
                    diagnostics.log({ component: 'api', type: 'diagnostics.debug.changed', level: 'info', requestId, details: { duration: body.minutes * 60000 } });
                }
                else if(path==='/v1/portfolio'&&method==='GET'){
                    const mint=url.searchParams.get('mint');
                    if([...url.searchParams.keys()].some(key=>key!=='mint')||url.searchParams.getAll('mint').length>1||mint!==null&&!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))throw new Error('Invalid portfolio mint.');
                    data=await readProPortfolio(engine,mint??undefined);
                }
                else if(path==='/v1/chart-entry'&&method==='GET'){
                    const mint=url.searchParams.get('mint');
                    if(!mint||! /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||[...url.searchParams.keys()].some(key=>key!=='mint')||url.searchParams.getAll('mint').length!==1)throw new Error('Invalid chart entry mint.');
                    data=await readProChartEntry(engine,mint);
                }
                else if (path === '/v1/wallet' && method === 'GET') {
                    const mint = url.searchParams.get('mint') ?? SOL;
                    if (auth.walletBalances) data = await auth.walletBalances(mint);
                    else {
                        const balances = await engine.market.balances(mint);
                        data = await Promise.all(Object.entries(balances).map(async ([asset, total]) => { const reserved = engine.store.reserved(asset); return { mint: asset, decimals: asset === SOL ? 9 : await engine.market.tokenDecimals?.(asset) ?? 0, totalRaw: String(total), reservedRaw: String(reserved), availableRaw: String(total > reserved ? total - reserved : 0n) }; }));
                    }
                }
                else if (path === '/v1/preview' && method === 'POST')
                    data = await engine.preview(body.spec);
                else if (path === '/v1/orders' && method === 'POST')
                    data = await engine.create(body.orderId, body.spec, proof);
                else if ((path === '/v1/pause-all' || path === '/v1/resume-engine') && method === 'POST') {
                    await engine.control(path.slice(4) as 'pause-all' | 'resume-engine', proof);
                    data = await engine.health(serverId);
                }
                else {
                    const match = /^\/v[12]\/(?:orders|strategies)\/([^/]+)(?:\/(pause|resume|cancel|retry))?$/.exec(path);
                    if (!match || !(method === 'PATCH' && !match[2] || method === 'POST' && match[2])) {
                        res.statusCode = 404;
                        throw new Error('Route not found.');
                    }
                    if(path.startsWith('/v2/')&&method==='PATCH')validateProSpecV2(body.spec);
                    orderId = decodeURIComponent(match[1]!);
                    if (match[2] === 'retry')
                        data = await engine.retry(orderId, body.revision, body.spec, body.action, proof);
                    else
                        data = await engine.change(orderId, body.revision, (match[2] ?? 'edit') as 'pause' | 'resume' | 'cancel' | 'edit', proof, body.spec);
                }
            }
            if (method !== 'GET') {
                if (path === '/v1/orders')
                    orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
                diagnostics?.log({ component: 'api', type: 'command.succeeded', level: 'info', requestId, orderId, duration: Date.now() - started, code: method });
            }
            res.end(JSON.stringify({ ok: true, data }));
        }
        catch (e) {
            if (res.statusCode === 200)
                res.statusCode = 400;
            const message = e instanceof SyntaxError ? 'Invalid JSON body.' : e instanceof Error ? String(sanitizeDiagnostic(e.message)) : 'Request failed.';
            diagnostics?.log({ component: 'api', type: 'request.failed', level: 'warn', requestId, orderId, duration: Date.now() - started, code: 'REQUEST_FAILED', details: { message } });
            res.end(JSON.stringify({ ok: false, error: message }));
        }
    });
}
