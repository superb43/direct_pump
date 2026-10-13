import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount,unpackMint,getAccountLen,getAccountTypeOfMintType,getExtensionTypes,ExtensionType} from '@solana/spl-token';
import BN from 'bn.js';
import {OnlinePumpSdk,getSellSolAmountFromTokenAmount} from '@pump-fun/pump-sdk';
import {OnlinePumpAmmSdk,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import {resolveExecution} from './execution';
import {buildOtherDirect} from './direct-venues';
import {quoteRoutedTrade} from './router';
import {quoteIssue} from './quote-issue';
import {allReceipts} from './ledger';
import {solUsdSnapshot} from './usd-price';
import bs58 from 'bs58';
import {chartEntryFromReceipts} from './chart-entry';
import {ENTRY_VALIDITY_MS,type ChartEntryCache} from './chart-entry-cache';
import {targetKey} from './sites/catalog';
import type {ManifestInstruction,Receipt,Settings,PageTarget,MarketHint,PositionSnapshot} from './model';

const positionRoutes=new WeakMap<PositionSnapshot,{target:string;route:Awaited<ReturnType<typeof resolveExecution>>}>();

export function positionBasis(receipts:Receipt[],balance:bigint):{costSol?:bigint;costUsd?:bigint;costBasisEstimated?:boolean;openedAt?:number;warning?:string}{
 let quantity=0n,costSol=0n,costUsd=0n,known=true,usdKnown=true,estimated=false,openedAt:number|undefined;
 for(const receipt of [...receipts].sort((a,b)=>a.createdAt-b.createdAt)){
  const f=receipt.feeReceipt;
  if(f?.state!=='VERIFIED'||!f.executionSucceeded||!f.zeroExtraFeesVerified||f.tokenBeforeRaw===undefined||f.tokenAfterRaw===undefined||f.volumeLamports===undefined||f.totalNetworkLamports===undefined)continue;
  const before=BigInt(f.tokenBeforeRaw),after=BigInt(f.tokenAfterRaw),delta=after-before;
  if(before===0n){quantity=0n;costSol=0n;costUsd=0n;known=true;usdKnown=true;estimated=false;openedAt=undefined;}
  if(before!==quantity){
   // Liquidity/transfers change inventory, not the recorded acquisition average.
   if(quantity>0n){costSol=costSol*before/quantity;costUsd=costUsd*before/quantity;}
   estimated=true;quantity=before;
  }
  if(receipt.side==='BUY'&&delta>0n){
   openedAt??=f.blockTime!==undefined?f.blockTime*1000:receipt.createdAt;
   const cash=BigInt(f.volumeLamports)+BigInt(f.totalNetworkLamports)+BigInt(f.rentDepositedLamports??'0')-BigInt(f.rentRefundedLamports??'0');
   if(cash<=0n){known=false;usdKnown=false;}
   else{
    const usd=f.usd?cash*BigInt(f.usd.priceMicros)/1_000_000_000n:undefined;
    if(costSol===0n&&before>0n){costSol=cash*after/delta;costUsd=usd!==undefined?usd*after/delta:0n;estimated=true;}
    else{costSol+=cash;if(usd!==undefined)costUsd+=usd;}
    if(usd===undefined)usdKnown=false;
   }
   quantity=after;
  }else if(receipt.side==='SELL'&&delta<0n){
   if(quantity<=0n||-delta>quantity){known=false;usdKnown=false;}
   else{costSol=costSol*after/quantity;costUsd=costUsd*after/quantity;}
   quantity=after;
   if(after===0n)openedAt=undefined;
  }else if(delta!==0n){known=false;usdKnown=false;quantity=after;}
 }
 if(balance===0n)return {costSol:0n,costUsd:usdKnown?0n:undefined};
 if(quantity<=0n||costSol<=0n||!known)return {warning:'Cost basis is unavailable: no eligible acquisition average for the current holding episode.'};
 estimated ||= quantity!==balance;
 costSol=costSol*balance/quantity;costUsd=costUsd*balance/quantity;
 const warnings=[estimated?'Trade-history estimate: LP/transfer gains and losses are not included.':undefined,usdKnown?undefined:'Entry USD price unavailable; PnL is measured in SOL and converted at the current quote.'].filter(Boolean);
 return {costSol,costUsd:usdKnown?costUsd:undefined,costBasisEstimated:estimated||undefined,openedAt,warning:warnings.length?warnings.join(' '):undefined};
}

async function setupRent(rpc:Connection,manifest:ManifestInstruction[]):Promise<bigint>{
 const closed=new Set(manifest.filter(ix=>ix.program==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&bs58.decode(ix.data)[0]===9).map(ix=>ix.accounts[0]));
 const accounts=new Map(manifest.filter(ix=>ix.program===ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()&&!closed.has(ix.accounts[1])).map(ix=>[ix.accounts[1]!,ix]));
 let rent=0n;
 for(const [address,ix] of accounts){
  if(await rpc.getAccountInfo(new PublicKey(address)))continue;
  let len=165;
  if(ix.accounts[5]===TOKEN_2022_PROGRAM_ID.toBase58()){
   const key=new PublicKey(ix.accounts[3]!),info=await rpc.getAccountInfo(key);if(!info)throw new Error('Exit account setup could not be estimated.');
   const mint=unpackMint(key,info,info.owner);len=getAccountLen([...new Set([ExtensionType.ImmutableOwner,...getExtensionTypes(mint.tlvData).map(getAccountTypeOfMintType)])]);
  }
  rent+=BigInt(await rpc.getMinimumBalanceForRentExemption(len));
 }
 return rent;
}

export type PositionEntryOptions={cache:ChartEntryCache;scope:string;blocked?:boolean;balance?:{position:PositionSnapshot;slot:number;quoteReady:boolean}};
export async function readPosition(rpc:Connection,target:PageTarget,wallet:PublicKey,settings:Settings,market?:MarketHint,holdingsOnly=false,minContextSlot?:number,trackedMint?:string,entryOptions?:PositionEntryOptions):Promise<PositionSnapshot>{
 let route=trackedMint?undefined:await resolveExecution(rpc,target);
 const mintKey=trackedMint?new PublicKey(trackedMint):route!.mint,info=await rpc.getAccountInfo(mintKey);
 if(!info)throw new Error('Token account is unavailable.');
 const mint=unpackMint(mintKey,info,info.owner),ata=getAssociatedTokenAddressSync(mintKey,wallet,false,info.owner);
 const accounts=trackedMint?await rpc.getTokenAccountsByOwner(wallet,{mint:mintKey},{commitment:'confirmed',minContextSlot}):undefined;
 const shared=entryOptions?.balance,p=shared?.position,age=p?Date.now()-(p.balanceUpdatedAt??p.updatedAt):Infinity;
 const known=!accounts&&p&&p.wallet===wallet.toBase58()&&p.mint===mintKey.toBase58()&&p.decimals===mint.decimals&&p.supplyRaw===mint.supply.toString()
   &&age>=0&&age<5000&&Number.isSafeInteger(shared!.slot)&&shared!.slot>=(minContextSlot??0)?shared:undefined;
 const reuse=known?.quoteReady?known:undefined;
 const accountResponse=accounts||reuse?undefined:await rpc.getAccountInfoAndContext(ata,{commitment:'confirmed',minContextSlot});
 const account=accountResponse?.value;
 const token=account?unpackAccount(ata,account,info.owner):undefined;
 if(token&&(!token.owner.equals(wallet)||!token.mint.equals(mintKey)))throw new Error('Token balance ownership does not match.');
 const balance=accounts?accounts.value.reduce((sum,row)=>{
  const token=unpackAccount(row.pubkey,row.account,info.owner);
  if(!token.owner.equals(wallet)||!token.mint.equals(mintKey))throw new Error('Token balance ownership does not match.');
  return sum+token.amount;
 },0n):reuse?BigInt(reuse.position.balanceRaw):token?.amount??0n;
 const verifiedAt=reuse?(reuse.position.balanceUpdatedAt??reuse.position.updatedAt):Date.now(),slot=accounts?.context.slot??reuse?.slot??accountResponse!.context.slot;
 const result:PositionSnapshot={wallet:wallet.toBase58(),mint:mintKey.toBase58(),balanceRaw:balance.toString(),decimals:mint.decimals,supplyRaw:mint.supply.toString(),updatedAt:Date.now(),balanceUpdatedAt:verifiedAt,market:market?.mint===mintKey.toBase58()?market:undefined};
 if(route)positionRoutes.set(result,{target:targetKey(target),route});
 if(balance===0n){entryOptions?.cache.invalidatePosition(entryOptions.scope,result.wallet,result.mint);return result;}
 const receipts=await allReceipts(wallet.toBase58(),mintKey.toBase58());
 const entrySlot=receipts.reduce((slot,r)=>r.wallet===result.wallet&&r.mint===result.mint&&r.status==='CONFIRMED'?Math.max(slot,r.feeReceipt?.slot??0):slot,minContextSlot??0);
 if(entryOptions){
  const projection=entryOptions.cache.project({scope:entryOptions.scope,position:result,receipts,minContextSlot:entrySlot,blocked:entryOptions.blocked,
   inventory:{balanceRaw:known?.position.balanceRaw??result.balanceRaw,slot:Math.min(slot,known?.slot??slot),verifiedAt}});
  result.chartEntry=projection.entry;result.chartEntryNote=projection.note;
 }else{
  const entry=chartEntryFromReceipts(receipts,result);
  if('priceUsd' in entry&&Number.isSafeInteger(slot)&&Number.isSafeInteger(entrySlot)&&slot>=entrySlot)result.chartEntry={...entry,updatedAt:verifiedAt,validUntil:verifiedAt+ENTRY_VALIDITY_MS};
  else if('priceUsd' in entry)result.chartEntryNote='Avg entry unavailable: wallet verification predates the confirmed transaction.';
  else result.chartEntryNote=`Avg entry unavailable: ${entry.unavailable}`;
 }
 const basis=positionBasis(receipts,balance);
 result.costBasisSolLamports=basis.costSol?.toString();result.costBasisUsdMicros=basis.costUsd?.toString();result.costBasisEstimated=basis.costBasisEstimated;result.warning=basis.warning;
 result.openedAt=basis.openedAt;
 if(holdingsOnly)return result;
 const quoteReady=!accounts?.value.some(row=>!row.pubkey.equals(ata)&&unpackAccount(row.pubkey,row.account,info.owner).amount>0n);
 return quotePosition(rpc,target,wallet,settings,result,quoteReady,route);
}

/** Quote an already confirmed balance; never repeat indexed owner discovery. */
export async function quotePosition(rpc:Connection,target:PageTarget,wallet:PublicKey,settings:Settings,position:PositionSnapshot,quoteReady=true,knownRoute?:Awaited<ReturnType<typeof resolveExecution>>,options?:{signal?:AbortSignal;skipUsd?:boolean}):Promise<PositionSnapshot>{
 const result:PositionSnapshot={...position,updatedAt:Date.now(),expectedExitLamports:undefined,exitNetworkLamports:undefined,exitSetupLamports:undefined,solUsd:undefined,quoteIssue:undefined,usdIssue:undefined};
 if(result.wallet!==wallet.toBase58()||target.mintHint&&target.mintHint!==result.mint)throw new Error('Quote identity does not match the tracked position.');
 try{
  if(!quoteReady)throw new Error('Quote unavailable: some holdings are outside the associated token account.');
  const cached=positionRoutes.get(position);
  const route=knownRoute??(cached?.target===targetKey(target)?cached.route:undefined)??await resolveExecution(rpc,target),mintKey=new PublicKey(result.mint),balance=BigInt(result.balanceRaw);
  if(!route.mint.equals(mintKey))throw new Error('Quote unavailable: the saved page resolves to a different token.');
  result.pricePool=route.account.toBase58();
  const info=await rpc.getAccountInfo(route.mint);
  if(!info)throw new Error('Token mint information is unavailable for pricing.');
  const mint=unpackMint(route.mint,info,info.owner);
  let expected:bigint;
  if(route.venue==='PUMP_CURVE'){
   const sdk=new OnlinePumpSdk(rpc);const [global,feeConfig,state]=await Promise.all([sdk.fetchGlobal(),sdk.fetchFeeConfig(),sdk.fetchBuyState(route.mint,wallet,info.owner)]);
   expected=BigInt(getSellSolAmountFromTokenAmount({global,feeConfig,mintSupply:new BN(mint.supply.toString()),bondingCurve:state.bondingCurve,amount:new BN(balance.toString())}).toString());
  }else if(route.venue==='PUMP_SWAP'){
   const s=await new OnlinePumpAmmSdk(rpc).swapSolanaState(route.account,wallet);
   expected=BigInt(sellBaseInput({base:new BN(balance.toString()),slippage:0,baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:s.pool.virtualQuoteReserves,globalConfig:s.globalConfig,baseMintAccount:s.baseMintAccount,baseMint:s.baseMint,coinCreator:s.pool.coinCreator,creator:s.pool.creator,feeConfig:s.feeConfig,quoteMint:s.pool.quoteMint,isMayhemMode:s.pool.isMayhemMode,creatorFeeBps:s.pool.creatorFeeBps}).uiQuote.toString());
  }else if(route.venue==='JUPITER'){
   const built=await quoteRoutedTrade(rpc,route,wallet,'SELL',balance,settings,options?.signal);expected=built.expected;result.exitSetupLamports=(await setupRent(rpc,built.feeManifest)).toString();
  }else expected=(await buildOtherDirect(rpc,route,wallet,'SELL',balance,0)).minimum;
  result.expectedExitLamports=expected.toString();
  // One-signer base fee plus the user's bounded priority budget. Venue fees
  // and price impact already live inside the full liquidation quote.
  result.exitNetworkLamports=(5_000+settings.priorityFeeLamports).toString();
  result.exitSetupLamports??='0'; // Native temporary WSOL rent is returned; route-created persistent ATAs are counted above.
  if(!options?.skipUsd)result.solUsd=await solUsdSnapshot(Math.floor(Date.now()/1000));
 }catch(error){result.quoteIssue=quoteIssue(error);result.warning=[result.warning,result.quoteIssue.message].filter(Boolean).join(' ');}
 return result;
}
