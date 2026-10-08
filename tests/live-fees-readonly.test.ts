import {instructionManifest} from '../src/manifest';
import type {Receipt} from '../src/model';
import {expect,it} from 'vitest';
import {Connection,PublicKey} from '@solana/web3.js';
import {DEFAULT_SETTINGS} from '../src/model';
import {decodePumpFees,analyzeFeeFacts} from '../src/fee-receipt';

// Read public confirmed metadata only. No replay, signature or broadcast.
it.skipIf(process.env.DIRECT_PUMP_FEE_READONLY_SMOKE!=='1')('decodes real PumpSwap fee events in their quote asset',async()=>{
 const rpc=new Connection(DEFAULT_SETTINGS.rpcUrl,'confirmed');
 const pool=new PublicKey('5a7QurJLARt146JajJYPe5nh6vLyFpN2QrHUSLqbsCZy');
 const signatures=await rpc.getSignaturesForAddress(pool,{limit:5});
 for(const item of signatures){
  const tx=await rpc.getTransaction(item.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
  if(!tx?.meta||tx.meta.err)continue;
  const fees=await decodePumpFees(rpc,tx.meta.logMessages??[],tx);
  if(!fees.length)continue;
  expect(fees.some(fee=>fee.mint==='3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'&&fee.decimals===8)).toBe(true);
  console.info('READ_ONLY_FEE_DECODE_PASS',fees.map(({label,rawAmount,symbol})=>({label,rawAmount,symbol})));
  return;
 }
 throw new Error('No recent successful trade with decodable fee events was available.');
},30_000);

it.skipIf(process.env.DIRECT_PUMP_FEE_READONLY_SMOKE!=='1')('reproduces reported buy/sell accounting with reordered stored manifest keys',async()=>{
 const rpc=new Connection(DEFAULT_SETTINGS.rpcUrl,'confirmed');
 for(const [signature,side,expectedVolume] of [
  ['gFfjBAFyaoktXRCbmgRqR6AS8oGncT7LnWVps7sLx5RpkmhKXw1wz24rvCa65CCg3MhNnQ9jyNKRLRwbHKQ9BMk','BUY','10000000'],
  ['qkyuNgrzQZ8Li2RbH5LyxtWM2zttcqhRKd5oqc5ugVaPmidSGc1UkzFbJhwgWsQEF6mbDQP17aefMpKdJJFwwKm','SELL','14079402'],
 ] as const){
  const tx=await rpc.getTransaction(signature,{maxSupportedTransactionVersion:0}),parsed=await rpc.getParsedTransaction(signature,{maxSupportedTransactionVersion:0});
  if(!tx||!parsed)throw Error('Public fixture metadata unavailable.');
  // Chain-derived fixture plan tests serialization/accounting only. It is not
  // evidence that a third-party transaction was built by this extension.
  const manifest=instructionManifest(tx.transaction.message,{accountKeysFromLookups:tx.meta!.loadedAddresses!}).map(ix=>({accounts:ix.accounts,data:ix.data,program:ix.program}));
  const receipt:Receipt={wallet:'6bCFu4zFAnWUvQ12vdMRwtEH8bQVwbvEUx3AbdX7NA7V',mint:'DTZJdzvBkmfVXv1JhL6wUC68k2ktnCXHYG6dz4ACS984',signature,side,venue:'PUMP_SWAP',status:'CONFIRMED',createdAt:0,pageUrl:'',message:'',blockhash:'',lastValidBlockHeight:0,inputAmount:'10000000',feeManifest:manifest};
  const fees=analyzeFeeFacts(receipt,tx,parsed);expect(fees.state).toBe('VERIFIED');expect(fees.totalNetworkLamports).toBe('105000');expect(fees.volumeLamports).toBe(expectedVolume);expect(fees.tokenAfterRaw).toBe(side==='SELL'?'0':'6799007344');
  console.info('REPORTED_ACCOUNTING_PASS',{side,volume:fees.volumeLamports,network:fees.totalNetworkLamports,rent:fees.rentDepositedLamports});
 }
},30_000);
