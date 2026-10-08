# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-08
- Primary product surfaces: native side panel, private Settings tab and receipt dashboard tab.
- Evidence reviewed: src/panel-view.ts, src/panel-controller.ts, entrypoints/sidepanel/, entrypoints/content.ts, README.md; user requests for compact manual execution and verified cost visibility. No external approved visual reference supplied; prior shared-panel screenshots guide consistency.

## Brand
- Personality: precise, restrained, professional.
- Trust signals: clear token and payment asset, Phantom identity, honest execution label.
- Avoid: meme art, neon charts, clutter and misleading universal direct-execution claims.

## Product goals
- Goals: trade the current token without copying addresses; fast manual buy/sell.
- Non-goals: replace terminal analytics or automate approval.
- Success signals: one consistent native side-panel trading surface, settings accessible through a recognizable gear.

## Personas and jobs
- Primary personas: personal Solana trader using GMGN/Axiom/FOMO Family and Phantom.
- User jobs: choose an amount, approve, see result; keep the chart visible beside the panel.
- Key contexts of use: changing tokens in SPA pages, connected wallet, busy chart.

## Information architecture
- Primary navigation: trading first; Settings through gear.
- Core routes/screens: sidepanel.html trading, settings.html configuration, dashboard.html local receipts.
- Content hierarchy: brand/settings, ticker, wallet, buy, sell, position/net open PnL, colored status, receipt, expanded-by-default Fee Saved footer with Details.

## Design principles
- Chrome owns side-panel visibility; pending order tracking remains in the worker.
- Use one native side-panel trading surface; content scripts provide context only.
- Tradeoffs: the native side panel remains open through Phantom focus; settings and history open as tabs.

## Visual language
- Color: charcoal #11161d, border #29313c, muted #9da9ba, mint #88f0bb, rose #f7a9bc.
- Typography: local system sans; monospace addresses; tabular input numerals.
- Spacing/layout rhythm: 7–10px control gaps, 18px panel padding, clear 20–22px section breaks.
- Shape/radius/elevation: 18px panel, 9px controls, restrained panel shadow.
- Motion: short button transitions only; honor reduced motion.
- Imagery/iconography: generated arrow/lightning raster app icon, selected locally bundled Lucide paths.

## Components
- Existing components to reuse: mountPanel, preset controls, colored status alerts.
- New/changed components: cog, native side-panel variant, optional limits accordion, position summary, expanded-by-default Fee Saved footer, fee receipt and dashboard.
- Variants and states: native side panel; savings collapsed/expanded; enabled/disabled; connected/disconnected. Account selection stays in Phantom; no switch icon.
- Token/component ownership: src/panel-view.ts owns panel styles; settings/style.css owns private form.

## Accessibility
- Target standard: readable controls, keyboard navigation and visible focus.
- Keyboard/focus behavior: native buttons/inputs, labeled icon actions and aria-expanded.
- Contrast/readability: muted text readable against dark surface, color accompanied by BUY/SELL labels. Routed caption states SOL settlement.
- Screen-reader semantics: named trading region, polite status, decorative SVGs hidden.
- Reduced motion and sensory considerations: disable transitions under reduced-motion preference.

## Responsive behavior
- Supported breakpoints/devices: desktop Chrome extension, small browser windows.
- Layout adaptations: narrow native side panel with scrolling; responsive settings and dashboard tabs.
- Touch/hover differences: native click controls, 38px primary targets; no hover-only functionality.

## Interaction states
- Loading: token/route and wallet restore messages.
- Empty: open a supported token tab; Settings stays accessible.
- Error: actionable status in a bordered rose alert box.
- Success: confirmed status and explorer link.
- Disabled: pending, building, missing valid route.
- Offline/slow network: preserve explicit RPC errors and prevent duplicate pending trades.

## Content voice
- Tone: short, factual English.
- Terminology: BUY · SOL, SELL · Receive SOL; Est. net PnL; Fee Saved.
- Fee content: label savings as a 1% estimate, identify coverage and price source. Verified zeros require a matching instruction plan; unknown protocol fees stay unavailable.
- Microcopy rules: do not imply protocol/network/rent are free. SOL in every buy label and sell receipt. Underlying pairs stay internal.

## Implementation constraints
- Framework/styling system: WXT + vanilla TypeScript/CSS; no new UI dependencies.
- Design-token constraints: extend native styles, referencing shadcn semantic-token principles.
- Performance constraints: no remote fonts, runtime image/icon service or analytics.
- Compatibility constraints: private credentials remain in extension-owned Settings; worker frame checks preserved.
- Test/screenshot expectations: offline relay tests, type check/build, browser sidebar rendering, savings expansion and dashboard filtering; no real trade required.

## Open questions
- None blocking this revision. Existing unsupported venue limitations remain documented in README.md.

## Current decisions — 0.6.0
- Side panel is the sole production trading surface. No popup/on-page display mode.
- Errors use a bordered rose alert box; successful status uses a restrained green box. No Error details toggle.
- Position Value follows the active site's marks; net open PnL includes entry and forecast exit costs, labeled estimated and suppressed when basis/quote is missing.
- Fee Saved is expanded by default at the bottom; remove No Terminal Fee / Direct to the launchpad marketing copy. Details opens the private dashboard.

## Current decisions — 0.6.1
- Receipts default to USD with a top-left dollar/Solana currency toggle.
- Table fee cells show compact subtotals and open a grouped detail sheet on click.
- Incomplete totals are visibly Partial; rent is separate from fee total.
- Audits remain automatic; per-row verification controls are removed.

## Current decisions — 0.6.2
- Compact main-panel receipt table; fee breakdown opens on clicking a total.
- No Verification column, category counts or Partial/Details cell badges.
- Unknown coverage remains in ≥ subtotal markers and detail/hover explanations.
- No main receipt footer explanation, TX text line, verification details or Recheck.
- GMGN mark pushes render immediately; confirmed holdings update separately from
  slower liquidation quotes, with stale-response protection.


## Current decisions — 0.7.0
- Support only GMGN, Axiom and FOMO Family Solana token pages through the same
  native side panel. Website login and Phantom permissions remain separate.
- Site adapters own DOM selectors; the pure site catalog owns URL matching and
  host permissions. Axiom pools and mint hints are verified on chain.
- Position source names the site. FOMO marks exclude trending and holder prices;
  Axiom compact HTML subscript prices are decoded explicitly.
- View and controller are separate; remove retired floating/close/collapse modes.
  Settings, dashboard, compact receipt content and existing visual tokens remain.
- Tab/token/account changes discard stale UI responses while the worker retains
  wallet-wide unresolved-order tracking. Metadata loading cannot lose receipts.
- Live DOM readers and sanitized browser fixtures were verified on Brave. The
  three SI contexts resolve the same mint through public on-chain reads. Phantom
  provider/signing integration is unverified; no real transaction was sent.


## Current decisions — 0.7.1
- A shared feature has one controller and a three-site scenario matrix. DOM
  variation stays inside the fixed typed site readers; no site-specific UI.
- Page identity determines mount lifetime. Enriched execution context determines
  route validation/cache identity. Changing hints revalidates assets and keeps
  wallet state and pending-order locks.
- Passive context polling and position reads share existing slow work. Context
  freshness is sampled at five seconds and DOM mutation pushes stay throttled.
- Financial projection has no runtime dependency on site DOM readers. Module
  boundaries and shared cross-site behavior are checked in the portable gate.
- Native side-panel appearance and manual Phantom approval remain unchanged.
