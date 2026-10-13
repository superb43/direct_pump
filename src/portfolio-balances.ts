import type {Buffer} from 'buffer';
import {Connection,PublicKey,type AccountInfo} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackMint,unpackAccount} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {CP_AMM_PROGRAM_ID} from '@meteora-ag/cp-amm-sdk';
import {DYNAMIC_BONDING_CURVE_PROGRAM_ID} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {LAUNCHPAD_PROGRAM,CREATE_CPMM_POOL_PROGRAM} from '@raydium-io/raydium-sdk-v2';
import type {PageTarget,PortfolioHolding,Receipt,Venue,PositionSnapshot} from './model';
import {trackedTokens,walletReceiptsByMint} from './portfolio';
import {positionBasis} from './position';
import {userFacingError} from './errors';

// Account indexes are the pinned builder layouts in direct-venues.ts and PumpSwap's IDL.
const layouts:Partial<Record<Venue,{program:PublicKey;pool:number;tokens:number[]}>>={
  PUMP_SWAP:{program:PUMP_AMM_PROGRAM_ID,pool:0,tokens:[5,6]},
  METEORA_DAMM:{program:CP_AMM_PROGRAM_ID,pool:1,tokens:[2,3]},
  METEORA_DBC:{program:DYNAMIC_BONDING_CURVE_PROGRAM_ID,pool:2,tokens:[3,4]},
  RAYDIUM_LAUNCHLAB:{program:LAUNCHPAD_PROGRAM,pool:4,tokens:[5,6]},
  RAYDIUM_CPMM:{program:CREATE_CPMM_POOL_PROGRAM,pool:3,tokens:[4,5]},
};
export type TrackedBalance={holding:PortfolioHolding;target:PageTarget;quoteReady:boolean;balanceSlot?:number};
export type BalanceCache=Map<string,{at:number;receipts:string;row?:TrackedBalance}>;
export type BalanceReadOptions={cache:BalanceCache;slowMints:Set<string>;refresh?:boolean};

/** Direct account reads work on public RPCs that reject indexed owner scans. */
export async function readPortfolioBalances(rpc:Connection,wallet:PublicKey,receipts:Receipt[],minContextSlot?:number,options?:BalanceReadOptions):Promise<TrackedBalance[]>{
  const walletAddress=wallet.toBase58(),allTokens=trackedTokens(receipts,walletAddress),now=Date.now();
  const byMint=walletReceiptsByMint(receipts,walletAddress);
  const newestByMint=walletReceiptsByMint(receipts.filter(row=>row.wallet===walletAddress).sort((a,b)=>b.createdAt-a.createdAt),walletAddress);
  const fingerprints=new Map(allTokens.map(token=>[token.mint,JSON.stringify(byMint.get(token.mint)??[])]));
  const retained:TrackedBalance[]=[];
  const tokens=allTokens.filter(token=>{
    const cached=options?.cache.get(token.mint);
    if(!options?.refresh&&cached&&cached.receipts===fingerprints.get(token.mint)&&now-cached.at<60_000&&(!cached.row||options?.slowMints.has(token.mint))){
      if(cached.row)retained.push(cached.row);
      return false;
    }
    return true;
  });
  const keys=new Map<string,PublicKey>(),candidates=new Map<string,Set<string>>(),targets=new Map<string,PageTarget>();
  const errors=new Map<string,string>();
  for(const token of tokens){
    try{
      const mint=new PublicKey(token.mint),addresses=new Set<string>();
      for(const program of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID]){const key=getAssociatedTokenAddressSync(mint,wallet,false,program);keys.set(key.toBase58(),key);addresses.add(key.toBase58());}
      let target=token.target;
      for(const receipt of newestByMint.get(token.mint)??[]){
        const layout=layouts[receipt.venue];if(!layout)continue;
        const ix=receipt.feeManifest?.find(ix=>ix.program===layout.program.toBase58()&&ix.accounts.includes(token.mint)&&ix.accounts.includes(receipt.wallet));
        if(!ix)continue;
        if(target.kind==='MINT'&&!target.poolHint&&ix.accounts[layout.pool])target={...target,poolHint:new PublicKey(ix.accounts[layout.pool]!).toBase58()};
        for(const index of layout.tokens){const address=ix.accounts[index];if(!address)continue;const key=new PublicKey(address);keys.set(address,key);addresses.add(address);}
      }
      candidates.set(token.mint,addresses);targets.set(token.mint,target);
    }catch(error){errors.set(token.mint,userFacingError(error));}
  }
  const infos=new Map<string,AccountInfo<Buffer>|null>(),slots=new Map<string,number>(),readAt=new Map<string,number>(),failed=new Map<string,string>(),addresses=[...keys.values()];
  // PublicNode's free gateway rejects 11+ accounts with HTTP 403, despite the
  // Solana protocol allowing 100. Match the provider without changing RPC settings.
  const batchSize=new URL(rpc.rpcEndpoint).hostname==='solana-rpc.publicnode.com'?10:100;
  async function readAccounts(addresses:PublicKey[]){
    for(let offset=0;offset<addresses.length;offset+=batchSize){
      const chunk=addresses.slice(offset,offset+batchSize);
      try{
        const response=await rpc.getMultipleAccountsInfoAndContext(chunk,{commitment:'confirmed',minContextSlot});
        if(response.value.length!==chunk.length)throw new Error('RPC returned incomplete account data.');
        if(!Number.isSafeInteger(response.context.slot)||response.context.slot<(minContextSlot??0))throw new Error('RPC balance data predates the confirmed transaction.');
        const at=Date.now();
        response.value.forEach((info,index)=>{const address=chunk[index]!.toBase58();infos.set(address,info);slots.set(address,response.context.slot);readAt.set(address,at);});
      }catch(error){const message=userFacingError(error);for(const key of chunk)failed.set(key.toBase58(),message);}
    }
  }
  await readAccounts(addresses);
  // Decode wallet inventory first: closed/zero accounts need no mint or price read.
  const positive=new Set<string>();
  for(const token of tokens){
    try{
      for(const address of candidates.get(token.mint)??[]){
        const account=infos.get(address);if(!account)continue;
        if(!account.owner.equals(TOKEN_PROGRAM_ID)&&!account.owner.equals(TOKEN_2022_PROGRAM_ID))continue;
        const decoded=unpackAccount(new PublicKey(address),account,account.owner);
        if(decoded.owner.equals(wallet)&&decoded.mint.toBase58()===token.mint&&decoded.amount>0n)positive.add(token.mint);
      }
    }catch(error){errors.set(token.mint,userFacingError(error));}
  }
  await readAccounts(tokens.filter(token=>positive.has(token.mint)).map(token=>new PublicKey(token.mint)));
  const rows:TrackedBalance[]=[...retained];
  for(const {target:original,...token} of tokens){
    const target=targets.get(token.mint)??original;
    try{
      const required=[token.mint,...(candidates.get(token.mint)??[])];
      const error=errors.get(token.mint)??required.map(key=>failed.get(key)).find(Boolean);if(error)throw new Error(error);
      if(!positive.has(token.mint)){options?.cache.set(token.mint,{at:now,receipts:fingerprints.get(token.mint)!});continue;}
      const info=infos.get(token.mint);if(!info)throw new Error('Tracked token mint is unavailable.');
      if(!info.owner.equals(TOKEN_PROGRAM_ID)&&!info.owner.equals(TOKEN_2022_PROGRAM_ID))throw new Error('Tracked mint has an unsupported token program.');
      const mintKey=new PublicKey(token.mint),mint=unpackMint(mintKey,info,info.owner),ata=getAssociatedTokenAddressSync(mintKey,wallet,false,info.owner);
      let balance=0n,quoteReady=true;
      for(const address of candidates.get(token.mint)??[]){
        const account=infos.get(address);if(!account)continue;
        if(!account.owner.equals(info.owner))continue;
        const decoded=unpackAccount(new PublicKey(address),account,info.owner);
        if(!decoded.owner.equals(wallet)||!decoded.mint.equals(mintKey))continue;
        balance+=decoded.amount;if(decoded.amount>0n&&address!==ata.toBase58())quoteReady=false;
      }
      if(balance===0n)continue;
      const basis=positionBasis(byMint.get(token.mint)??[],balance);
      const position:PositionSnapshot={wallet:wallet.toBase58(),mint:token.mint,balanceRaw:balance.toString(),decimals:mint.decimals,supplyRaw:mint.supply.toString(),updatedAt:Date.now(),balanceUpdatedAt:Math.min(...required.map(address=>readAt.get(address)!)),openedAt:basis.openedAt,costBasisSolLamports:basis.costSol?.toString(),costBasisUsdMicros:basis.costUsd?.toString(),costBasisEstimated:basis.costBasisEstimated,warning:quoteReady?basis.warning:[basis.warning,'Quote unavailable: some tracked holdings are outside the associated token account.'].filter(Boolean).join(' ')};
      const row={holding:{...token,position},target,quoteReady,balanceSlot:Math.min(...required.map(address=>slots.get(address)!))};
      rows.push(row);options?.cache.set(token.mint,{at:now,receipts:fingerprints.get(token.mint)!,row});
    }catch(error){options?.cache.delete(token.mint);rows.push({holding:{...token,error:userFacingError(error)},target,quoteReady:false});}
  }
  return rows;
}
