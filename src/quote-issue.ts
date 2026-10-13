import type {QuoteIssue} from './model';
import {userFacingError} from './errors';

/** Display-read failures only; never changes signing or unresolved-order policy. */
export function quoteIssue(error:unknown):QuoteIssue{
 const message=userFacingError(error),metadata=error as {status?:number;retryAt?:number}|undefined;
 const status=metadata?.status??(Number(message.match(/\b(401|403|429|500|502|503|504)\b/)?.[1])||undefined);
 const transient=status===429||!!status&&status>=500;
 const permanent=!transient&&(status===401||status===403||!status&&/API key|identity|different token|does not match|unsupported|not decoded|invalid.*(?:mint|route|output)|unexpected fees/i.test(message));
 const rpc=status?status!==400&&status!==404:/RPC|fetch|network|timeout|timed out|abort|minimum context slot|socket/i.test(message);
 return {kind:rpc?'RPC':'ROUTE',message,status,retryable:!permanent,retryAt:metadata?.retryAt??(!permanent&&!rpc?Date.now()+60_000:undefined)};
}
