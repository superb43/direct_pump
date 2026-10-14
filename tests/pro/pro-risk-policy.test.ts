import {expect,it} from 'vitest';
import {dailyBuyExposure} from '../../server/risk-policy';

it('uses a rolling 24-hour window across UTC midnight and retains older unsettled exposure',()=>{
  const now=Date.parse('2026-10-12T00:01:00Z'),day=86400000;
  expect(dailyBuyExposure([
    {createdAt:now-120000,state:'FINALIZED',buyRaw:'100'},
    {createdAt:now-day,state:'FAILED',buyRaw:'20'},
    {createdAt:now-day-1,state:'FINALIZED',buyRaw:'999'},
    {createdAt:now-day-1,state:'UNKNOWN',buyRaw:'30'},
    {createdAt:now-day-1,state:'CONFIRMED',buyRaw:'40'},
    {createdAt:now,state:'FAILED',buyRaw:'0'},
  ],now)).toBe(190n);
});
it('uses the recorded raw exposure rather than a mutable quote or floating point amount',()=>{
  expect(dailyBuyExposure([{createdAt:0,state:'SIGNED',buyRaw:'10000000000000000001'}],86400001)).toBe(10000000000000000001n);
});
