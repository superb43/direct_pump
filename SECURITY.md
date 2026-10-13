# Security policy

## Supported versions

The latest tagged release is the supported security target. Older releases may
receive fixes at maintainer discretion; this is not an LTS commitment. Changes on
`main` are development code. An open-source license is not a security audit,
custody guarantee, execution guarantee or promise of investment returns.

## Private vulnerability reports

Use **Security → Advisories → Report a vulnerability** in
[superb43/direct_pump](https://github.com/superb43/direct_pump/security/advisories)
when private vulnerability reporting is enabled. This channel must be enabled
immediately after the repository becomes public and before inviting reports. If the form is unavailable, do
not publish exploit details, wallet information or credentials in an issue;
wait for a confirmed private reporting channel.

Report affected versions, Basic/Pro mode, platform/site, reproducible steps using
synthetic data, expected/actual behavior and potential impact. Remove private
keys, mnemonics, API keys, pairing codes, authentication envelopes, wallet
databases and unrelated personal data. A maintainer may request additional
redacted evidence through the private report.

The project aims to acknowledge reports within seven days, subject to maintainer
availability. Remediation and coordinated disclosure depend on severity and a
verified fix; there is no paid bounty or guaranteed response SLA.

## Safe research

Research on your own isolated environment and unfunded test identities is welcome.
Do not access other users' systems, execute funded trades, move assets, bypass
wallet approval or send live alerts. Report discovered credentials privately;
the owner must revoke or rotate them before relying on history removal.

Basic preserves manual Phantom approval. Pro is a separate server-wallet path:
the signer owns keys and reservations, and signed/unknown attempts remain tracked.
Do not delete journals, create compensating orders or reset uncertainty locks as
an incident shortcut. Follow [Pro recovery](docs/PRO.md#orders-and-recovery).

CI and public tests must never have access to a funded wallet, production signer,
deployment credentials or private provider accounts. Security fixes require
independent review and relevant regression evidence before release.

## Known dependency findings — 2026-10-13

Both `npm audit --json` and `npm audit --omit=dev --json` returned exit code 1:
18 affected dependency entries (11 High, 7 Moderate, 0 Critical). These counts
include downstream SDKs affected by the same transitive advisory; the reports
identify seven distinct advisories, listed below. No dependency versions or
audit suppressions were changed during source-publication preparation.

| Locked package | npm-reported severity | Advisory |
| --- | --- | --- |
| bigint-buffer@1.1.5 | High | [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) |
| stream-json@1.9.1 | Moderate | [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x) |
| stream-json@1.9.1 | Moderate | [GHSA-hqr4-qq8f-hg3x](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x) |
| stream-json@1.9.1 | Moderate | [GHSA-mjw6-4jj6-33hc](https://github.com/advisories/GHSA-mjw6-4jj6-33hc) |
| toml@3.0.0 | High | [GHSA-82x6-q7mm-w9cf](https://github.com/advisories/GHSA-82x6-q7mm-w9cf) |
| toml@3.0.0 | High | [GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) |
| uuid@8.3.2 | Moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

The Pro build explicitly selects bigint-buffer's existing JavaScript browser
implementation and asserts that no native bigint implementation enters or loads
in that bundle (`scripts/build-pro-server.mjs`). This is a scoped native-path
mitigation; it does not clear the package audit or resolve the other advisories.
Direct execution of unbundled source has not received the same guarantee.

Full advisory reachability analysis and remediation remain open. Source
publication and passing CI do not approve a production deployment or binary
release. Before a binary release, resolve reachable High findings and record any
accepted advisory-specific exceptions with evidence and independent review under
[the release policy](docs/RELEASING.md#routine-maintenance-and-dependency-decisions).
Re-run the full and production audit after SDK/lockfile changes or new advisories.
