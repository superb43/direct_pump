import bs58 from 'bs58';
import type { ManifestInstruction } from './model';

const LIGHTHOUSE='L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
// Lighthouse 4c579479c98635e419b1b167f08be02a71604a71, clients/rust/src/
// generated: AssertAccountInfoMulti + AssertTokenAccountMulti. Only Phantom's
// observed buy/sell assertion pairs are supported. Memory operations/other layouts fail
// closed. The variable u64 balance thresholds have no side effects.
const INFO=[6,4,3,0,...Array(8).fill(-1),4,3,0,0,1,...Array(8).fill(0),0];
const TOKEN=[10,4,4,2,...Array(8).fill(-1),4,3,0,0,6,...Array(8).fill(0),5,8];
// A full sell omits Amount and retains Delegate(None), DelegatedAmount(0)
// and TokenAccountOwnerIsDerived. These assertions cannot move funds.
const SOLD_TOKEN=[10,4,3,3,0,0,6,...Array(8).fill(0),5,8];
function matches(ix:ManifestInstruction,account:string,layout:number[]):boolean{
 if(ix.program!==LIGHTHOUSE||ix.accounts.length!==1||ix.accounts[0]!==account)return false;
 try{const bytes=bs58.decode(ix.data);return bytes.length===layout.length&&layout.every((value,index)=>value===-1||bytes[index]===value);}catch{return false;}
}
export function verifiedWalletAssertions(extra:ManifestInstruction[],wallet:string,ownedTokens:Set<string>):boolean{
 if(extra.length!==2||!matches(extra[0]!,wallet,INFO))return false;
 const token=extra[1]!;
 return ownedTokens.has(token.accounts[0]!)&&(matches(token,token.accounts[0]!,TOKEN)||matches(token,token.accounts[0]!,SOLD_TOKEN));
}
