# Contributing to Direct Pump

Direct Pump is a WXT / vanilla TypeScript Chrome MV3 extension with an optional
self-hosted Pro server. Start with [README](README.md) and the
[public architecture](docs/ARCHITECTURE.md). Use Node.js 24 LTS and `npm ci`.

## Changes and verification

1. Open an issue for a substantial feature, new provider, dependency or schema
   change before implementation. Small fixes can go directly to a pull request.
2. Keep one concrete change per PR. Include the problem, resulting behavior,
   affected site/mode and actual verification. Preserve unrelated edits.
3. Run `npm run verify`. Run the affected regression tests before broad rewrites.
   Include stale-response, navigation and recovery cases when relevant.
4. Shared behavior must cover GMGN, Axiom and FOMO; Axiom pages bind a pool, not
   an interchangeable mint. Site-specific parsing belongs in `src/sites/`.
5. Selector changes require the Brave fixture gate and applicable live read-only
   checks. Network tests are opt-in. Report skipped or unavailable checks honestly.
6. UI changes must follow existing design tokens and include screenshots at real
   side-panel widths. Preserve keyboard focus, reduced motion and error states.

## Financial and privacy boundaries

- Basic trades retain explicit Phantom approval, frame/document checks, immutable
  targets, prepared-call cancellation and wallet-wide unresolved locks.
- Pro keys stay in the private signer. Native extension views cannot upload a
  private key or request arbitrary-transaction signing. Keep private signer
  reservations authoritative and engine reservations a separate mirror.
- Preserve exact recorded-byte recovery. Never unlock an uncertain transaction
  using elapsed time, fabricate a balance/price, silently retarget an order, or
  resend a transaction merely to test a patch.
- Tests and screenshots use synthetic data and unfunded test identities. Never
  sign/trade with funded accounts, deploy services or send live alerts for CI.
- Do not submit secrets, encrypted keystores, wallet databases, session tokens,
  pairing codes, provider keys or diagnostic exports containing private details.
- Do not add runtime dependencies, frameworks or financial schema migrations
  without explicit maintainer agreement.

Security-sensitive changes to signing, recovery, policy, storage, withdrawal or
CI require independent review. Normal PR CI has no production credentials and
runs on GitHub-hosted runners, never on a personal signer host.

## License and authorship

Contributions to original application code are accepted under **GPL-3.0-only**.
You retain copyright in your contribution. Confirm that you have the right to
submit it and identify any copied code, assets, generated material or additional
license obligations. Third-party materials retain their original licenses.
No copyright assignment or unrelated commercial licensing rights are implied.

When a dependency changes, update the lockfile, run
`node scripts/third-party-notices.mjs --write`, review the generated license
inventory and provenance, then run `npm run check:publication`. Do not hide an
unknown license or missing attribution through an allowlist.

Ordinary bugs belong in GitHub Issues. Vulnerabilities follow [SECURITY](SECURITY.md).
Participation follows the [code of conduct](CODE_OF_CONDUCT.md).
