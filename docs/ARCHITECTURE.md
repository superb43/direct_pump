# Public architecture and protected behavior

Direct Pump is a standalone WXT / vanilla TypeScript Chrome MV3 extension.
It supports GMGN, Axiom and FOMO Family Solana token pages through fixed typed
readers and one shared controller/worker. It also includes an optional self-hosted
Pro API/engine/private-signer path. No hosted wallet service is implied.

| Boundary | Responsibility |
| --- | --- |
| `src/sites/catalog.ts`, site readers | Fixed URL identities and page facts; site differences stay here |
| Content/side-panel relay | Verified tab/frame/document and current-page lifetime |
| Panel controller/view | Shared controls, immutable captured intent and owned async responses |
| `src/worker/policy.ts`, orders/queries | Sender authorization, pending wallet locks, shared read lifetimes |
| Execution/builders/simulation | On-chain identity, actual instructions, limits and unsigned validation |
| Position/portfolio projections | Integer financial calculations; no DOM-reader runtime imports |
| Pro API/engine | Authenticated native-view commands, durable intent, observation and mirrored state |
| Private signer/withdrawal authority | Keys, independent authorization, exact bytes and private reservations |

`pageKey` controls page mount lifetime. `targetKey` binds trades and route-dependent
caches to page identity and mint/pool hints. Axiom's pool URL never becomes a mint
assertion. Hint drift invalidates trading until revalidation; old async callbacks
cannot mutate a new target or mounted view.

Basic requires manual Phantom approval. Unresolved wallet transactions survive
navigation/restarts and retain locks until actual chain/bridge evidence settles
them. Pro has a separately funded private wallet and independent signer authority;
keys and arbitrary signing requests never enter site DOM or browser storage.

Unsigned Pro recovery checks current order/device/signer authority and fresh
conditions for every order version. Already-signed recovery preserves recorded
bytes. Confirmed entry fills control protective exits and shared split inventory.
Withdrawals and trades share private reservations; API state cannot authorize
spending. Timeouts alone never release uncertainty.

Price display jobs, chart overlays and USD conversion remain separate from signing.
Only verified display projections cross permitted content bridges. Missing prices,
unknown fees and incomplete basis stay explicit. Financial receipts and schemas
remain separate from operational diagnostics, whose sanitization precedes storage.

Review/pending-intent helpers, trigger/exit calculations and risk policy are pure
modules. The engine and signer apply shared policies to independently owned facts.
The daily buy cap covers a rolling 24 hours plus older unsettled attempts. State
and reservation changes retain their atomic/durable recovery boundaries.

Use [CONTRIBUTING](../CONTRIBUTING.md) for change gates and
[Pro operations](PRO.md) for deployment and recovery constraints. Internal agent
instructions and local planning records are not public build dependencies.
