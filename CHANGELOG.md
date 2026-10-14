# Changelog

## 0.8.0 — 2026-10-14

### Basic

- Reduce duplicate display RPC reads with bounded account batching, shared quotes and verified Pump/PumpSwap account discovery. Signing keeps its independent fresh checks.
- Preserve tracked acquisition averages when holdings differ after transfers or liquidity activity, with estimated cost-basis labels where applicable.
- Improve Token-2022 metadata decoding and holdings/price refresh behavior across GMGN, Axiom and FOMO Family.

### Pro

- Add independent Market/Limit confirmation preferences, up to eight trading profiles, native-panel preset hotkeys and configurable browser shortcuts. Market confirmation defaults off; Limit defaults on. Strategies retain explicit review.
- Add server-verified position accounting for cost basis, realized/open PnL and unrecovered SOL, plus Sell Initials quantity estimates. Recovery uses the existing authorized sell path; it never schedules an automatic follow-up.
- Improve order values, split-exit progress, trailing MC details and self-hosted onboarding.

### Documentation and maintenance

- Expand README Basic/Pro features, setup instructions and screenshots; include privacy and store-listing preparation documents.
- Group Basic feature modules and regression tests by responsibility without adding dependencies or frameworks.

### Compatibility and updates

- Update extension and Pro server together for the new portfolio/recovery capabilities. Older servers hide unsupported reads; API v1/v2 execution meanings and existing financial journals, settings and receipt schemas are retained. New native trading preferences use a separate key.
- Reload the existing extension to retain settings and local receipts. Pro server replacement requires acknowledged order pause, a private-console signer lock, a consistent state backup, and explicit operator resume; do not replace live signer processes or reset unresolved reservations.
- This release distributes extension, Pro server and matching source archives through GitHub. Browser-store submission and operating server deployment are separate actions.

### Verification and limits

- Node.js 24: type checks, offline regression tests, extension/Pro builds and publication/license gates.
- Brave: site DOM fixtures and live read-only token readers for GMGN, Axiom (POOL identity) and FOMO Family.
- Synthetic Chromium: Pro trading/profile/confirmation/hotkey/recovery flows and narrow-panel screenshots. These checks use mocks, not a funded wallet or live signer.
- Opt-in provider integration tests are skipped. No funded signing, trading, withdrawal, live alert or production server deployment is performed for verification.
- Dependency audits retain known findings; release publication requires advisory-specific reachability evidence and independent review. See the release notes for the final audit disposition and remaining runtime limitations.
