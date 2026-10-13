import { chartEntryFromReceipts, type ChartEntry, type ChartEntryResult } from './chart-entry';
import type { Receipt } from './model';

export const ENTRY_VALIDITY_MS = 30_000;
export type EntryProjection = { entry?: ChartEntry; note?: string };
type EntryPosition = Pick<ChartEntry, 'wallet' | 'mint' | 'balanceRaw' | 'supplyRaw' | 'decimals' | 'updatedAt'>;
export type EntryInventory = { balanceRaw: string; slot: number; verifiedAt: number };
type Input = {
  scope: string; position: EntryPosition; receipts: Receipt[];
  minContextSlot?: number; blocked?: boolean; inventory: EntryInventory;
};
type State = {
  wallet: string; binding: string; position: EntryPosition;
  candidate: ChartEntryResult; verifiedAt?: number; failure?: string;
};
const keyFor = (scope: string, position: EntryPosition) => JSON.stringify([scope, position.wallet, position.mint]);
const samePosition = (left: EntryPosition, right: EntryPosition) => left.wallet === right.wallet && left.mint === right.mint
  && left.balanceRaw === right.balanceRaw && left.supplyRaw === right.supplyRaw && left.decimals === right.decimals;
function bindingFor(input: Input): string {
  const p = input.position;
  return JSON.stringify([p.balanceRaw, p.supplyRaw, p.decimals, input.minContextSlot,
    input.receipts.filter(r => r.wallet === p.wallet && r.mint === p.mint).map(r => {
      const f = r.feeReceipt;
      return [r.signature, r.side, r.status, r.createdAt, f?.state, f?.executionSucceeded, f?.zeroExtraFeesVerified,
        f?.tokenBeforeRaw, f?.tokenAfterRaw, f?.volumeLamports, f?.usd?.priceMicros, f?.blockTime, f?.slot];
    })]);
}

/** Entry evidence reuses confirmed known-account balances; no owner search or extra RPC. */
export function createChartEntryCache(now = Date.now) {
  const states = new Map<string, State>();
  function projection(state: State): EntryProjection {
    if ('unavailable' in state.candidate) return { note: `Avg entry unavailable: ${state.candidate.unavailable}` };
    if (state.failure) return { note: `Avg entry unavailable: ${state.failure}.` };
    const age = state.verifiedAt === undefined ? Infinity : now() - state.verifiedAt;
    if (age < 0 || age >= ENTRY_VALIDITY_MS) return { note: 'Avg entry unavailable: wallet verification expired.' };
    return { entry: { ...state.candidate, updatedAt: state.verifiedAt!, validUntil: state.verifiedAt! + ENTRY_VALIDITY_MS } };
  }
  return {
    project(input: Input): EntryProjection {
      const { position, scope, inventory } = input;
      if (input.blocked) {
        this.invalidateWallet(position.wallet);
        return { note: 'Avg entry unavailable: a wallet transaction is unresolved.' };
      }
      const key = keyFor(scope, position), binding = bindingFor(input);
      let state = states.get(key);
      if (!state || state.binding !== binding) {
        state = { wallet: position.wallet, binding, position: { ...position }, candidate: chartEntryFromReceipts(input.receipts, position) };
        states.set(key, state);
        if (states.size > 128) states.delete(states.keys().next().value!);
      }
      state.verifiedAt = undefined;
      if (!Number.isSafeInteger(inventory.slot) || !Number.isSafeInteger(input.minContextSlot ?? 0) || inventory.slot < (input.minContextSlot ?? 0)) {
        state.failure = 'wallet verification predates the confirmed transaction';
      } else if (inventory.balanceRaw !== position.balanceRaw) {
        state.failure = 'wallet holdings differ from tracked fills';
      } else if (!Number.isSafeInteger(inventory.verifiedAt) || inventory.verifiedAt > now()) {
        state.failure = 'wallet verification timestamp is invalid';
      } else {
        state.verifiedAt = inventory.verifiedAt;
        state.failure = undefined;
      }
      return projection(state);
    },
    current(scope: string, position: EntryPosition): EntryProjection {
      if (position.balanceRaw === '0') return {};
      const state = states.get(keyFor(scope, position));
      return state && samePosition(state.position, position) ? projection(state)
        : { note: 'Avg entry: waiting for matching confirmed holdings.' };
    },
    invalidatePosition(scope: string, wallet: string, mint: string) { states.delete(JSON.stringify([scope, wallet, mint])); },
    invalidateWallet(wallet: string) {
      for (const [key, state] of states) if (state.wallet === wallet) states.delete(key);
    },
  };
}
export type ChartEntryCache = ReturnType<typeof createChartEntryCache>;
