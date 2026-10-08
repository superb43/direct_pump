import { Buffer } from 'buffer';
import BN from 'bn.js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Connection, PublicKey, Keypair, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, createCloseAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { jupiterProgram } from '../src/jupiter-coder';
import { buildRoutedTrade, validateRouterSwap, type BuildResponse } from '../src/router';
import { DEFAULT_SETTINGS } from '../src/model';

const mocks = vi.hoisted(() => ({ finalize: vi.fn() }));
vi.mock('../src/transactions', async original => ({ ...await original<typeof import('../src/transactions')>(), finalizeTrade: mocks.finalize }));
import { TransactionSizeError } from '../src/transactions';
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const token = new PublicKey('9XKzy4KahcZaGJPJtz1PtqGPB3CiseoBrx7TcQhEpump');
const wbtc = new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
const event = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], jupiterProgram.programId)[0];
const rpc = new Connection(DEFAULT_SETTINGS.rpcUrl);
const route = { venue: 'JUPITER' as const, mint: token, quoteMint: NATIVE_MINT, account: token };
const settings = { ...DEFAULT_SETTINGS, jupiterApiKey: 'mock-key' };
const wire = (ix: TransactionInstruction) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map(key => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })), data: ix.data.toString('base64') });
function core(input = NATIVE_MINT, output = token, name = 'routeV2', fee = 0, surplus = 0, inputAmount = 100_000_000) {
  const source = getAssociatedTokenAddressSync(input, wallet), destination = getAssociatedTokenAddressSync(output, wallet);
  const accounts = name === 'routeV2' ? [wallet,source,destination,input,output,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,jupiterProgram.programId,event,jupiterProgram.programId]
    : [jupiterProgram.programId,wallet,source,jupiterProgram.programId,jupiterProgram.programId,destination,input,output,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID,event,jupiterProgram.programId];
  const args = { inAmount: new BN(inputAmount), quotedOutAmount: new BN(1000), slippageBps: 500, platformFeeBps: fee, positiveSlippageBps: surplus, routePlan: [{ swap: { PumpSwapBuy: {} }, bps: 10_000, inputIndex: 0, outputIndex: 1 }], ...(name === 'sharedAccountsRouteV2' ? { id: 0 } : {}) };
  return new TransactionInstruction({ programId: jupiterProgram.programId, keys: accounts.map((pubkey,index) => ({ pubkey, isSigner: index === (name === 'routeV2' ? 0 : 1), isWritable: true })), data: jupiterProgram.coder.instruction.encode(name,args) });
}
function build(sell = false): BuildResponse {
  const input = sell ? token : NATIVE_MINT, output = sell ? NATIVE_MINT : token;
  return { inputMint: input.toBase58(), outputMint: output.toBase58(), inAmount: '100000000', outAmount: '1000', otherAmountThreshold: '950', swapMode: 'ExactIn', slippageBps: 500,
    routePlan: [
      { swapInfo: { ammKey: token.toBase58(), label: sell ? 'Pumpfun AMM' : 'Raydium', inputMint: input.toBase58(), outputMint: wbtc.toBase58() } },
      { swapInfo: { ammKey: token.toBase58(), label: sell ? 'Raydium' : 'Pumpfun AMM', inputMint: wbtc.toBase58(), outputMint: output.toBase58() } },
    ], setupInstructions: [], swapInstruction: wire(core(input,output)), cleanupInstruction: sell ? wire(createCloseAccountInstruction(getAssociatedTokenAddressSync(NATIVE_MINT,wallet),wallet,wallet)) : null };
}
beforeEach(() => {
  mocks.finalize.mockReset().mockResolvedValue({ transaction: {}, latest: {}, observedSlot: 1 });
  vi.spyOn(rpc,'getMultipleAccountsInfo').mockImplementation(async keys => keys.map(() => ({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82), lamports: 1, executable: false, rentEpoch: 0 })));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ ok: true, json: async () => build() }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('decodes deployed v2 PumpSwap routes and protects both account layouts', () => {
  for (const name of ['routeV2','sharedAccountsRouteV2']) expect(() => validateRouterSwap(core(NATIVE_MINT,token,name),wallet,NATIVE_MINT,token,100_000_000n,950n,500,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID)).not.toThrow();
  for (const ix of [core(NATIVE_MINT,token,'routeV2',1),core(NATIVE_MINT,token,'routeV2',0,1),core(NATIVE_MINT,token,'routeV2',0,0,100_000_001)]) expect(() => validateRouterSwap(ix,wallet,NATIVE_MINT,token,100_000_000n,950n,500,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID)).toThrow();
  const forwarded = core(); forwarded.keys[2]!.pubkey = wbtc;
  expect(() => validateRouterSwap(forwarded,wallet,NATIVE_MINT,token,100_000_000n,950n,500,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID)).toThrow('binding');
});
it('asks Metis for the complete SOL route without fixed intermediates or major-venue exclusions', async () => {
  const result = await buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings);
  const url = new URL(vi.mocked(fetch).mock.calls[0]![0] as string);
  expect(url.searchParams.get('inputMint')).toBe(NATIVE_MINT.toBase58()); expect(url.searchParams.get('outputMint')).toBe(token.toBase58());
  expect(url.searchParams.get('platformFeeBps')).toBe('0'); expect(url.searchParams.get('wrapAndUnwrapSol')).toBe('true');
  for (const key of ['mode','dexes','excludeDexes','feeAccount','tipAmount']) expect(url.searchParams.has(key)).toBe(false);
  expect(result.minimum).toBe(950n); expect(result.routeLabels).toContain('Pumpfun AMM'); expect(mocks.finalize).toHaveBeenCalledOnce();
});
it('sells into native SOL and rejects a WBTC endpoint or missing unwrap', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true,json: async () => build(true) } as Response);
  await buildRoutedTrade(rpc,route,wallet,'SELL',100_000_000n,settings);
  const url = new URL(vi.mocked(fetch).mock.calls[0]![0] as string); expect(url.searchParams.get('outputMint')).toBe(NATIVE_MINT.toBase58());
  const missing = build(true); missing.cleanupInstruction = null;
  vi.mocked(fetch).mockResolvedValue({ ok: true,json: async () => missing } as Response);
  await expect(buildRoutedTrade(rpc,route,wallet,'SELL',100_000_000n,settings)).rejects.toThrow('unwrap');
  vi.mocked(fetch).mockResolvedValue({ ok: true,json: async () => ({...build(true),outputMint:wbtc.toBase58()}) } as Response);
  await expect(buildRoutedTrade(rpc,route,wallet,'SELL',100_000_000n,settings)).rejects.toThrow('intended SOL trade');
});
it('narrows account limits only for size errors and does not hide simulation failures', async () => {
  mocks.finalize.mockRejectedValueOnce(new TransactionSizeError()).mockResolvedValueOnce({ transaction: {}, latest: {} });
  const result = await buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings);
  expect(vi.mocked(fetch).mock.calls.map(([url])=>new URL(url as string).searchParams.get('maxAccounts'))).toEqual(['64','48']);
  expect(result.maxAccounts).toBe(48);
  vi.mocked(fetch).mockClear(); mocks.finalize.mockRejectedValue(new Error('Simulation failed: insufficient funds.'));
  await expect(buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings)).rejects.toThrow('Simulation failed');
  expect(fetch).toHaveBeenCalledOnce();
});
it('rejects fee/tip injection and third-party SOL transfers before any simulation or wallet call', async () => {
  const invalid = build(); invalid.setupInstructions = [wire(SystemProgram.transfer({ fromPubkey:wallet,toPubkey:wbtc,lamports:1 }))];
  vi.mocked(fetch).mockResolvedValue({ ok:true,json:async()=>invalid } as Response);
  await expect(buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings)).rejects.toThrow('recipient');
  const fee = build(); fee.platformFee = { feeBps:1,amount:'1' };
  vi.mocked(fetch).mockResolvedValue({ ok:true,json:async()=>fee } as Response);
  await expect(buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings)).rejects.toThrow('fees');
  expect(mocks.finalize).not.toHaveBeenCalled();
});
it('strengthens a one-atom rounding difference instead of weakening quote protection',async()=>{
 const response=build();response.outAmount='1001';response.otherAmountThreshold='951';
 const instruction=core();const decoded=jupiterProgram.coder.instruction.decode(instruction.data)!;
 (decoded.data as {quotedOutAmount:BN}).quotedOutAmount=new BN(1001);instruction.data=jupiterProgram.coder.instruction.encode(decoded.name,decoded.data);response.swapInstruction=wire(instruction);
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>response} as Response);
 const result=await buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings);
 expect(result.expected).toBe(1001n);expect(result.minimum).toBe(951n);
 const passed=mocks.finalize.mock.calls[0]![1] as TransactionInstruction[];
 const protectedData=jupiterProgram.coder.instruction.decode(passed.find(ix=>ix.programId.equals(jupiterProgram.programId))!.data)!.data as {quotedOutAmount:BN;slippageBps:number};
 expect(BigInt(protectedData.quotedOutAmount.toString())*9500n/10000n).toBeGreaterThanOrEqual(951n);
 expect(protectedData.slippageBps).toBe(500);
});
it('reports larger protection gaps and rejects them before simulation',async()=>{
 const response=build();response.otherAmountThreshold='960';vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>response} as Response);
 await expect(buildRoutedTrade(rpc,route,wallet,'BUY',100_000_000n,settings)).rejects.toThrow('difference 10 raw output units');expect(mocks.finalize).not.toHaveBeenCalled();
});
