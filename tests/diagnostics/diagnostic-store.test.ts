import { expect, it } from 'vitest';
import { appendDiagnostic, DIAGNOSTIC_DATABASE, DIAGNOSTIC_MAX_BYTES, DIAGNOSTIC_RETENTION_MS, retainDiagnostics } from '../../src/diagnostics/diagnostic-store';
import type { DiagnosticEvent } from '../../src/diagnostics/diagnostics';
const row = (at: number, extras: Partial<DiagnosticEvent> = {}): DiagnosticEvent => ({ type: 'rpc.failed', at, level: 'error', component: 'worker', version: 'test', details: { code: 429 }, ...extras });

it('coalesces identical repeated errors with count, retaining distinct orders and non-errors', () => {
  const original = [row(1000)];
  let events = appendDiagnostic(original, row(2000), 2000);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ count: 2, firstAt: 1000, at: 2000 });
  expect(original[0]!.at).toBe(1000);
  events = appendDiagnostic(events, row(3000, { orderId: 'different' }), 3000);
  events = appendDiagnostic(events, row(4000, { level: 'info' }), 4000);
  events = appendDiagnostic(events, row(70_000), 70_000);
  expect(events).toHaveLength(4);
});

it('removes old/future rows and drops oldest events to enforce the UTF-8 byte limit', () => {
  const now = DIAGNOSTIC_RETENTION_MS + 10;
  expect(retainDiagnostics([row(0), row(10), row(now), row(now + 1)], now).map(event => event.at)).toEqual([10, now]);
  const events = Array.from({ length: 120 }, (_, index) => row(now - 120 + index, { details: { message: '😀'.repeat(12_000) } }));
  const retained = retainDiagnostics(events, now);
  expect(new TextEncoder().encode(JSON.stringify(retained)).length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BYTES);
  expect(retained.length).toBeLessThan(events.length);
  expect(retained.at(-1)!.at).toBe(events.at(-1)!.at);
  expect(retainDiagnostics([row(now)], now, 10)).toEqual([]);
});

it('uses a dedicated database that cannot prune receipt stores', () => {
  expect(DIAGNOSTIC_DATABASE).toBe('direct-pump-diagnostics');
  expect(DIAGNOSTIC_DATABASE).not.toBe('direct-pump-fee-receipts');
});
it('enforces the exact UTF-8 array boundary and preserves the newest multibyte events without mutating input',()=>{
  const events=[row(1,{details:{message:'한국어'}}),row(2,{details:{message:'😀'}}),row(3,{details:{message:'latest'}})];
  const original=structuredClone(events),lastTwo=new TextEncoder().encode(JSON.stringify(events.slice(1))).length;
  expect(retainDiagnostics(events,3,lastTwo)).toEqual(events.slice(1));
  expect(retainDiagnostics(events,3,lastTwo-1)).toEqual(events.slice(2));expect(events).toEqual(original);
  expect(retainDiagnostics(events,3,0)).toEqual([]);
});
