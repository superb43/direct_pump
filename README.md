# Direct Pump

Standalone repository: [superb43/direct_pump](https://github.com/superb43/direct_pump).

A personal Chrome MV3 execution panel on GMGN, Axiom and FOMO Family Solana token pages. Choose a buy
amount or sell percentage and approve the prepared transaction in Phantom.
No terminal trading API, private-key import, auto-confirm, backend or automatic retry.

## Install and update

Use Node.js 22 or later in this directory:

```sh
npm ci
npm run check
npm test
npm run build
```

Open `chrome://extensions`, enable Developer mode and load `.output/chrome-mv3`
as an unpacked extension. After an update, reload the extension and refresh the
GMGN/Axiom/FOMO page. The Settings title displays the installed version.

## Panel and settings

Version 0.6.0 opens trading only in the native Chrome side panel. The action
popup and on-page trading window are retired, including their setting controls.
Click the toolbar icon to open the panel; Chrome owns its close control.

- The top-left gear opens an extension-owned Settings **tab**. RPC and API keys
  never appear in the website's DOM.
- Token identity is displayed as `$SI (DEW9dS…i98WDP)`, using on-chain metadata
  and the actual mint. A ticker never determines the execution address.
- A trusted Phantom connection restores silently. No authorization popup is
  opened by the automatic restore. The panel follows active account changes.
- Change accounts inside Phantom. The panel follows the connected account
  automatically, typically within three seconds. New site/account permissions
  can require Connect Phantom. There is no separate account-switch button.
- Settings include RPC, slippage, priority-fee cap, SOL buy/sell presets and the
  Jupiter API key. Maximum SOL buy limits are optional under Advanced and default
  off. All buys enforce their SOL input budget; all sells target native SOL.
- Every buy preset and custom amount is **SOL**, regardless of the underlying
  WBTC, USDC, xStock or other pair. Non-SOL pairs use a single full Metis route
  SOL → intermediate asset(s) → token; sells reverse into SOL. Users do not need
  to pre-own the pool's quote asset. Intermediate assets are not converted in
  separate transactions. Network fees and account rent still apply.

Default RPC: `https://solana-rpc.publicnode.com`. Existing saved custom settings
are retained. "Test RPC connection" performs account reads, not signing/trading.

## SOL settlement and routing — version 0.4.0

| Underlying market | Execution |
|---|---|
| Supported SOL Pump curve / canonical PumpSwap | Local Pump SDK |
| Supported SOL Bonk/Stonk LaunchLab / CPMM | Local Raydium SDK |
| Supported SOL Meteora DBC / DAMM v2 | Local Meteora SDKs |
| Non-SOL pairs, including major launchpads | Entire SOL ↔ token route via Jupiter Metis |
| General/inverted PumpSwap or unresolved mint discovery | Entire SOL ↔ token route via Jupiter Metis |

The user authorized whole-route execution for non-SOL pairs. The route request
fixes only the SOL/token endpoints and exact input. It does not force WBTC, USDC,
a pool, a DEX or a single hop. Metis default price-optimization mode selects the
available path, including split/multi-hop routes. `mode=fast` is not used. The
first build permits 64 route accounts; only a transaction-size failure triggers
48/32/24-account rebuilds. This preserves price optimization while requiring one
atomic v0 transaction and one manual Phantom approval. This is the best available
feasible **Metis** path, not a claim to beat every RFQ or venue globally.

A Jupiter API key is required for automatic conversion. `/swap/v2/build` has no
Jupiter swap fee; platformFeeBps is explicitly 0, no feeAccount is requested,
and tips/referral/surplus-fee instructions are rejected. API usage remains subject
to the user's Jupiter plan. The extension never uses `/order`/managed execution.

The deployed Jupiter IDL is pinned with v1/v2 exact-input layouts and current
swap variants. Unknown instruction layouts fail closed. Sale proceeds must be
unwrapped to native SOL, not left as WSOL or the pool quote token.

Page pool hints are verified against the token. An indexed-discovery capability
failure can use mint-bound routing instead of blocking every non-Pump token.
Known mint/pool mismatches and ambiguous decoded pools still block. Unsupported
pool-only pages must be opened as mint pages; absent liquidity, transfer-hook
variants, transaction limits and unavailable API routes can still prevent trading.
“All pairs use SOL” describes settlement, not universal liquidity/support.

### Upstream behavior checked

- Pump.fun's public frontend `0hgp8pp-ukx.7.js` submits `mint`, `side`,
  `amount_in`, `denomination` and `venue_hint` to its server transaction builder.
  This confirms settlement selection is separate from the underlying pair. The
  private server optimizer is not publicly verified or copied.
- Stonk.fun's public home page at https://www.stonkfun.xyz loads
  https://plugin.jup.ag/plugin-v1.js; its public frontend also supplies Jupiter
  swap links. This proves Jupiter integration exists, not that every LaunchLab
  trade uses an identical internal path.
- Jupiter's Router/build documentation supplies the implementation contract:
  https://developers.jup.ag/docs/swap/build and
  https://developers.jup.ag/docs/api-reference/swap/build.

## Safety and diagnostics

The worker builds and validates the transaction before unsigned simulation.
Only the signing bridge runs in MAIN world. It deserializes the prepared v0
transaction and calls Phantom's native `signAndSendTransaction` method.

Policies bind pool/mints, payer, input budget, minimum output and wallet-owned
source/destination accounts. Unknown transfers, extra signers, referral/tip
instructions, nonzero router platform fees and undecoded router bytes are blocked.
Lookup tables returned by the router are checked against RPC data. Priority
instructions are replaced with the locally capped compute budget.

This bridge relies on the current website origin and Phantom approval. Shadow
DOM isolates styles, not security. The extension does not claim to prevent a
compromised website from tampering with provider calls or broadcasting a
user-approved transaction before an extension can reject it.

Every wallet has one unresolved-order lock. Prepared but uninvoked calls can be
cancelled atomically. A lost result is inspected in the page bridge first, then
reconciled against finalized chain history. Insufficient history coverage keeps
the order unresolved. No automatic re-signing, resend or timeout-based reset.
Changing RPC or deleting extension data is not evidence that a trade failed.

Simulation errors expose actual program/Anchor codes, instruction indices and
logs in the backend diagnostic record. Trade errors appear in a colored alert box; the Error details control is removed. Phantom input/permission rejection is reported as
not sent; genuinely ambiguous outcomes keep their actual diagnostic reason.

## Verification and limits

Run `npm test`, `npm run check`, `npm run build`. The browser preview at
`npm exec vite -- --host 127.0.0.1 --port 5178` → `/preview/` uses mocked wallet
responses and never trades. It checks English UI, ticker formatting, settings,
wallet restoration/account changes, duplicate-click protection and error display.

Read-only Mainnet checks are explicitly opt-in:

```sh
DIRECT_PUMP_READONLY_SMOKE=1 npm test -- tests/live-readonly.test.ts
```

They use funded public fixture accounts with unsigned simulation only. Verified:
PumpSwap SOL buy, MSTRx quote resolution, and a page-bound Raydium CPMM SOL→USDC
buy. They are not the user's wallet and do not prove every LaunchLab/Meteora
variant. Jupiter live requests remain unverified without a configured API key.
Actual installed Phantom signing still requires an integration check. Live DOM
readers have been checked on all three supported sites. No actual signature, broadcast, deployment or publication was performed.

Architecture and maintenance: [ARCHITECTURE.md](ARCHITECTURE.md).

## Fee receipts and savings — version 0.5.0

The panel displays **Fee Saved** = locally tracked USD trading volume
× 1%. Both buys and sells count once per transaction signature. This is a fixed
benchmark, not an assertion about any terminal's actual fee schedule or trading
profit. Volume is settled SOL turnover, excluding network fees and identified
account setup/refunds; it includes venue costs already reflected in settlement.

Confirmed transactions are matched to the entire built non-compute instruction
plan before zeros or volume are marked verified. An added SOL transfer fails this
check even if the trade itself is unchanged. Network total is taken from RPC;
priority is computed from the actual transaction's declared CU limit and price
with upward rounding, and removed from the base-network row to avoid counting it
twice. The requested priority cap is not presented as an actual paid fee.

Receipt rows emphasize **Our fee 0** and **Terminal fee 0**. Added Jito tip is 0;
this extension does not enable Jito tips. Until verified, zeros are labeled
planned/unverified. Fee audits run automatically. The dashboard Refresh action
re-reads chain data without connecting, signing or broadcasting. VIEW ON SOLSCAN links
to that transaction.

Pump/PumpSwap protocol, creator, LP and buyback fees are decoded where supported,
in the actual quote asset (e.g. WBTC is not mislabeled as SOL). Holder rewards
repeat creator fees and are not added again. Protocol breakdown is explicitly a
subset: other DEX fees or undecodable events remain unavailable, never guessed
as zero. Protocol fees are included in the trade amount; network/setup costs are
extra. Failed swaps are excluded from volume even when they pay network fees.

USD estimates use an anonymous Coinbase SOL/USD spot request near confirmation
(within five minutes); the source/time are retained with the trade. Missing price
or unisolated volume is excluded from the USD total and shown as unpriced. A
current price is not substituted for an old trade. Data lives in native local
IndexedDB with atomic signature deduplication. The RPC sees transaction reads;
Coinbase sees only SOL/USD requests, not wallet or transaction identifiers.

Earlier versions kept only the latest wallet receipt and no complete fee plan.
Their entire history cannot be reconstructed or retrospectively credited. The
counter tracks verified trades from this update; clearing extension data removes
local history. History writes/audits do not overwrite a newer in-flight order.

## Side panel only — version 0.6.0

The toolbar opens Chrome Side Panel directly; there is no action popup, on-page
window or presentation setting. Private settings and receipt dashboard use tabs.
Content scripts only detect token/pool/market hints and relay wallet requests.
The Open panel ambiguity is removed along with that retired overlay action.
Chrome 116+ and sidePanel permission are required.

## Receipt repairs and dashboard

Manifest equality compares program/data/account values, never JSON object-key
order. Chrome storage key reordering can no longer cause a false Mismatch. Real
additional instructions remain mismatches; even then actual RPC network costs are
shown and zero extras/savings are not asserted. Differences remain in the local audit record. A new audit version rechecks older locally archived fee plans.

The expanded-by-default **Fee Saved** footer has **Details**, opening a private
extension dashboard with totals, daily priced-volume bars, receipt search/filter,
fee columns, Solscan links and read-only re-verification. Full history is never
returned to website content scripts. Unknown/missing fees remain explicitly so.

Missing historical USD snapshots can use a Coinbase minute candle or a labeled
Coinbase daily estimate. Those are approximations, not fabricated trade-time spot
quotes. Source and reference timestamp are retained. A current spot price is not
substituted for an old trade. Only local tracked signatures are audited/credited.

## Position value and estimated net open PnL

Under SELL, holdings show Position Value and Est. net PnL. Quantity is RPC-backed;
visible current-token prices from GMGN, Axiom or FOMO update gross value on page polling. MC
fallback divides by on-chain supply and is labeled an estimate, since circulating
supply conventions may differ. Website price hints never set execution amounts
or on-chain limits. If no usable price appears, a sell quote supplies value.

Cost basis is weighted remaining acquisition cash outlay including real protocol
costs, network fees and setup/refunds, allocated on partial sells. Net open PnL
subtracts this cost from a fee/impact-inclusive executable sale quote less exit
network budget/base fee and estimated persistent route account setup. Temporary
WSOL rent returned on exit is not charged twice. Remaining open PnL excludes
already-realized partial-sale results. External inventory/untracked basis displays
Unavailable, never a guessed entry price. USD historical basis is preferred;
otherwise a labeled SOL-numeraire PnL is converted at the current SOL/USD quote.

Current exit quotes refresh periodically; live marked-price changes scale the
last quote until refreshed. Old exit quotes suppress PnL. This is estimated net
liquidation, not a guarantee of execution price. Non-SOL routes require a Jupiter
API key for an executable exit quote. Jupiter /swap/v2/build currently requires
x-api-key; direct supported SOL pairs work without it.

## Receipt presentation — version 0.6.1

Fee Saved remains a 1% benchmark of tracked, verified priced turnover; it is
expanded by default so Details is visible. The receipt dashboard defaults to USD.
The top-left USD/SOL control changes cards, volume chart, table and fee detail
amounts, using each receipt's historical SOL/USD snapshot rather than today's
price. The same priced-trade population backs the benchmark in either unit.

Fee total sits beside turnover and adds decoded protocol costs to actual network
costs. Priority is already included in network total. Rent deposits/refunds are
shown separately, not included in fees. Missing protocol decoders or asset prices
produce a known subtotal with a ≥ marker, not a claimed complete total. Non-SOL protocol
amounts without historical prices are Unpriced with their original asset shown
in the detail sheet. Small USD fees retain up to six decimals.

Click Fee total or Protocol fees for a grouped fee sheet. Protocol
fees have a known subtotal and applicable Protocol, LP, Creator, Buyback, Partner,
Fund, Platform or token-transfer rows. Categories need not be identical across
venues; unavailable components are never generated from assumed percentages.
The dashboard Refresh action fetches confirmed RPC data, compares the saved instruction plan and
updates local fee/savings records. It never signs or sends another transaction.

Default slippage remains 5%; 15% is available in Settings. At 15%, the minimum
received can be 85% of the quote. Existing user settings are preserved.

Fee taxonomy sources: [Pump](https://pump.fun/docs/fees),
[Meteora DBC](https://github.com/MeteoraAg/dynamic-bonding-curve),
[Raydium fee comparison](https://github.com/raydium-io/raydium-docs-v1/blob/main/reference/fee-comparison.mdx).

## Live position and compact receipts — version 0.6.2

GMGN DOM changes publish extracted price/MC hints with a 100ms throttle; only
matching active-tab/mint hints affect display. Existing context polling is retained
as fallback. Mark values never enter execution instructions or spending limits.
Additional div/adjacent-label variants are covered by DOM fixtures. Live DOM
compatibility on all three sites was subsequently verified for version 0.7.0.

Holdings/basis refresh separately from expensive full liquidation quotes, so a
slow route build does not delay quantity display. Passive holdings poll every 2s;
exit quotes every 6s, with separate 1s/5s worker caches. Confirmation and completed
audit storage events force immediate holdings and quote requests, bypass caches.
RPC balance reads use the known confirmed slot as minContextSlot. Sequence checks
and balance timestamps prevent older quote responses overwriting newer holdings.
Quote-derived PnL is still estimated, not a continuously executable guarantee.

Sell estimate (after venue fees) means a quote of liquidating the entire balance
is being used as the value source when no page mark is available. Missing quotes
are labeled Live price unavailable rather than falsely claiming an executable
quote. Route/API/price failures can leave net PnL unavailable.

Trade receipts have no Verification column or per-row Recheck. Fee total and
Protocol fees cells contain only their amount; no Partial/Details/category-count
badges. Known subtotals retain ≥ and hover/detail coverage notes rather than
claiming undecoded fees are zero. Main-panel receipts use compact totals plus
click-to-open fee breakdown and Our/Terminal fee emphasis. Removed its explanatory
footer, TX text line, verification details and Recheck fees action; Solscan stays.

Router protection compares the decoded instruction minimum against the API quote
minimum. A one-atom floor/ceil discrepancy strengthens the encoded quote until
its floor minimum meets the original promise, preserving slippage and input. A
larger mismatch is rejected with both bounds and their raw-unit difference before
Phantom. No live Jupiter build was verified without a configured API key.


## Three sites and bounded architecture — version 0.7.0

Only HTTPS Solana token pages on `gmgn.ai`, `axiom.trade`, and `fomo.family`
are supported. GMGN and FOMO URLs contain a mint; Axiom URLs contain a pool.
Axiom's current-token Solscan link supplies a mint hint that must match the
on-chain pool. Token identity and page-bound pool hints cannot change under an
in-flight panel request: reopen/refreshed context is required first.

Page prices are read only from the current-token summary. FOMO trending tokens
and holder entry prices are excluded. Axiom's HTML subscript zero-count format
is expanded before decimal parsing. Missing or ambiguous values clear the old
mark; the executable sell estimate remains available where a route exists.
Position sources identify the actual site. DOM hints never set signing amounts.

Meteora DLMM pool identity is decoded using a pinned account-only official IDL.
Program owner, discriminator, length and mint membership are checked before
SOL routing through the existing Jupiter builder. A Jupiter API key is required
for those builds; no local DLMM swap SDK or terminal API was added. Unknown
pool-only pages still fail closed. Website login does not connect Phantom or
provide access to the site's custodial/embedded wallet.

Responsibilities are separated without introducing a framework:

- `src/sites/catalog.ts`: URL identity, host permissions and context keys.
- `src/adapters.ts`: bounded site DOM hints; `src/market.ts`: valuation functions.
- `src/panel-view.ts` and `src/panel-controller.ts`: rendering and panel state.
- `src/trading-window.ts`: active tab/context lifecycle and stale-response guards.
- `src/execution.ts`: shared verified route resolution for token info, positions
  and trade building; SDK builders retain venue-specific validation.
- `src/worker/`: request authorization, persistent order recovery/audit, and
  read queries/cache. Settings, receipt storage and IndexedDB schemas are retained.

The wallet-wide unresolved-order lock applies across all three sites. Changing
pages does not cancel an invoked Phantom request or release this lock. Old panel
responses cannot render into the new token/account. Confirmed receipts arriving
before token metadata are replayed once the verified mint is known.

Offline gates: `npm test`, `npm run check`, `npm run build`.
Browser DOM fixtures use the existing WXT/Vite installation and an already-open
Brave token tab on macOS (Allow JavaScript from Apple Events must be enabled):

```sh
npm run test:sites
npm run test:sites -- --live
DIRECT_PUMP_SITES_READONLY=1 npm test -- tests/live-sites-readonly.test.ts
```

`test:sites` evaluates sanitized fixtures through the real browser DOM; `--live`
also checks every supported token tab and requires all three sites to be open.
Both only read the pages, never call wallet methods. The mainnet identity check
only reads public accounts and resolves the same SI mint from the three contexts.
Fixture/live DOM and mainnet identity checks passed. The browser mock preview
supports `?site=fomo` and `?site=axiom` on `/preview/sidepanel.html`, including
`&position&receipt`. Actual Phantom signing and Jupiter live builds remain
unverified; no real approval, signature or broadcast was performed.


## Architecture maintenance — version 0.7.1

The three sites implement the same DOM reader contract. Domain metadata and
permissions come from one exhaustive catalog. Financial/UI modules cannot import
DOM readers, including transitively; architecture tests enforce this boundary.
Common panel, relay and worker scenarios run against all three site contexts.

`pageKey` identifies the browser page; `targetKey` additionally pins mint/pool
hints for execution and caches. A hint update revalidates token/position state
without recreating the panel or resetting its wallet-wide pending lock. Early
Axiom prices are retained until the resolved mint matches. Slow passive context
requests and identical pending position lookups are shared rather than restarted.

Unchanged context reads reuse one DOM observation; mutations invalidate it,
lightweight URL checks detect navigation, and a five-second sample refreshes
price freshness. Every relayed execution request forces a current observation.
One panel timer owns wallet/status, holdings, quotes and savings refresh cadence.

```sh
npm run verify          # portable typecheck + all offline tests + production build
npm run verify:browser  # adds real DOM fixtures in an already-running macOS Brave
npm run test:sites -- --live  # requires token tabs on all three sites
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing a shared feature. The
standalone repository runs `npm run verify` in CI; the macOS Brave fixture/live
checks remain separate because they require a logged-in local browser. No new
runtime or test dependency was added. Provider/signing integration is still a
separate check; these commands never approve or send a real transaction.


Local workspace: `/Users/kjw/Github/direct_pump`. The former ai_play utility path
is a local compatibility symlink so an existing unpacked-extension path continues
to resolve. Git tracks only this standalone source project; generated builds and
local browser artifacts remain ignored. Reload the extension after rebuilding.
