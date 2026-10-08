# Direct Pump development contract

- This repository is a standalone WXT/vanilla TypeScript Chrome MV3 extension.
  Read ARCHITECTURE.md and DESIGN.md for relevant changes.
- Support only GMGN, Axiom and FOMO Family Solana token pages. Site differences
  belong in typed site readers/catalog; shared features use one controller/worker.
- Keep changes small and preserve existing settings/receipt/IndexedDB schemas.
  Do not add dependencies, frameworks or generalized plugin machinery unasked.
- Before cleanup, identify protected behavior, targeted regression evidence and
  a bounded cleanup order. Preserve unrelated user edits.
- Check common changes against all three SITE_CONTEXTS, including Axiom's POOL
  identity, early metadata/price, hint drift and wallet changes.
- Keep market/UI calculation free of DOM-reader runtime imports. Preserve strict
  targetKey trade/cache binding and pageKey UI lifecycle separation.
- Run npm run verify. DOM changes also require npm run test:sites and applicable
  live Brave reads. Network tests are explicitly opt-in; never claim skipped tests
  passed. Report actual verification and remaining provider/runtime limits.
- Retain manual Phantom approval, frame/document checks, wallet-wide unresolved
  locks, prepared cancellation and chain/legacy-bridge recovery. Never trade,
  sign, resend or unlock uncertainty merely to test a refactor.
- Credentials stay in extension-owned storage; never commit local credentials,
  node_modules, .wxt, .output or browser artifacts.
- Commit/push/publish only when authorized; stage named task-owned files. Never
  git add . or git add -A, force-push, bypass hooks, or switch another task's branch.
