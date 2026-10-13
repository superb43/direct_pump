import {Connection,PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID,PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';
import {CP_AMM_PROGRAM_ID,CpAmm} from '@meteora-ag/cp-amm-sdk';
import {DYNAMIC_BONDING_CURVE_PROGRAM_ID,DynamicBondingCurveClient} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {LAUNCHPAD_PROGRAM,CREATE_CPMM_POOL_PROGRAM,LaunchpadPool,CpmmPoolInfoLayout} from '@raydium-io/raydium-sdk-v2';
import {resolveExecution} from '../execution';
import {DLMM_PROGRAM_ID,dlmmPriceVaults} from '../dlmm';
import type {PageTarget} from '../model';

export async function priceAccounts(rpc:Connection,target:PageTarget,mint:string):Promise<string[]>{
  const route=await resolveExecution(rpc,target);
  if(route.mint.toBase58()!==mint||route.account.equals(route.mint))return [];
  const info=await rpc.getAccountInfo(route.account);if(!info)return [];
  const keys:PublicKey[]=[route.account];
  if(info.owner.equals(PUMP_AMM_PROGRAM_ID)){const pool=PUMP_AMM_SDK.decodePool(info);keys.push(pool.poolBaseTokenAccount,pool.poolQuoteTokenAccount);}
  else if(info.owner.equals(CP_AMM_PROGRAM_ID)){const pool=await new CpAmm(rpc).fetchPoolState(route.account);keys.push(pool.tokenAVault,pool.tokenBVault);}
  else if(info.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)){const pool=await new DynamicBondingCurveClient(rpc,'confirmed').state.getPool(route.account);if(!pool)return [];keys.push(pool.poolState.baseVault,pool.poolState.quoteVault);}
  else if(info.owner.equals(LAUNCHPAD_PROGRAM)){const pool=LaunchpadPool.decode(info.data);keys.push(pool.vaultA,pool.vaultB);}
  else if(info.owner.equals(CREATE_CPMM_POOL_PROGRAM)){const pool=CpmmPoolInfoLayout.decode(info.data);keys.push(pool.vaultA,pool.vaultB);}
  else if(info.owner.equals(DLMM_PROGRAM_ID)){keys.push(...dlmmPriceVaults(info));/* Jupiter quotes remain authoritative. */}
  else if(!info.owner.equals(PUMP_PROGRAM_ID))return [];
  return [...new Set(keys.map(key=>key.toBase58()))];
}
