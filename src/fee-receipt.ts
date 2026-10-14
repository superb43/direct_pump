import { Buffer } from 'buffer';
import { Connection, PublicKey, ComputeBudgetProgram, ComputeBudgetInstruction, TransactionInstruction, type VersionedTransactionResponse, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddressSync, unpackMint } from '@solana/spl-token';
import { EventParser } from '@coral-xyz/anchor';
import { getPumpProgram, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { OFFLINE_PUMP_AMM_PROGRAM, PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { instructionManifest, manifestDifferences } from './manifest';
import { verifiedWalletAssertions } from './wallet-assertions';
import { decodeDlmmFees } from './dlmm-fees';
import { decodeDammFees } from './damm-fees';
import { FEE_AUDIT_VERSION } from './fee-audit-version';
import type { Receipt, FeeReceipt, FeeAmount } from './model';
import { solUsdSnapshot } from './usd-price';
import { volumeUsd } from './receipts/savings';
import { simulationFailure } from './simulation';

export function pendingFees(note: string, state: FeeReceipt['state'] = 'PENDING'): FeeReceipt {
  return { auditVersion:FEE_AUDIT_VERSION, state, checkedAt:Date.now(), note, protocolFees:[], protocolBreakdownIncomplete:true, zeroExtraFeesVerified:false };
}
function exact(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('RPC balance is not an exact integer.');
  return BigInt(value);
}

/** Pure accounting over confirmed metadata; never use the requested priority cap as an actual fee. */
export function analyzeFeeFacts(receipt: Receipt, tx: VersionedTransactionResponse, parsed: ParsedTransactionWithMeta): FeeReceipt {
  if (!tx.meta || !parsed.meta) return pendingFees('Execution metadata is unavailable.');
  const meta = tx.meta, message = tx.transaction.message;
  const differences: string[]=[];
  let walletAssertions=false;
  if(!receipt.feeManifest?.length)differences.push('The stored instruction plan is missing.');
  else {
    const resolution={accountKeysFromLookups:meta.loadedAddresses??{writable:[],readonly:[]}};
    const actual=instructionManifest(message,resolution),keys=message.getAccountKeys(resolution);
    const ownedTokens=new Set([...(meta.preTokenBalances??[]),...(meta.postTokenBalances??[])].filter(row=>row.owner===receipt.wallet).map(row=>keys.get(row.accountIndex)!.toBase58()));
    const extra=actual.slice(receipt.feeManifest.length);
    walletAssertions=verifiedWalletAssertions(extra,receipt.wallet,ownedTokens);
    const matched=walletAssertions?actual.slice(0,receipt.feeManifest.length):actual;
    differences.push(...manifestDifferences(receipt.feeManifest,matched));
  }
  if(tx.transaction.signatures[0]!==receipt.signature||parsed.transaction.signatures[0]!==receipt.signature)differences.push('Transaction signature does not match.');
  if(tx.slot!==parsed.slot||parsed.meta.fee!==meta.fee)differences.push('RPC response metadata is inconsistent.');
  if(message.header.numRequiredSignatures!==1||message.staticAccountKeys[0]?.toBase58()!==receipt.wallet)differences.push('Payer/signers do not match the connected wallet.');
  const total = exact(meta.fee), keys = message.getAccountKeys({accountKeysFromLookups:meta.loadedAddresses ?? { writable:[],readonly:[] }});
  let limit: bigint | undefined, price = 0n, unknownPriority=false;
  for (const ix of message.compiledInstructions) {
    if (!keys.get(ix.programIdIndex)!.equals(ComputeBudgetProgram.programId)) continue;
    const instruction = new TransactionInstruction({programId:ComputeBudgetProgram.programId,keys:[],data:Buffer.from(ix.data)});
    const kind = ComputeBudgetInstruction.decodeInstructionType(instruction);
    if (String(kind).includes('RequestUnits')) unknownPriority=true;
    if (kind === 'SetComputeUnitLimit') limit = BigInt(ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction).units);
    if (kind === 'SetComputeUnitPrice') price = BigInt(ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction).microLamports);
  }
  const priority = unknownPriority?undefined:price === 0n ? 0n : limit === undefined ? undefined : (limit * price + 999_999n) / 1_000_000n;
  if (priority !== undefined && priority > total) return pendingFees('RPC network fee is inconsistent with the compute budget.','UNAVAILABLE');
  const result: FeeReceipt = { auditVersion:FEE_AUDIT_VERSION, state:differences.length?'MISMATCH':'VERIFIED', differences,checkedAt:Date.now(),slot:tx.slot,blockTime:tx.blockTime ?? undefined,note:`RPC transaction matched the complete built instruction plan${walletAssertions?', with validated trailing Phantom security assertions':''}. Terminal fee and added Jito tip are zero. Protocol fees below are only the decoded subset.`,totalNetworkLamports:total.toString(),priorityLamports:priority?.toString(),baseNetworkLamports:priority === undefined ? undefined : (total-priority).toString(),protocolFees:[],protocolBreakdownIncomplete:true,zeroExtraFeesVerified:!differences.length,terminalFeeLamports:differences.length?undefined:'0',terminalFeeSource:differences.length?undefined:'VERIFIED_PLAN',executionSucceeded:meta.err === null };
  if (meta.err) {
    const failure = simulationFailure(meta.err, meta.logMessages ?? null, undefined, 'CHAIN');
    result.executionError = failure.message;
    result.diagnostic = failure.diagnostic;
  }
  if(differences.length){result.note='The transaction differs from the stored plan. Confirmed network costs are shown; zero extra fees and savings are not credited. See differences.';return result;}
  if (meta.err) { result.note = 'The transaction failed. Network fees were charged; reverted swaps are excluded from trading volume.'; return result; }
  try {
    const wallet = receipt.wallet, accountNames = Array.from({length:keys.length},(_,i)=>keys.get(i)!.toBase58());
    const walletIndex = accountNames.indexOf(wallet);
    const baseAtas=[getAssociatedTokenAddressSync(new PublicKey(receipt.mint),new PublicKey(wallet),false,new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBase58(),getAssociatedTokenAddressSync(new PublicKey(receipt.mint),new PublicKey(wallet),false,new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')).toBase58()];
    const baseAmount=(rows:typeof meta.preTokenBalances)=>rows?.filter(row=>row.mint===receipt.mint&&(row.owner===wallet||baseAtas.includes(accountNames[row.accountIndex]!))).reduce((sum,row)=>sum+BigInt(row.uiTokenAmount.amount),0n)??0n;
    const tokenBefore=baseAmount(meta.preTokenBalances),tokenAfter=baseAmount(meta.postTokenBalances);
    result.tokenBeforeRaw=tokenBefore.toString();result.tokenAfterRaw=tokenAfter.toString();result.tokenDeltaRaw=(tokenAfter-tokenBefore).toString();
    const tokenRows = [...(meta.preTokenBalances ?? []),...(meta.postTokenBalances ?? [])];
    const wsol = getAssociatedTokenAddressSync(NATIVE_MINT,new PublicKey(wallet)).toBase58();
    const owned = new Set(tokenRows.filter(row=>row.owner === wallet || accountNames[row.accountIndex] === wsol).map(row=>row.accountIndex));
    const preSol = new Map((meta.preTokenBalances ?? []).filter(row=>row.mint === NATIVE_MINT.toBase58()).map(row=>[row.accountIndex,BigInt(row.uiTokenAmount.amount)]));
    const postSol = new Map((meta.postTokenBalances ?? []).filter(row=>row.mint === NATIVE_MINT.toBase58()).map(row=>[row.accountIndex,BigInt(row.uiTokenAmount.amount)]));
    let deposited = 0n, refunded = 0n;
    const addRent = (delta: bigint) => { if(delta>0n) deposited+=delta; else refunded-=delta; };
    let tokenSolDelta = 0n;
    for (const index of owned) {
      const before = preSol.get(index) ?? 0n, after = postSol.get(index) ?? 0n;
      tokenSolDelta += after-before;
      addRent(exact(meta.postBalances[index]!) - after - exact(meta.preBalances[index]!) + before);
    }
    const created = new Set<number>();
    const instructions = [...parsed.transaction.message.instructions,...(parsed.meta.innerInstructions?.flatMap(group=>group.instructions) ?? [])];
    for (const ix of instructions) {
      if (!('parsed' in ix) || ix.program !== 'system') continue;
      const data = ix.parsed as {type?:string;info?:{source?:string;newAccount?:string;lamports?:number}};
      if (!['createAccount','createAccountWithSeed'].includes(data.type ?? '') || data.info?.source !== wallet || !data.info.newAccount || data.info.lamports === undefined) continue;
      const index = accountNames.indexOf(data.info.newAccount);
      if (index < 0 || owned.has(index) || created.has(index) || meta.preBalances[index] !== 0) continue;
      created.add(index);
      // New protocol-owned state can later receive creator fees. Only its
      // initial funding is setup rent; never classify the later fee as rent.
      const funding = exact(data.info.lamports), remaining = exact(meta.postBalances[index]!);
      addRent(funding < remaining ? funding : remaining);
    }
    result.rentDepositedLamports = deposited.toString(); result.rentRefundedLamports = refunded.toString();
    const net = exact(meta.postBalances[walletIndex]!) - exact(meta.preBalances[walletIndex]!) + tokenSolDelta + total + deposited-refunded;
    const volume = receipt.side === 'BUY' ? -net : net;
    if (volume > 0n && (receipt.side !== 'BUY' || (receipt.inputAmount && volume <= BigInt(receipt.inputAmount)))) result.volumeLamports = volume.toString();
    else result.note += ' Settled SOL volume could not be isolated; it is excluded from USD totals.';
  } catch { result.note += ' Incomplete balance/rent data: USD volume is unavailable.'; }
  return result;
}

const field = (data: Record<string,unknown>, name: string): unknown => data[name] ?? data[name.replace(/[A-Z]/g,c=>`_${c.toLowerCase()}`)];
export async function decodePumpFees(rpc: Connection, logs: string[], tx: VersionedTransactionResponse): Promise<FeeAmount[]> {
  const keys = tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta?.loadedAddresses ?? {writable:[],readonly:[]}});
  const amounts = new Map<string,{label:string;mint:PublicKey;amount:bigint}>();
  const mints = new Map<string,PublicKey>();
  for(const row of [...(tx.meta?.preTokenBalances ?? []),...(tx.meta?.postTokenBalances ?? [])]) mints.set(keys.get(row.accountIndex)!.toBase58(),new PublicKey(row.mint));
  const add = (label:string,mint:PublicKey,value:unknown) => {
    if(value === undefined) return;
    const raw = BigInt(String(value)); if(raw<0n) throw new Error('Invalid protocol fee.');
    const key = `${label}:${mint.toBase58()}`, previous = amounts.get(key);
    amounts.set(key,{label,mint,amount:(previous?.amount ?? 0n)+raw});
  };
  for(const [program,coder] of [[PUMP_PROGRAM_ID,getPumpProgram(rpc).coder],[PUMP_AMM_PROGRAM_ID,OFFLINE_PUMP_AMM_PROGRAM.coder]] as const) {
    for(const event of new EventParser(program,coder).parseLogs(logs)) {
      if (!/^(tradeEvent|buyEvent|sellEvent)$/i.test(event.name)) continue;
      const d = event.data as Record<string,unknown>;
      let mint:PublicKey;
      if(program.equals(PUMP_PROGRAM_ID)) {
        const quote = field(d,'quoteMint'); mint = quote ? new PublicKey(String(quote)) : NATIVE_MINT;
        if(mint.equals(PublicKey.default)) mint=NATIVE_MINT;
        add('Pump protocol',mint,field(d,'fee')); add('Pump creator',mint,field(d,'creatorFee')); add('Pump buyback',mint,field(d,'buybackFee'));
      } else {
        const quoteAccount=String(field(d,'userQuoteTokenAccount'));
        const known=mints.get(quoteAccount);
        if(known) mint=known;
        else {
          const info=await rpc.getAccountInfo(new PublicKey(String(field(d,'pool'))));
          if(!info?.owner.equals(PUMP_AMM_PROGRAM_ID)) continue;
          mint=PUMP_AMM_SDK.decodePool(info).quoteMint;
        }
        add('Pump protocol',mint,field(d,'protocolFee')); add('Pump LP',mint,field(d,'lpFee')); add('Pump creator',mint,field(d,'coinCreatorFee')); add('Pump buyback',mint,field(d,'buybackFee'));
      }
      // holderRewards repeats the creator fee; adding it would double-count.
    }
  }
  const output:FeeAmount[]=[];
  for(const {label,mint,amount} of amounts.values()) {
    const native=mint.equals(NATIVE_MINT), info=native ? undefined : await rpc.getAccountInfo(mint);
    if(!native&&!info) continue;
    const decimals=native?9:unpackMint(mint,info!,info!.owner).decimals;
    const symbol=native?'SOL':mint.toBase58()==='3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'?'WBTC':mint.toBase58()==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'?'USDC':`${mint.toBase58().slice(0,4)}…${mint.toBase58().slice(-4)}`;
    output.push({label,rawAmount:amount.toString(),mint:mint.toBase58(),decimals,symbol});
  }
  return output;
}

export async function verifyFeeReceipt(rpc: Connection, receipt: Receipt): Promise<FeeReceipt> {
  if (!receipt.signature) return pendingFees('A transaction signature is required.');
  if (!receipt.feeManifest?.length) return pendingFees('This older receipt has no complete fee plan. View it on Solscan; it is excluded from the new savings counter.','UNAVAILABLE');
  const [raw,parsed] = await Promise.all([rpc.getTransaction(receipt.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0}),rpc.getParsedTransaction(receipt.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0})]);
  if(!raw || !parsed) return pendingFees('Confirmed transaction metadata is not available from this RPC yet.');
  const report = analyzeFeeFacts(receipt,raw,parsed);
  for(const decode of report.executionSucceeded ? [()=>decodePumpFees(rpc,raw.meta?.logMessages ?? [],raw),()=>decodeDlmmFees(raw),()=>decodeDammFees(rpc,raw)] : []){
    try { report.protocolFees.push(...await decode()); } catch { /* Preserve other decoded subsets; never guess unavailable fees. */ }
  }
  // Non-Pump routes can have unparsed fee layers. The itemized subset is
  // explicitly incomplete, even when matched plan/total network fee is verified.
  if(report.totalNetworkLamports){
    const price = receipt.feeReceipt?.usd ?? (raw.blockTime ? await solUsdSnapshot(raw.blockTime) : undefined);
    if(price){report.usd=price;if(report.state==='VERIFIED'&&report.volumeLamports)report.volumeUsdMicros=volumeUsd(report.volumeLamports,price);}
  }
  return report;
}
