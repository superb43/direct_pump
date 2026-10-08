# Direct Pump architecture

WXT + vanilla TypeScript, three fixed Solana sites, one native side panel, one
manual Phantom signing path. Keep changes focused; no framework, generic plugin
system, service container or dependency is needed for adding a shared control.

## Boundaries

| Layer | Responsibility | Dependencies |
|---|---|---|
| `sites/catalog.ts` | Exhaustive URL/label/source/permission metadata | Types only |
| `sites/{gmgn,axiom,fomo}.ts` | Current-token DOM facts | Shared DOM/decimal helpers |
| `sites/reader.ts` | Fixed typed reader registry and common hints | Three readers/catalog |
| `page-context.ts`, content entry | Observation lifetime and trusted panel relay | Pure catalog + injected reader |
| `trading-window.ts` | Active tab, page mount lifetime, context updates | Shared panel, pure catalog |
| `panel-controller.ts`, `panel-view.ts` | One feature behavior and one rendering surface | Public messages, financial projection |
| `messages.ts`, `worker/policy.ts` | One request-access table and actual sender verification | Browser/source identity |
| `worker/orders.ts` | Wallet locks, persisted orders, recovery/audits | Verified execution and wallet bridge |
| `worker/queries.ts` | Read requests, shared position jobs, invalidation | Token/position/ledger readers |
| `execution.ts`, SDK builders | On-chain identity and transaction construction/validation | Protocol SDKs, RPC |
| `market.ts`, `position-view.ts` | Decimal/integer display calculations | Types, decimal functions; no DOM |

`PageTarget` is a page assertion, not an already-verified on-chain route. Site
prices are display hints, not signing limits. The resolver binds known pool
owners/layouts to mints; builders validate actual instructions and unsigned
simulation before any manual Phantom request.

## Identity and asynchronous ownership

- `pageKey`: site + page kind + URL address. Query/referral noise does not remount
  the same token. A different tab or page destroys its old controller.
- `targetKey`: page identity + mint/pool hints. Trades and route-dependent caches
  never silently switch contexts. Hint drift disables trading until revalidated.
- Same-page hint updates keep wallet/pending state, clear old asset/quote/holdings
  state, and reject stale responses with owned sequence numbers.
- Captured trade target/intent stays immutable across asynchronous wallet work.
  A context change before submission requires a new user request.
- Passive polls share slow current-page work; real navigation can supersede it.
  Pending position cache entries include receipt lookup and outlive their normal
  TTL until completed; explicit refresh still bypasses them.
- Wallet-wide pending state lives in the worker, survives UI changes/restarts,
  and is released only with actual result evidence. Prepared-call cancellation,
  legacy bridge inspection and chain reconciliation remain fail-safe boundaries.

## Changing a feature

1. Put common behavior in the shared controller, worker or financial module.
   Site-specific selectors and extraction belong in one site reader only.
2. Run the same relevant scenario against `SITE_CONTEXTS` in tests, including
   AXIOM pool identity and early/delayed metadata, not only GMGN mint identity.
3. Preserve request-access restrictions, immutable context binding, unknown-order
   locks, quote baselines and old-response teardown behavior.
4. Run `npm run verify`. Architecture tests recursively detect forbidden DOM
   imports in common UI/financial/worker modules and site-selection leakage.
5. If selectors changed, run the Brave fixture gate and all three live readers.
   Browser fixtures are not portable CI and signing is never implied by them.

Unknown/missing price means no page mark. An unavailable indexed-discovery
capability may use the existing verified mint-bound Jupiter path; ambiguous or
mismatched pools still fail. No automatic signing, resend, timeout-based unlock,
private-key import or exposure of settings/history to site DOM is permitted.
