import type {AccountInfo,Connection,PublicKey} from '@solana/web3.js';
import type {Buffer} from 'buffer';
import {MintLayout,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackAccount,unpackMint} from '@solana/spl-token';
import BN from 'bn.js';
import {GLOBAL_PDA,PUMP_FEE_CONFIG_PDA,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,PUMP_SDK,bondingCurvePda,normalizeQuoteMint,getSellSolAmountFromTokenAmount} from '@pump-fun/pump-sdk';
import {GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,PUMP_AMM_PROGRAM_ID,PUMP_AMM_SDK,canonicalPumpPoolPda,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import type {PageTarget} from '../model';
import {targetKey} from '../sites/catalog';

type PumpRoute={venue:'PUMP_CURVE'|'PUMP_SWAP';mint:PublicKey;account:PublicKey};
export class PumpCurveGraduated extends Error{
 constructor(){super('Bonding curve completed; refresh the display route.');}
}
type Vaults={base:PublicKey;quote:PublicKey};
type Binding={wallet:string;target:PageTarget};
const vaults=new Map<string,Vaults>();
const vaultKey=(rpc:Connection,route:PumpRoute,binding?:Binding)=>JSON.stringify([rpc.rpcEndpoint,binding?.wallet,binding&&targetKey(binding.target),route.mint.toBase58(),route.account.toBase58()]);

/** Seed only from verified on-chain state; every use rechecks the fresh pool's addresses. */
export function rememberPumpVaults(rpc:Connection,route:PumpRoute,addresses:Vaults,binding?:Binding):void{
 if(route.venue!=='PUMP_SWAP')return;
 const key=vaultKey(rpc,route,binding);vaults.delete(key);vaults.set(key,addresses);
 if(vaults.size>200)vaults.delete(vaults.keys().next().value!);
}
export function knownPumpAccounts(rpc:Connection,route:PumpRoute,binding:Binding):string[]|undefined{
 if(route.venue==='PUMP_CURVE')return [route.account.toBase58()];
 const known=vaults.get(vaultKey(rpc,route,binding));
 return known?[route.account,known.base,known.quote].map(key=>key.toBase58()):undefined;
}
function required(info:AccountInfo<Buffer>|null|undefined,name:string,owner?:PublicKey):AccountInfo<Buffer>{
 if(!info)throw new Error(`${name} account is unavailable for pricing.`);
 if(info.executable||owner&&!info.owner.equals(owner))throw new Error(`Invalid ${name} account for the display quote.`);
 return info;
}

/** Display estimates only: read pricing state, never transaction-preparation wallet accounts. */
export async function quotePumpSell(rpc:Connection,route:PumpRoute,balance:bigint,binding?:Binding):Promise<bigint>{
 const curve=route.venue==='PUMP_CURVE';
 const cached=curve?undefined:vaults.get(vaultKey(rpc,route,binding));
 const [globalInfo,feeInfo,poolInfo,mintInfo,cachedBase,cachedQuote]=await rpc.getMultipleAccountsInfo([
  curve?GLOBAL_PDA:GLOBAL_CONFIG_PDA,curve?PUMP_FEE_CONFIG_PDA:PUMP_AMM_FEE_CONFIG_PDA,route.account,route.mint,
  ...(cached?[cached.base,cached.quote]:[]),
 ]);
 const info=required(mintInfo,'token mint');
 if(!info.owner.equals(TOKEN_PROGRAM_ID)&&!info.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('Invalid token mint owner for the display quote.');
 const mint=unpackMint(route.mint,info,info.owner);
 if(!mint.isInitialized)throw new Error('Invalid token mint for the display quote.');
 if(curve){
  if(!bondingCurvePda(route.mint).equals(route.account))throw new Error('Display quote curve identity does not match the token.');
  const bondingCurve=PUMP_SDK.decodeBondingCurve(required(poolInfo,'bonding curve',PUMP_PROGRAM_ID));
  if(bondingCurve.complete)throw new PumpCurveGraduated();
  if(!normalizeQuoteMint(bondingCurve.quoteMint).equals(NATIVE_MINT))throw new Error('Display quote route no longer settles in SOL.');
  const global=PUMP_SDK.decodeGlobal(required(globalInfo,'Pump global',PUMP_PROGRAM_ID));
  const feeConfig=PUMP_SDK.decodeFeeConfig(required(feeInfo,'Pump fee config',PUMP_FEE_PROGRAM_ID));
  return BigInt(getSellSolAmountFromTokenAmount({global,feeConfig,mintSupply:new BN(mint.supply.toString()),bondingCurve,amount:new BN(balance.toString())}).toString());
 }
 const pool=PUMP_AMM_SDK.decodePool(required(poolInfo,'PumpSwap pool',PUMP_AMM_PROGRAM_ID));
 if(!pool.baseMint.equals(route.mint)||!pool.quoteMint.equals(NATIVE_MINT)||!canonicalPumpPoolPda(pool.baseMint,pool.quoteMint).equals(route.account))throw new Error('Display quote pool identity does not match the SOL route.');
 const globalConfig=PUMP_AMM_SDK.decodeGlobalConfig(required(globalInfo,'PumpSwap global',PUMP_AMM_PROGRAM_ID));
 const feeConfig=feeInfo?PUMP_AMM_SDK.decodeFeeConfig(required(feeInfo,'PumpSwap fee config',PUMP_FEE_PROGRAM_ID)):null;
 const sameVaults=cached?.base.equals(pool.poolBaseTokenAccount)&&cached.quote.equals(pool.poolQuoteTokenAccount);
 const [baseInfo,quoteInfo]=sameVaults?[cachedBase,cachedQuote]:await rpc.getMultipleAccountsInfo([pool.poolBaseTokenAccount,pool.poolQuoteTokenAccount]);
 const base=unpackAccount(pool.poolBaseTokenAccount,required(baseInfo,'pool base vault'),info.owner);
 const quote=unpackAccount(pool.poolQuoteTokenAccount,required(quoteInfo,'pool SOL vault'));
 if(!base.mint.equals(pool.baseMint)||!quote.mint.equals(pool.quoteMint))throw new Error('Display quote vault mint identity does not match the pool.');
 const expected=BigInt(sellBaseInput({base:new BN(balance.toString()),slippage:0,baseReserve:new BN(base.amount.toString()),quoteReserve:new BN(quote.amount.toString()),virtualQuoteReserves:pool.virtualQuoteReserves,
  globalConfig,baseMintAccount:MintLayout.decode(info.data),baseMint:pool.baseMint,coinCreator:pool.coinCreator,creator:pool.creator,feeConfig,quoteMint:pool.quoteMint,isMayhemMode:pool.isMayhemMode,creatorFeeBps:pool.creatorFeeBps}).uiQuote.toString());
 rememberPumpVaults(rpc,route,{base:pool.poolBaseTokenAccount,quote:pool.poolQuoteTokenAccount},binding);
 return expected;
}
