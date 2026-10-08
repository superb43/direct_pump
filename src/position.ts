import {Connection,PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount,unpackMint,getAccountLen,getAccountTypeOfMintType,getExtensionTypes,ExtensionType} from '@solana/spl-token';
import BN from 'bn.js';
import {OnlinePumpSdk,getSellSolAmountFromTokenAmount} from '@pump-fun/pump-sdk';
import {OnlinePumpAmmSdk,sellBaseInput} from '@pump-fun/pump-swap-sdk';
import {resolveExecution} from './execution';
import {buildOtherDirect} from './direct-venues';
import {buildRoutedTrade} from './router';
import {allReceipts} from './ledger';
import {solUsdSnapshot} from './usd-price';
import bs58 from 'bs58';
import type {ManifestInstruction,Receipt,Settings,PageTarget,MarketHint,PositionSnapshot} from './model';

export function positionBasis(receipts:Receipt[],balance:bigint):{costSol?:bigint;costUsd?:bigint;warning?:string}{
 let quantity=0n,costSol=0n,costUsd=0n,known=true,usdKnown=true;
 for(const receipt of [...receipts].sort((a,b)=>a.createdAt-b.createdAt)){
  const f=receipt.feeReceipt;
  if(f?.state!=='VERIFIED'||!f.executionSucceeded||!f.zeroExtraFeesVerified||f.tokenBeforeRaw===undefined||f.tokenAfterRaw===undefined||f.volumeLamports===undefined||f.totalNetworkLamports===undefined)continue;
  const before=BigInt(f.tokenBeforeRaw),after=BigInt(f.tokenAfterRaw),delta=after-before;
  if(before===0n){quantity=0n;costSol=0n;costUsd=0n;known=true;usdKnown=true;}
  if(before!==quantity){known=false;usdKnown=false;quantity=before;}
  if(receipt.side==='BUY'&&delta>0n){
   const cash=BigInt(f.volumeLamports)+BigInt(f.totalNetworkLamports)+BigInt(f.rentDepositedLamports??'0')-BigInt(f.rentRefundedLamports??'0');
   if(cash<=0n){known=false;usdKnown=false;}
   else{costSol+=cash;if(f.usd)costUsd+=cash*BigInt(f.usd.priceMicros)/1_000_000_000n;else usdKnown=false;}
   quantity=after;
  }else if(receipt.side==='SELL'&&delta<0n){
   if(quantity<=0n||-delta>quantity){known=false;usdKnown=false;}
   else{costSol=costSol*after/quantity;costUsd=costUsd*after/quantity;}
   quantity=after;
  }else if(delta!==0n){known=false;usdKnown=false;quantity=after;}
 }
 if(quantity!==balance||!known)return {warning:'Cost basis is incomplete: external transfers or untracked acquisitions. Net PnL is unavailable.'};
 return {costSol,costUsd:usdKnown?costUsd:undefined,warning:usdKnown?undefined:'Entry USD price unavailable; PnL is measured in SOL and converted at the current quote.'};
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

export async function readPosition(rpc:Connection,target:PageTarget,wallet:PublicKey,settings:Settings,market?:MarketHint,holdingsOnly=false,minContextSlot?:number):Promise<PositionSnapshot>{
 const route=await resolveExecution(rpc,target),info=await rpc.getAccountInfo(route.mint);
 if(!info)throw new Error('Token account is unavailable.');
 const mint=unpackMint(route.mint,info,info.owner),ata=getAssociatedTokenAddressSync(route.mint,wallet,false,info.owner),account=await rpc.getAccountInfo(ata,{commitment:'confirmed',minContextSlot});
 const balance=account?unpackAccount(ata,account,info.owner).amount:0n;
 const result:PositionSnapshot={wallet:wallet.toBase58(),mint:route.mint.toBase58(),balanceRaw:balance.toString(),decimals:mint.decimals,supplyRaw:mint.supply.toString(),updatedAt:Date.now(),balanceUpdatedAt:Date.now(),market:market?.mint===route.mint.toBase58()?market:undefined};
 if(balance===0n)return result;
 const basis=positionBasis(await allReceipts(wallet.toBase58(),route.mint.toBase58()),balance);
 result.costBasisSolLamports=basis.costSol?.toString();result.costBasisUsdMicros=basis.costUsd?.toString();result.warning=basis.warning;
 if(holdingsOnly)return result;
 try{
  let expected:bigint;
  if(route.venue==='PUMP_CURVE'){
   const sdk=new OnlinePumpSdk(rpc);const [global,feeConfig,state]=await Promise.all([sdk.fetchGlobal(),sdk.fetchFeeConfig(),sdk.fetchBuyState(route.mint,wallet,info.owner)]);
   expected=BigInt(getSellSolAmountFromTokenAmount({global,feeConfig,mintSupply:new BN(mint.supply.toString()),bondingCurve:state.bondingCurve,amount:new BN(balance.toString())}).toString());
  }else if(route.venue==='PUMP_SWAP'){
   const s=await new OnlinePumpAmmSdk(rpc).swapSolanaState(route.account,wallet);
   expected=BigInt(sellBaseInput({base:new BN(balance.toString()),slippage:0,baseReserve:s.poolBaseAmount,quoteReserve:s.poolQuoteAmount,virtualQuoteReserves:s.pool.virtualQuoteReserves,globalConfig:s.globalConfig,baseMintAccount:s.baseMintAccount,baseMint:s.baseMint,coinCreator:s.pool.coinCreator,creator:s.pool.creator,feeConfig:s.feeConfig,quoteMint:s.pool.quoteMint,isMayhemMode:s.pool.isMayhemMode,creatorFeeBps:s.pool.creatorFeeBps}).uiQuote.toString());
  }else if(route.venue==='JUPITER'){
   const built=await buildRoutedTrade(rpc,route,wallet,'SELL',balance,settings);expected=built.expected;result.exitSetupLamports=(await setupRent(rpc,built.feeManifest)).toString();
  }else expected=(await buildOtherDirect(rpc,route,wallet,'SELL',balance,0)).minimum;
  result.expectedExitLamports=expected.toString();
  // One-signer base fee plus the user's bounded priority budget. Venue fees
  // and price impact already live inside the full liquidation quote.
  result.exitNetworkLamports=(5_000+settings.priorityFeeLamports).toString();
  result.exitSetupLamports??='0'; // Native temporary WSOL rent is returned; route-created persistent ATAs are counted above.
  result.solUsd=await solUsdSnapshot(Math.floor(Date.now()/1000));
 }catch(error){result.warning=[result.warning,error instanceof Error?error.message:'Exit quote unavailable.'].filter(Boolean).join(' ');}
 return result;
}
