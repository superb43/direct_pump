import { expect, it } from 'vitest';
import bs58 from 'bs58';
import { verifiedWalletAssertions } from '../src/wallet-assertions';
import type { ManifestInstruction } from '../src/model';
const program='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const wallet='wallet',token='owned-token';
const guards:ManifestInstruction[]=[
 {program,accounts:[wallet],data:'BgfmnACUYBKstZ5ATFaEA2S7gQdXV9JJY55'},
 {program,accounts:[token],data:'2MWjo7YpRNTqTvArLxMJdjGBdALpsLFa8VCcX'},
];
it('recognizes only the observed payer/owned-token assertion pair',()=>{
 expect(verifiedWalletAssertions(guards,wallet,new Set([token]))).toBe(true);
 expect(verifiedWalletAssertions([],wallet,new Set([token]))).toBe(false);
 expect(verifiedWalletAssertions(guards,wallet,new Set())).toBe(false);
});
it('accepts the observed full-sell guards only for the payer and owned token',()=>{
 const sold:ManifestInstruction[]=[
  {program,accounts:[wallet],data:'BgfmmYcXico8hwhTAcTuVS3QkW7rtVsaTFd'},
  {program,accounts:[token],data:'6TcgD72RVzGFpQ1CbuBAnhV'},
 ];
 expect(verifiedWalletAssertions(sold,wallet,new Set([token]))).toBe(true);
 expect(verifiedWalletAssertions(sold,wallet,new Set())).toBe(false);
 expect(verifiedWalletAssertions(sold,'other-wallet',new Set([token]))).toBe(false);
 for(const offset of [0,1,2,3,4,5,6,7,14,15,16]){
  const copy=structuredClone(sold),bytes=bs58.decode(copy[1]!.data);bytes[offset]=bytes[offset]!+1;copy[1]!.data=bs58.encode(bytes);
  expect(verifiedWalletAssertions(copy,wallet,new Set([token]))).toBe(false);
 }
 expect(verifiedWalletAssertions([sold[0]!,{...sold[1]!,accounts:[token,wallet]}],wallet,new Set([token]))).toBe(false);
 expect(verifiedWalletAssertions([...sold,sold[1]!],wallet,new Set([token]))).toBe(false);
});
it('rejects malformed payloads, mutated assertions, memory writes and extra accounts',()=>{
 for(const [offset,value] of [[0,0],[2,5],[13,2],[26,0]] as const){
  const copy=structuredClone(guards),bytes=bs58.decode(copy[1]!.data);bytes[offset]=value;copy[1]!.data=bs58.encode(bytes);
  expect(verifiedWalletAssertions(copy,wallet,new Set([token]))).toBe(false);
 }
 for(const data of ['invalid0',bs58.encode(bs58.decode(guards[1]!.data).slice(0,-1)),bs58.encode(new Uint8Array([...bs58.decode(guards[1]!.data),0]))]){
  expect(verifiedWalletAssertions([guards[0]!,{...guards[1]!,data}],wallet,new Set([token]))).toBe(false);
 }
 expect(verifiedWalletAssertions([{...guards[0]!,accounts:[wallet,token]},guards[1]!],wallet,new Set([token]))).toBe(false);
 expect(verifiedWalletAssertions([...guards,guards[1]!],wallet,new Set([token]))).toBe(false);
 expect(verifiedWalletAssertions([guards[1]!,guards[0]!],wallet,new Set([token]))).toBe(false);
});
