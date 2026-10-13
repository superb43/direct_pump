import {expect,it} from 'vitest';
import {quoteIssue} from '../src/quote-issue';
it.each([429,500,502,503,504])('keeps HTTP %s retryable even when the provider mentions API keys',status=>{
 const retryAt=Date.now()+5000;
 const issue=quoteIssue(Object.assign(new Error(`Jupiter API request failed (${status}). Check the API key, plan quota and available SOL routes.`),{status,retryAt}));
 expect(issue).toMatchObject({status,retryAt,kind:'RPC',retryable:true});
});
it.each([401,403])('does not loop on credential or access failure %s',status=>{
 expect(quoteIssue(Object.assign(new Error(`HTTP ${status}`),{status})).retryable).toBe(false);
});
it.each([400,404])('rechecks HTTP %s route failures without mistaking boilerplate for authentication',status=>{
 const issue=quoteIssue(Object.assign(new Error(`Jupiter API request failed (${status}). Check the API key, plan quota and available SOL routes.`),{status}));
 expect(issue).toMatchObject({kind:'ROUTE',retryable:true});expect(issue.retryAt).toBeGreaterThanOrEqual(Date.now()+59_990);
});
it('retains strict identity failures and retries dynamic route absence slowly',()=>{
 expect(quoteIssue(new Error('Quote identity does not match the tracked position.')).retryable).toBe(false);
 expect(quoteIssue(new Error('Pool not found')).retryAt).toBeGreaterThanOrEqual(Date.now()+59_990);
});
