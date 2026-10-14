import {afterEach,expect,it,vi} from 'vitest';
import {createPriceScheduler} from '../../src/worker/price-scheduler';
afterEach(()=>vi.useRealTimers());
it('coalesces a continuous burst at a fixed 200ms deadline and retains the latest slot',async()=>{
  vi.useFakeTimers();const queue=createPriceScheduler(),task=vi.fn().mockResolvedValue(undefined);
  for(let slot=1;slot<=20;slot++){queue.enqueue('asset',task,slot);await vi.advanceTimersByTimeAsync(10);}
  expect(task).toHaveBeenCalledOnce();expect(task.mock.calls[0]![0]).toBe(20);
  for(let slot=21;slot<=40;slot++){queue.enqueue('asset',task,slot);await vi.advanceTimersByTimeAsync(10);}
  expect(task).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(2800);
  expect(task).toHaveBeenCalledTimes(2);expect(task.mock.calls[1]![0]).toBe(40);queue.cancel(()=>true);
});
it('never exceeds two simultaneous quotes and runs one latest follow-up after a slow quote',async()=>{
  vi.useFakeTimers();const queue=createPriceScheduler(),release:(()=>void)[]=[],slots:number[]=[];let active=0,maximum=0;
  const task=async(slot:number)=>{slots.push(slot);maximum=Math.max(maximum,++active);await new Promise<void>(resolve=>release.push(resolve));active--;};
  queue.enqueue('a',task,1);queue.enqueue('b',task,2);queue.enqueue('c',task,3);await vi.advanceTimersByTimeAsync(200);
  expect(slots).toEqual([1,2]);for(let slot=4;slot<100;slot++)queue.enqueue('a',task,slot);
  release.shift()!();await vi.advanceTimersByTimeAsync(3000);expect(maximum).toBe(2);expect(slots).toContain(3);
  release.shift()!();await vi.advanceTimersByTimeAsync(1);expect(slots).toContain(99);expect(maximum).toBe(2);
  queue.cancel(()=>true);for(const done of release)done();await vi.advanceTimersByTimeAsync(1);
});
it('cancels queued work and aborts obsolete in-flight work',async()=>{
  vi.useFakeTimers();const queue=createPriceScheduler(),unused=vi.fn();queue.enqueue('old-wallet',unused);queue.cancel(()=>true);await vi.advanceTimersByTimeAsync(200);expect(unused).not.toHaveBeenCalled();
  let signal:AbortSignal|undefined;queue.enqueue('current',async(_slot,value)=>{signal=value;await new Promise<void>(resolve=>value.addEventListener('abort',()=>resolve()));});
  await vi.advanceTimersByTimeAsync(200);expect(signal?.aborted).toBe(false);queue.cancel(()=>true);expect(signal?.aborted).toBe(true);await vi.advanceTimersByTimeAsync(1);
});
