# Direct Pump project guide

[README](../README.md) · [Contributing](#contributing) · [Security](#security) · [Architecture](#architecture) · [Pro setup](#pro-setup) · [Pro operations](#pro-operations) · [Maintenance](#releases-and-maintenance) · [License](#copyright-and-license)

## Contributing

Direct Pump is a WXT / vanilla TypeScript Chrome MV3 extension with an optional
self-hosted Pro server. Start with [README](../README.md) and the
[public architecture](#architecture). Use Node.js 24 LTS and `npm ci`.

### Changes and verification

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

### Financial and privacy boundaries

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

### License and authorship

Contributions to original application code are accepted under **GPL-3.0-only**.
You retain copyright in your contribution. Confirm that you have the right to
submit it and identify any copied code, assets, generated material or additional
license obligations. Third-party materials retain their original licenses.
No copyright assignment or unrelated commercial licensing rights are implied.

When a dependency changes, update the lockfile, run
`node scripts/third-party-notices.mjs --write`, review the generated license
inventory and provenance, then run `npm run check:publication`. Do not hide an
unknown license or missing attribution through an allowlist.

Ordinary bugs belong in GitHub Issues. Vulnerabilities follow [SECURITY](#security).
Participation follows the [code of conduct](#community-conduct).

## Community conduct

Direct Pump welcomes constructive participation across backgrounds and experience
levels. Discuss evidence and behavior, credit others' work and respect privacy.
Critique code and decisions without attacking people.

Harassment, discrimination, threats, impersonation, scams, unsolicited financial
promotion, doxxing and posting another person's credentials or wallet records are
not acceptable. Do not present a fork, paid service or third-party trading result
as endorsed by this project without permission.

Maintainers may remove content, close discussions, restrict participation or block
accounts when necessary. Responses should be proportionate and consider impact,
context and repeated behavior. Maintainers follow the same rules.

Report abuse involving GitHub accounts or content through
[GitHub's private abuse report](https://github.com/contact/report-abuse).
Maintainers can also moderate repository content through GitHub's reporting and
blocking tools. A project-specific private contact may be added when the
maintainer publishes one; do not expose personal details in a public issue.

Security vulnerabilities and credentials use the separate [security policy](#security).
This conduct policy applies to repository issues, pull requests, discussions and
other spaces explicitly maintained by Direct Pump. It does not claim authority
over unrelated communities or private trading activity.

## Security

### Supported versions

Before the first tagged release, security reports are accepted for the current
`main` commit on a best-effort basis; include the affected commit SHA. Once tagged
releases are published, the latest tagged release is the security-maintenance
target. Older releases may receive fixes at maintainer discretion; this is not an
LTS commitment. Development code and previews are not a production-safety
commitment. An open-source license is not a security audit, custody guarantee,
execution guarantee or promise of investment returns.

### Private vulnerability reports

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

### Safe research

Research on your own isolated environment and unfunded test identities is welcome.
Do not access other users' systems, execute funded trades, move assets, bypass
wallet approval or send live alerts. Report discovered credentials privately;
the owner must revoke or rotate them before relying on history removal.

Basic preserves manual Phantom approval. Pro is a separate server-wallet path:
the signer owns keys and reservations, and signed/unknown attempts remain tracked.
Do not delete journals, create compensating orders or reset uncertainty locks as
an incident shortcut. Follow [Pro recovery](#orders-and-recovery).

CI and public tests must never have access to a funded wallet, production signer,
deployment credentials or private provider accounts. Security fixes require
independent review and relevant regression evidence before release.

### Known dependency findings — 2026-10-13

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
[the release policy](#routine-maintenance-and-dependency-decisions).
Re-run the full and production audit after SDK/lockfile changes or new advisories.

## Architecture

Direct Pump is a standalone WXT / vanilla TypeScript Chrome MV3 extension.
It supports GMGN, Axiom and FOMO Family Solana token pages through fixed typed
readers and one shared controller/worker. It also includes an optional self-hosted
Pro API/engine/private-signer path. No hosted wallet service is implied.

| Boundary | Responsibility | Regression location |
| --- | --- | --- |
| `src/sites/` | Fixed URL identities and DOM facts; site differences stay here | `tests/sites/`, shared `tests/fixtures/` |
| `src/page-context.ts`, content/side-panel relay | Verified tab/frame/document and current-page lifetime | `tests/panel/` |
| `src/panel/` | Shared controls, immutable captured intent and owned async responses | `tests/panel/` |
| `src/ui/` | Shared tokens, fonts, controls, icons and presentation helpers | `tests/ui/`, offline browser previews |
| `src/worker/` | Sender authorization, pending wallet locks, shared read/price lifetimes | `tests/worker/` |
| Root execution/builders/simulation modules | On-chain identity, actual instructions, limits and unsigned validation | `tests/core/` |
| `src/portfolio/` | Position/portfolio calculations and projections; no DOM-reader runtime imports | `tests/portfolio/` |
| `src/receipts/`, root `src/ledger.ts` | Receipt presentation, fee summaries and existing financial persistence | `tests/receipts/` |
| `src/chart/` | Verified entry projection, bounded trusted relay and owned drawing lifetime | `tests/chart/` |
| `src/diagnostics/` | Sanitization, operational event storage and diagnostic display | `tests/diagnostics/` |
| `src/pro/` | Native-view-only Pro contracts, client/worker and views | `tests/pro/` |
| `server/` API/engine/private signer | Durable intent, observation, independent keys/authorization and private reservations | `tests/pro/` server/engine/signer cases |

Root `src/` retains cross-feature types, amounts, settings, protocol builders and
wallet/recovery interfaces. Existing `sites/`, `worker/`, `pro/`, `vendor/` and
`server/` boundaries stay distinct; server reuse of pure shared code does not
introduce browser or site-DOM authority. Tests are grouped by feature/mode and
keep their filenames. `tests/architecture.test.ts` checks dependency boundaries;
`tests/fixtures/` remains the shared fixture location.

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

Use [CONTRIBUTING](#contributing) for change gates and
[Pro operations](#pro-operations) for deployment and recovery constraints. Internal agent
instructions and local planning records are not public build dependencies.

## Pro setup

[← README](../README.md) · [Operations and recovery](#pro-operations)

Pro uses **your own server and a separate trading wallet**. You review and register orders in the panel; the server signs and executes them when their conditions are met. Basic's Phantom wallet and manual approvals remain available. A managed subscription service is not available yet.

The Pro setup section targets a personal Linux server. Complete the [extension installation](../README.md#quick-start) first. You can browse Pro without a server; preview mode does not execute orders or read remote balances.

### Pro mode screenshots

All images in this guide show **Pro mode with synthetic sample data**, not actual trading results. Basic screenshots are in the [README](../README.md).

<table>
  <tr><th>Pro · Limit buy</th><th>Pro · Orders</th></tr>
  <tr>
    <td><img src="media/pro-trade.png" width="340" alt="Pro mode: 0.25 SOL limit buy at MC 336K, twenty percent below current MC"></td>
    <td><img src="media/pro-orders.png" width="340" alt="Pro mode: open split-exit and trailing orders with edit, pause, and cancel controls"></td>
  </tr>
</table>

### Prerequisites

- A Linux server with Node.js 24 LTS and npm.
- An HTTPS origin with a valid TLS certificate, such as `https://pro.example.com`.
- A Solana HTTPS RPC. Routed venues also require your own Jupiter API key.
- Separate OS accounts for the signer and API. The examples use `dp-signer`, `dp-api`, and a shared `dp-socket` group.
- A separate encrypted-backup location and buy/network budgets you choose yourself.

**Setup creates a new server wallet. It does not ask for or import your Phantom private key.**

### 1. Build the server

```sh
git clone https://github.com/superb43/direct_pump.git
cd direct_pump
npm ci
npm run verify
```

The executable is `server-dist/cli.mjs`. The commands below assume you have placed the build at `/opt/direct-pump`; substitute your installation path. Run `node server-dist/cli.mjs help` to inspect the current CLI.

### 2. Separate accounts and directories

Run these example commands as an administrator. Skip account/group creation if they already exist.

```sh
sudo groupadd --system dp-socket
sudo useradd --system --no-create-home --gid dp-socket --shell /usr/sbin/nologin dp-signer
sudo useradd --system --no-create-home --gid dp-socket --shell /usr/sbin/nologin dp-api
sudo install -d -m 0700 -o dp-signer -g dp-socket /srv/direct-pump-signer
sudo install -d -m 0700 -o dp-api -g dp-socket /srv/direct-pump-api
sudo install -d -m 0750 -o dp-signer -g dp-socket /run/direct-pump
sudo install -d -m 0700 -o dp-signer -g dp-socket /secure-backups/direct-pump
```

| Resource | Ownership and access |
| --- | --- |
| `/srv/direct-pump-signer` | Signer only; directories 0700, files 0600 |
| `/srv/direct-pump-api` | API-owned state and logs; directory 0700 |
| `/run/direct-pump` | Signer-owned, shared-group access, 0750; API cannot write the directory |
| `signer.sock` | Shared connection socket, 0660 |
| `admin.sock` | Inside the private signer directory, 0600 |
| Encrypted backup | Separate from the working keystore; keep the passphrase separately too |

`/run` may be cleared on reboot. Configure your service manager to recreate `/run/direct-pump` with the same ownership and permissions at startup. Both accounts must be able to read the executable and build directory. The API account must not be able to modify signer code or the keystore.

### 3. Create the server wallet and set budgets

Enter budgets as **integer lamports**. `1 SOL = 1,000,000,000 lamports`.

| Option | Meaning |
| --- | --- |
| `--max-buy-lamports` | Maximum buy input per order |
| `--daily-buy-lamports` | Maximum daily buy input; must be at least the per-order cap |
| `--max-network-lamports` | Network-fee and account-setup ceiling; minimum 5,000 lamports |

Replace the `YOUR_…` placeholders with your RPC and budgets. Choose limits for your own operating requirements.

```sh
sudo -u dp-signer node /opt/direct-pump/server-dist/cli.mjs setup \
  --state-dir /srv/direct-pump-signer \
  --backup-file /secure-backups/direct-pump/wallet-key.enc \
  --rpc-url YOUR_HTTPS_SOLANA_RPC \
  --max-buy-lamports YOUR_PER_ORDER_CAP \
  --daily-buy-lamports YOUR_DAILY_CAP \
  --max-network-lamports YOUR_FEE_AND_SETUP_CAP \
  --socket-path /run/direct-pump/signer.sock \
  --admin-socket-path /srv/direct-pump-signer/admin.sock
```

Enter the passphrase twice in an interactive terminal. Input is not echoed. The CLI verifies the encrypted backup and prints the public server ID and wallet address. The signer remains locked. Do not run `setup` again against an already configured directory.

Keep another copy of the encrypted backup in a secure, separate location. The API needs only a configuration copy:

```sh
sudo install -m 0600 -o dp-api -g dp-socket \
  /srv/direct-pump-signer/config.json \
  /srv/direct-pump-api/config.json
```

**Do not copy `key.enc`, the passphrase, or signer authentication/signing databases into the API directory.** The configuration copies must agree on server ID, wallet, and socket paths.

### 4. Start the signer and API

Use separate terminals. For ongoing operation, configure your OS service manager to keep both processes running. These commands do not install background services.

```sh
# Terminal A: signer account
sudo -u dp-signer node /opt/direct-pump/server-dist/cli.mjs signer \
  --state-dir /srv/direct-pump-signer
```

```sh
# Terminal B: API account
sudo -u dp-api node /opt/direct-pump/server-dist/cli.mjs serve \
  --state-dir /srv/direct-pump-api
```

The API binds only to **`127.0.0.1:8788`** by default. Use your configured port if you changed it with `setup --port`. The signer starts locked, so starting these processes alone does not start automatic trading.

#### HTTPS connection

Configure your reverse proxy to connect the HTTPS origin to the API:

- `https://pro.example.com`, with a valid certificate, forwards to `http://127.0.0.1:8788`.
- Preserve `/v1/…` and `/v2/…` paths, authentication headers, and request bodies.
- Forward the `/v1/events` SSE stream without response buffering and with suitable stream timeouts.
- Apply request-size and time limits. Expose only the HTTPS proxy; never expose Unix sockets publicly.

Proxy installation and certificate issuance depend on your server environment. Enter the **HTTPS origin** in the browser, rather than the API's loopback HTTP URL.

### 5. Pair the browser

Generate a code from a new signer-account terminal. Pairing is available while the signer is locked.

```sh
sudo -u dp-signer node /opt/direct-pump/server-dist/cli.mjs pair-code \
  --state-dir /srv/direct-pump-signer
```

1. Open **Pro · Personal server** in Direct Pump Settings. It is also accessible through Pro's **Settings** destination.
2. Enter your address under **HTTPS server origin**.
3. Paste the returned code into **One-time pairing code**.
4. Click **Pair server** and allow the extension to access that server.

Codes expire after **five minutes** and can be used **once**. Issue a separate code for each browser. Pairing authenticates the connection; it does not unlock the signer or start the engine.

<img src="media/pro-settings.png" width="390" alt="Pro mode Settings: execution preferences and personal HTTPS server connection">

> This sample screen is already paired. `https://pro.example.com`, the wallet, and all displayed values are examples.

### 6. Unlock and enable Pro

Run this on the private signer console. Enter the passphrase in the terminal, never in the browser.

```sh
sudo -u dp-signer node /opt/direct-pump/server-dist/cli.mjs unlock \
  --state-dir /srv/direct-pump-signer
```

Explicitly select **Enable Pro** or the paired **Pro ON** control in the panel. Confirm the signer is `READY` and engine is `RUNNING`. Unlocking alone does not resume the engine.

After a restart or signer lock, unlock again and explicitly resume the engine. Previously paused individual orders require a separate resume in **Orders**.

### 7. Deposit and register your first order

Open **Wallet → Deposit** to inspect the server wallet's full address and QR. It is separate from your Phantom balance. Compare the address with your trusted confirmation screen, fund it separately, and wait for the panel to show the confirmed balance. Allow for network fees and account setup costs.

<img src="media/pro-wallet.png" width="390" alt="Pro mode Wallet: sample server-wallet deposit address and QR">

In **Trade**, choose Buy/Sell and an order type, then enter the quantity and MC conditions. Inputs such as `250K` and `1.2M` are supported. Select **Review** and inspect the token, wallet, quantity, conditions, slippage, network budget, and expiry. Use **Confirm & register** to register the reviewed order.

Page MC is provisional. The server verifies MC using the executable quote price and on-chain supply. Relative percentages become an absolute MC target when entered; subsequent market movement does not rewrite that target.

#### Split exits and entry protection

An exit strategy attached to a buy activates using the **actual confirmed fill quantity**. Its protection lifetime starts at confirmed entry, rather than when the buy order was registered. Entry and protection can reserve separate network budgets; check the total upfront reserve in the review.

The sample split strategy takes profit on 25% at MC 525K and another 25% at 630K, then stops out the remaining quantity at 336K. These are illustrative conditions, not trading recommendations. Strategy percentages refer to the original strategy quantity; **All remaining** refers to that strategy's residual quantity.

<img src="media/pro-strategy.png" width="390" alt="Pro mode split-exit editor: two take-profit steps and a stop loss for the remaining quantity">

The **Orders** screen shown at the top of this guide exposes edit, pause, and cancel actions. Review changes before confirming them. Uncertain execution continues to retain its reservation.

### 8. Save a recipient and withdraw

1. Open **Settings → Pro · Personal server → Withdrawal Whitelist** and enter a name and full receiving address.
2. Click **Review recipient** and compare the full address with the receiving screen of your trusted wallet.
3. Check the confirmation box and select **Save reviewed recipient**. To change an address, add a new recipient instead of overwriting the old one.
4. In **Wallet → Withdraw**, select the saved recipient, SOL or a supported token, and an amount.
5. Review the full destination, asset, amount, and costs before approving.

Only unreserved funds are available for withdrawal. **Max** accounts for existing reservations and the reviewed fee/account rent. A withdrawal does not automatically cancel orders or globally pause the engine.

### Optional routing and alerts

| Server environment variable | Purpose | Process |
| --- | --- | --- |
| `DP_JUPITER_API_KEY` | Jupiter key for routed venues | Signer and API |
| `DP_TELEGRAM_TOKEN` | Telegram bot token | API |
| `DP_TELEGRAM_CHAT_ID` | Destination chat ID | API |
| `DP_TELEGRAM_THREAD_ID` | Optional topic ID | API |

Use your service manager's private environment configuration. Keep secrets out of documentation, screenshots, Git, and CLI arguments. Basic's Jupiter setting is separate from the server environment. Supported direct SOL routes do not require a Jupiter key.

Enable Chrome notifications in Settings and grant notification access. Telegram delivery runs on the server and can continue after browser closure. Alerts may be delayed or duplicated during retries; an alert is not final execution evidence.

### Stop, restart, and troubleshoot

Closing the browser does not stop Pro orders. **Pro OFF** takes effect after the server acknowledges pausing unsubmitted orders. If that response is uncertain, the panel does not report a completed stop. Already signed or uncertain attempts remain tracked.

Lock the signer from its private console:

```sh
sudo -u dp-signer node /opt/direct-pump/server-dist/cli.mjs lock \
  --state-dir /srv/direct-pump-signer
```

For pairing failures, unavailable servers, process locks and uncertain results,
use [Troubleshooting](#troubleshooting) and [Orders and recovery](#orders-and-recovery).
Never delete or edit financial journals to release reservations or submit a
replacement transaction to compensate for an uncertain result.

## Pro operations

### Trading controls and accounting

Market orders submit directly by default; Limit orders require confirmation by
default. Settings → Trading preferences controls those options independently and
saves up to eight execution profiles. Attached exit strategies, standalone exit
strategies, edits and recovery retries retain explicit review. A review checkbox
changes future confirmation policy only; the current order still needs Confirm.

Hotkeys are disabled until enabled in the mounted Trade panel and are not restored
after closing it or changing the server wallet. Native panel shortcuts use Space
with configured keys. Browser commands use the registered extension shortcuts
(four suggested defaults: Alt+Shift+1–4); configure others at
`chrome://extensions/shortcuts`. Browser commands require an open, armed Trade
panel and the matching focused token page. Input editing, ambiguous windows,
expired gestures and changed documents do not submit an order.

Portfolio reads require `portfolio-v1`; Sell Initials requires
`recover-initials-preview-v1`. Old servers retain existing orders and hide the new
controls. The portfolio covers known Pro journal assets and the current token,
not an indexed scan of every externally deposited asset. History is reconstructed
in bounded reads. Missing history, external token movement and unresolved fills
remain unavailable. Actual SOL fees and rent enter accounting; current USD values
are current conversions rather than historical dollar returns.

Sell Initials uses outstanding fee-inclusive SOL outlay and unreserved tokens.
Its liquidation estimate conservatively subtracts the full selected network
budget. Insufficient inventory blocks recovery instead of silently selling all;
price changes can leave a remainder and no follow-up sell is automatic. Existing
order specs, signer authorization, journals, reservations and receipt schemas are
compatible; updating these controls never releases financial uncertainty.

[← README](../README.md) · [Server setup](#pro-setup)

Pro uses a separate server wallet. Basic retains manual Phantom approval. Pro is
disabled by default, but registered orders can continue while the browser is closed.
For installation, OS permissions, HTTPS, pairing and initial unlock, follow the
[setup guide](#pro-setup).

### Orders and recovery

The daily buy cap uses the preceding 24 hours, including older unsettled attempts.
Recent failed attempts still count conservatively. The engine and private signer
enforce the same policy over their separate journals. Resuming the engine does not
resume an individually paused order, including unsigned version-one recovery.

Missing signed transactions stay locked until finalized expiry and covered wallet
history prove non-execution through repeated signature/transaction reads. RPC gaps
or insufficient history keep the result unresolved. This recovery path never
resubmits or re-signs the expired transaction.

Review the token, wallet, quantity, conditions, slippage, network budget and expiry
before registering or changing an order. Changing the paired server, device or
wallet invalidates an unsent review.

- Buys use a fixed SOL amount. Percentage sells freeze a token quantity from the
  fresh confirmed available balance. Input, network fees and account setup costs
  consume reservations.
- MC conditions use verified quote price multiplied by on-chain mint supply.
  Page prices are provisional. Relative percentages become fixed absolute targets
  when entered; later prices do not retarget the order. Slippage is separate from
  the trigger, and neither a trigger nor a stop guarantees a fill or price.
- Market and Limit support buys and sells. Take profit, stop loss, TP/SL brackets
  and trailing exits apply to sells. Trailing observations are sampled; a gap
  preserves the watermark and pauses tracking until an explicit resume.
- Split strategies contain up to ten exit steps sharing one original quantity.
  Percentages refer to that quantity; **All remaining** means the strategy's own
  residual. Additional buys are not automatically included. External balance
  reductions block execution rather than silently shrinking orders.
- Buy-attached exits activate from the actual confirmed fill. Their protection
  lifetime starts at that confirmation, with a 24-hour default. Review the separate
  entry and protection network caps and total upfront SOL reserve. Later exit
  steps retain the remaining cumulative network budget after earlier costs.
- Older servers may lack current features. Update the extension and server
  together. Existing legacy USD orders retain their original meaning; cancel and
  review a new MC order to replace them rather than converting them in place.

**An UNKNOWN result keeps funds reserved.** A lost response is not evidence that
an order failed. Inspect the saved intent and server state in Trade/Orders before
retrying or cancelling. A locally saved intent clears only after acknowledged
cancellation; signed or uncertain attempts remain tracked.

Recovery reconciles chain evidence and, when appropriate, rebroadcasts the exact
recorded transaction bytes. It does not authorize a newly signed replacement.
Never place a compensating order, delete journals, edit SQL or clear state to free
an uncertain reservation. Confirmation continues to finalization; inconsistent
or insufficient chain evidence remains unresolved.

### Pausing and restarting

**Pro OFF** pauses unsubmitted orders only after server acknowledgement. A lost
acknowledgement leaves the stop unconfirmed. Already signed or uncertain attempts
continue to be reconciled. Closing the browser does not stop the server.

The signer starts locked. After a restart or lock, unlock it on the private console
and explicitly enable Pro or resume the engine. Unlocking alone does not resume
execution. Individually paused orders need their own resume in Orders. See
[unlock and enable](#6-unlock-and-enable-pro) and
[stop and restart](#stop-restart-and-troubleshoot) for commands.

If a signer process lock remains after an unclean stop, inspect its PID and verify
that no signer is running before manually removing the lock. Never remove a live
signer's lock or start a second signer against the same state.

### Withdrawals and saved recipients

Register recipients from a trusted wallet's receive screen and compare the full
address before saving. Clipboard replacement can occur before registration; a
valid address does not establish that it belongs to the intended recipient.
Addresses are immutable: add a new recipient and deactivate the previous one to
change a destination. These controls do not protect a compromised device or host.

Select a saved recipient, SOL or a supported token, and an amount. Review the full
destination, asset, amount and costs before approving. Approval binds the reviewed
recipient version, amount, fee budget and request ID. Changes to the destination,
costs or available balance require another review. Unsafe token extensions are
rejected; an older server without withdrawal support hides the controls.

Only unreserved funds are available. **Max** subtracts existing reservations and
the reviewed fee and destination account rent. The network budget is a cost ceiling,
not an extra amount withheld. Orders and withdrawals share the private signer's
reservation ledger and execution queue. A withdrawal does not automatically
cancel orders, pause the engine or lock an unlocked signer.

Repeated approval of the same request is idempotent. An uncertain withdrawal stays
UNKNOWN and retains its reservation while the same recorded transaction is
reconciled. Do not submit another withdrawal to compensate for it. Financial
journals remain separate from diagnostic retention; public responses and exports
exclude transaction bytes and private keys.

### Alerts and diagnostics

Chrome alerts are optional. Server-side Telegram delivery can continue after
browser closure. Alerts may be delayed or duplicated after delivery timeouts and
are not final execution evidence. Configure routing and Telegram credentials only
through the [server environment](#optional-routing-and-alerts).
Basic's Jupiter setting is separate from the server setting.

Settings and the receipt dashboard export sanitized browser diagnostics; Pro also
provides server events/logs. Correlate request nonce, order ID, attempt ID and
signature. Keys, passphrases, credentials and signed transaction bytes are excluded.
Browser diagnostics retain up to 7 days / 5 MiB; server diagnostics retain up to
30 days / 250 MiB. Debug capture expires within 60 minutes. These limits never
remove unresolved financial evidence or authorization journals. Optional logging
failure does not change a trade result; failed durable authorization prevents signing.

### State, backups and access

Keep the signer keystore, admin socket and signing/authentication journals private.
The API needs only its configuration copy and access to the shared signer socket;
it must not receive the keystore or passphrase. Expose the loopback API only through
HTTPS with a valid certificate and request/time limits. Never expose Unix sockets
publicly or put server-wallet keys in browser storage.

Keep runtime state and backups outside the source checkout or in its ignored
`.private/` directory. Runtime `config.json` can contain RPC credentials; treat it
as private even though the API needs a copy.

Keep encrypted backups and passphrases separately. Restoring a keystore preserves
wallet identity; preserve financial state and journals for recovery as well. Do not
rerun setup in an existing state directory or recreate state to release reservations.

### Dependency limits

The installed Solana SDK dependency tree still reports upstream security
advisories. The supported extension and Pro builds use `bigint-buffer`'s existing
pure-JS implementation; the Pro build checks that native bigint code is excluded.
Use the bundled `server-dist/cli.mjs`; custom bundles or direct TypeScript execution
are outside that build check. See the [native bigint advisory](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).

Anchor's affected TOML parser is present in the server dependency tree but is not
called by this application. The affected `stream-json` path is not included in the
current server bundle, and the RPC client does not call the affected UUID
v3/v5/v6 buffer APIs. These are observations about the current build, not a claim
that every SDK feature or deployment is safe. Dependency changes require a new
review. See the [TOML advisories](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j)
and [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

### Troubleshooting

| Situation | Check |
| --- | --- |
| Pairing fails | HTTPS certificate/origin, extension permission, a fresh single-use code within five minutes, signer/admin socket |
| Signer locked | Private-console unlock, followed by explicit engine resume |
| Engine paused | Enable Pro or Resume engine; individually PAUSED orders require separate resume |
| Server unavailable | Signer/API processes, socket ownership and permissions, HTTPS proxy and event stream |
| Feature unavailable | Matching extension/server versions and actual signer support |
| Insufficient funds | Available balance and reservations for orders, protection and withdrawals |
| UNKNOWN or uncertain result | Saved intent and chain evidence; retain state and avoid a replacement transaction |

Offline tests use mocks and test keys. They do not establish live provider, TLS,
OS permission or funded execution behavior.

## Repository publication

The preparation files are local proposals. They do not change GitHub visibility,
permissions, releases, billing or credentials. As inspected during preparation,
`superb43/direct_pump` was PRIVATE with ADMIN access; the ruleset/protection API
returned HTTP 403 requiring GitHub Pro or public visibility. Private vulnerability
reporting was unavailable through its API. Those responses do not prove that all
remote security settings are disabled.

### Local readiness

- [ ] Review commercial GPL-3.0-only licensing and the third-party/source notices.
- [ ] Review private-data scans and publication paths. Revoke any discovered real
  credential; history rewrite or deletion needs a separate decision.
- [ ] Review source files, images and existing private issues, PRs, discussions,
  wiki, workflow logs/artifacts and other metadata before changing visibility.
  A Git source scan does not inspect those external surfaces.
- [ ] Commit only reviewed, named files and preserve intentional internal-doc
  removals. Verify a fresh clone with Node.js 24, npm ci and the documented checks.
- [ ] Review security/community contact routes and supported-version policy.
- [ ] Review the locally prepared preview artifacts; they are not official releases.

### GitHub activation — explicit approval required

1. Obtain approval for the particular source commit/push and for making this
   repository public. Public copies/forks can persist after a later visibility
   change. Do not treat local preparation as authorization to publish.
2. Apply the reviewed settings proposal in `.github/publication-settings.json`
   only once the repository is eligible. It contains no visibility-change field
   and requests no paid private-security entitlement.
3. GitHub enables **Private vulnerability reporting** for public repositories.
   Enable it immediately after the visibility change and before inviting
   participation. Confirm the security advisory reporting form is
   available; the presence of a security policy alone does not activate it.
4. Let the new CI workflows run. Confirm the actual GitHub Actions check names and
   GitHub Actions app ID before applying `.github/publication-ruleset.json`.
   The proposed required contexts are `verify` and `Secret scan`; CodeQL runs only
   on a public repository and should be confirmed separately.
5. The maintainer operates this repository alone. The proposed ruleset requires
   a PR, successful strict CI checks and resolved conversations, with no bypass
   actors. It blocks force pushes and branch deletion. Mandatory reviewer count
   is zero; code-owner and last-push approvals are disabled because an author
   cannot approve their own PR. CODEOWNERS still routes sensitive changes to the
   maintainer. This configuration does not provide an independent human approval
   gate. Keep evidence of independent review for security-sensitive changes;
   do not describe self-review as independent. When a trusted second reviewer is
   approved and has write access, add them to all protected CODEOWNERS entries and
   explicitly enable the one-approval, owner-review and last-push requirements.
6. Confirm ruleset enforcement, blocked force/deletion pushes, Dependabot, private
   reporting, secret scanning/push protection and public CodeQL results. Prefer
   hosted ephemeral CI; never add the personal signer host as a public PR runner.

Prepared API payloads can be applied by an authorized maintainer with `gh api`
after the above review. They are intentionally not executed by any repo script
or CI workflow. No release, store upload, deployment or live alert is part of
repository activation; those each need their own authorized delivery step.

Use [release policy](#releases-and-maintenance) for versioned binaries and matching source.

GitHub documents the public-repository requirement for this reporting channel in
[private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting).

## Releases and maintenance

The latest tagged release is the supported security target. `main` is development
code, and preview packages are review artifacts. No trading return, custody,
execution price, SLA or independent security audit is implied.

The maintenance and delivery procedure below incorporates official guidance
checked on **2026-10-13**. GitHub settings described as proposals are not enabled
by these files; verify the actual repository configuration before relying on them.

### Before opening the repository

1. Review this guide's license/copyright sections, the dependency inventory and
   third-party notices. Binary archives retain standalone LICENSE/COPYRIGHT texts.
   Keep GPL/LGPL source obligations and all upstream notices with distributed
   artifacts. Some publishers ship only SPDX declarations/README notices; those
   entries are explicitly identified in `Docs/licenses/upstream-evidence.json` and
   require maintainer review, not an invented copyright grant.
2. The unused locked `chain` dependency has no reviewed license grant. It is not
   included in the application graph and must not be redistributed wholesale.
   Any future import must resolve its license before a release can pass.
3. Review vendored IDL and asset provenance in the vendored schema provenance below, font/icon
   license files and the third-party notices. Names/logos do not imply endorsement.
4. Scan all reachable Git history and the candidate source tree with redacted
   secret output. Check runtime/key/database/browser files and attachments. A
   scanner cannot prove the absence of every credential or proprietary key format.
   Revoke exposed credentials before considering an approved history rewrite.
5. Commit the reviewed source and preparation files with named staging. Preserve
   intentional removals of internal docs; do not add ignored local state.
6. Apply the proposed GitHub settings in [publication checklist](#repository-publication)
   only after approval. Enable private vulnerability reporting immediately after
   public visibility becomes available and before inviting participation.
   Confirm all required checks are available on the actual repository plan.

### Build review artifacts locally

Use Node.js 24 LTS, `npm ci`, then:

```sh
npm run check:publication
npm run prepare:release -- --preview
```

The preview command checks publication inputs/notices, runs `npm run verify` and
builds extension/server archives, accompanying source and SHA-256 checksums in
ignored `output/releases/`. Preview names and metadata identify the uncommitted
working tree; never label them as an official release.

The source package includes project source, lockfile, build instructions, and
dependency source/notices for the conservative distribution closure. This
includes WXT's injected runtime even when its npm package is marked development,
and the production closure to retain modules prebundled inside upstream SDKs.
Versioned upstream source-map modules must match reviewed lock/source coverage.
Verify that
the preferred source for every GPL/LGPL component is complete, including any
needed build scripts. Keep equivalent source access beside binary downloads for
as long as required; a source link to an unrelated branch is insufficient.

GPL/LGPL upstream repositories are included as full pinned source archives,
verified against `Docs/licenses/preferred-sources.json`. Raydium's 0.2.73-alpha source
was matched against all 129 distributed TypeScript source files; rpc-websockets
uses its published version/gitHead. A dependency update must review and update
this evidence rather than silently package a different upstream revision.

### Official release

- Review a clean committed tree, version change, changelog and relevant recovery
  regressions. Check actual supported-site/browser behavior separately; live
  network tests stay opt-in and no funded signing/trading is a release test.
- Create a version tag matching `package.json` through the authorized maintainer
  workflow. Run the manual **Release build** workflow for that existing tag, or
  `npm run prepare:release` from the clean exact-tag checkout.
- The workflow only uploads build artifacts for review. It does not publish a
  GitHub Release, change visibility, deploy Pro or upload to a browser store.
- Inspect archives and checksums, licenses/source pairing, build metadata and
  limitations. Run a clean-source rebuild before publication. Publish only with
  explicit approval, retaining the matching source archive and notices.
- Release notes identify the commit, version, changes, supported environments,
  known provider limits, security fixes and skipped checks. Do not include real
  wallet balances, keys, pairing data or private diagnostics.

Maintainers may decline features outside the three supported sites or protected
financial architecture. Dependabot/security updates are reviewed rather than
automatically merged; SDK and financial changes need regression evidence.

Release version changes update both package.json and package-lock.json version
fields. Extension/server operational diagnostics use the shared build-time
application version; publication gates reject version drift before packaging.

### Routine maintenance and dependency decisions

Routine version-update PRs are disabled; security alerts and security-update PRs remain enabled. Review ordinary version migrations separately.

Triage ordinary issues and PRs weekly; handle vulnerability reports privately
under the security section. Keep one concrete change per PR, with compatibility notes,
regression evidence and actual skipped checks. Follow the contribution section and the
existing site, wallet, target-binding and recovery boundaries.

Review dependency updates in bounded batches, keeping the manifest and lockfile
together. Inspect changed install/build scripts and licensing before installation.
At release time and after dependency changes, collect both reports:

```sh
npm audit --json
npm audit --omit=dev --json
```

An audit exit code can reflect inherited findings; it is not permission to ignore
them or proof of app exploitability. New Critical findings, reachable High findings
and unresolved signing/key-authority exposure block release. Accepted exceptions
record advisory, affected build/runtime path, mitigation, reviewer, review date
and re-review trigger in the release review. Keep residual findings visible in
release notes; do not use forced fixes or broad allowlists to hide them.
[npm audit guidance](https://docs.npmjs.com/cli/v11/commands/npm-audit/).

### Version and release sequence

1. Prepare a scoped candidate PR: code, tests, numeric version, lockfile root entry,
   user-visible release notes and required notice/source updates. Before 1.0, this
   project's convention is PATCH for compatible fixes and MINOR for features or
   compatibility changes. Explicitly disclose breaking changes; 0.x is not a
   stability promise. After 1.0, apply normal SemVer.
2. Merge only after the configured checks and resolved conversations. Solo
   operation requires PR/CI gates with zero mandatory approving reviewers.
   Security-sensitive changes still require recorded independent review; the
   platform settings alone do not prove that review occurred. Check actual CI
   context names; do not label self-review as independent or bypass the ruleset.
3. Resolve the reviewed public commit SHA, create its annotated `vX.Y.Z` tag within
   release authorization, and build from a clean exact-tag checkout. `npm ci`
   installs the locked tree; a dirty preview is never an official candidate.
4. Run the existing build/publication gates and affected browser checks. Verify
   package, lockfile, manifest and application version displays agree. API v1/v2
   paths and persisted schema versions are separate contracts. Chrome's manifest
   stays numeric; mark candidates through GitHub's prerelease flag.
5. Inspect the final extension/server/source archives, paired licenses and source,
   `*-SHA256SUMS` and `*-PREPARATION.json`. Confirm version, commit, clean-tree state,
   toolchain and archive contents. Do not zip the whole working directory or
   redistribute node_modules wholesale. Rebuild the accompanying source in isolation.
6. Create a GitHub draft release for the existing verified tag and attach all assets
   before publication. Review changes, fixes, client/server and data compatibility,
   update steps, verification, skipped checks and dependency exceptions. Publish
   only within existing task-specific authorization; do not ask again when that
   authorization already covers the step. Passing CI alone does not grant it.
7. Keep published tags and assets unchanged; enable GitHub immutable releases when
   approved and available. Corrections use a new version. Keep matching source
   accessible while distributing binaries. Initial history/visibility migration,
   browser-store submission, npm publication and funded Pro deployment remain
   separate delivery decisions. Keep package.json private; no store channel is
   implied by WXT's packaging capability.

[SemVer](https://semver.org/spec/v2.0.0.html),
[Chrome version fields](https://developer.chrome.com/docs/extensions/reference/manifest/version),
[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
[GitHub draft and immutable releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
For covered binaries, check the required Corresponding Source rather than assuming
any source ZIP is sufficient; see [GNU distribution guidance](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites).

### CI trust and artifact provenance

Ordinary PR verification uses read-only credentials and GitHub-hosted runners.
Never execute fork code with privileged tokens, publish/deploy secrets or access
to a signer host. Review workflow changes as code. Keep Actions pinned to verified
upstream full SHAs with readable version comments until supported dependency
lockfiles are explicitly adopted. Expand permissions only in trusted jobs that
need them; the current Release build workflow is artifact-only.
[GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

If a future workflow generates artifact attestations, verify them against this
repository/workflow before publishing. Checksums detect changed bytes but do not
establish provenance or software safety. Attestation and immutable-release settings
must be verified, never inferred from documentation. No attestation workflow is
claimed to exist today.
[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

### Pro upgrades, incidents and rollback

Server maintenance requires deployment authorization. Obtain acknowledged pause
of new orders, lock the signer on its private console, and stop the API/signer
gracefully before replacing code or taking a consistent full-state backup. Keep
encrypted wallet backups/passphrases separate. Preserve signing/authentication
journals and SQLite recovery files; confirm no live signer before touching a
process lock. Signed/UNKNOWN attempts retain reservations and recorded bytes.

Install the reviewed artifact only after checking its digest and compatibility.
Retain OS-user/socket separation, HTTPS and wallet identity. Start locked,
reconcile existing attempts, and explicitly unlock/resume only when authorized
by the operator. Individually paused orders still require their own resume.

On incidents, privately triage and rotate exposed credentials with the owner.
Never erase journals, restore old financial snapshots over newer attempts or send
compensating trades. Roll back code only after checking schema/API compatibility;
do not silently downgrade data. Fix extensions with a higher numeric version and
reload the existing installation rather than uninstalling its receipts/settings.
Preserve matching source and mark bad releases clearly instead of overwriting them.
Follow [Pro recovery](#orders-and-recovery) and [private security reporting](#security).

## Copyright and license

<!-- COPYRIGHT:START -->
~~~text
Copyright (C) 2026 Direct Pump contributors.

The original Direct Pump application code is licensed under the GNU General
Public License, version 3 only (SPDX-License-Identifier: GPL-3.0-only).
The complete, unmodified license text accompanies this project and its distributions.

Commercial use and redistribution are permitted under that license. Recipients
of covered distributions must retain the applicable notices and receive the
Corresponding Source as required by the GPL.

Each contributor retains copyright in their contributions. This statement does
not claim ownership of third-party software, vendored protocol schemas, fonts,
icons, logos or other third-party assets. Their original terms and provenance
remain applicable; see the accompanying third-party notices and vendored schema provenance.

Direct Pump's name and branding do not imply endorsement of third-party forks.
~~~
<!-- COPYRIGHT:END -->

## Vendored protocol schemas

<!-- VENDOR:START -->
~~~text
# Jupiter instruction schema

`jupiter-idl.ts` pins route/shared-account exact-input v1/v2 and types from the
Anchor IDL stored by the deployed Jupiter program
`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, read through
`Program.fetchIdl` on 2026-10-07. Snake-case instruction/account/field names are
converted to camelCase without changing discriminators, types or enum order.
Unknown layouts fail closed. Source raw JSON SHA-256: `12a0856158b2b6927d683a2ba21566f82e39989aca476e23c02d845fc38cdca8`.

Reference: https://developers.jup.ag/docs/swap/build
Earlier decoder: https://github.com/jup-ag/instruction-parser

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.


# Meteora DLMM pool identity schema

`dlmm-idl.ts` preserves only `LbPair` and its transitive type definitions from
Meteora's official IDL at commit `2f540c2107988e0f97efa5917100bb912c96c17a`.
Documentation fields are omitted; names, discriminator, field order and types
are unchanged. The pinned layout is 904 bytes including the discriminator.
This schema only identifies pool assets; it does not build DLMM swaps.

Source: https://github.com/MeteoraAg/dlmm-sdk/blob/2f540c2107988e0f97efa5917100bb912c96c17a/idls/dlmm.json
Raw source SHA-256: `045c0f4af044be046b6a14b350077e4242e8ac026b64a855803dab30fcdd8b35`.
~~~
<!-- VENDOR:END -->

## Font provenance

### Geist

Official release: https://github.com/vercel/geist-font/releases/download/v1.7.2/geist-font-v1.7.2.zip
Version: 1.7.2
Archive file: geist-font/GeistMono/webfonts/GeistMono[wght].woff2
SHA-256: fba8f577f38a2bbcbe818efa6348dd58f36303a10b8737c42fefad275be563ab
License: SIL Open Font License 1.1; original notice retained in Docs/licenses/assets/GEIST-LICENSE.txt and in the third-party distribution notices.

### Inter

Official release: https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
Version: 4.1
Archive file: web/InterVariable.woff2
SHA-256: 693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3
License: SIL Open Font License 1.1; original notice retained in Docs/licenses/assets/INTER-LICENSE.txt and in the third-party distribution notices.

## App icon source

`assets/icon/source.png` is the original icon. The extension uses the 16, 32, 48 and 128 pixel
PNG files in `public/icon/`, resized from that source with Lanczos resampling.
Keep the source for future icon updates; generation notes are stored privately.

## GPL license text

<!-- LICENSE:START -->
~~~text
                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.

  The licenses for most software and other practical works are designed
to take away your freedom to share and change the works.  By contrast,
the GNU General Public License is intended to guarantee your freedom to
share and change all versions of a program--to make sure it remains free
software for all its users.  We, the Free Software Foundation, use the
GNU General Public License for most of our software; it applies also to
any other work released this way by its authors.  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

  To protect your rights, we need to prevent others from denying you
these rights or asking you to surrender the rights.  Therefore, you have
certain responsibilities if you distribute copies of the software, or if
you modify it: responsibilities to respect the freedom of others.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must pass on to the recipients the same
freedoms that you received.  You must make sure that they, too, receive
or can get the source code.  And you must show them these terms so they
know their rights.

  Developers that use the GNU GPL protect your rights with two steps:
(1) assert copyright on the software, and (2) offer you this License
giving you legal permission to copy, distribute and/or modify it.

  For the developers' and authors' protection, the GPL clearly explains
that there is no warranty for this free software.  For both users' and
authors' sake, the GPL requires that modified versions be marked as
changed, so that their problems will not be attributed erroneously to
authors of previous versions.

  Some devices are designed to deny users access to install or run
modified versions of the software inside them, although the manufacturer
can do so.  This is fundamentally incompatible with the aim of
protecting users' freedom to change the software.  The systematic
pattern of such abuse occurs in the area of products for individuals to
use, which is precisely where it is most unacceptable.  Therefore, we
have designed this version of the GPL to prohibit the practice for those
products.  If such problems arise substantially in other domains, we
stand ready to extend this provision to those domains in future versions
of the GPL, as needed to protect the freedom of users.

  Finally, every program is threatened constantly by software patents.
States should not allow patents to restrict development and use of
software on general-purpose computers, but in those that do, we wish to
avoid the special danger that patents applied to a free program could
make it effectively proprietary.  To prevent this, the GPL assures that
patents cannot be used to render the program non-free.

  The precise terms and conditions for copying, distribution and
modification follow.

                       TERMS AND CONDITIONS

  0. Definitions.

  "This License" refers to version 3 of the GNU General Public License.

  "Copyright" also means copyright-like laws that apply to other kinds of
works, such as semiconductor masks.

  "The Program" refers to any copyrightable work licensed under this
License.  Each licensee is addressed as "you".  "Licensees" and
"recipients" may be individuals or organizations.

  To "modify" a work means to copy from or adapt all or part of the work
in a fashion requiring copyright permission, other than the making of an
exact copy.  The resulting work is called a "modified version" of the
earlier work or a work "based on" the earlier work.

  A "covered work" means either the unmodified Program or a work based
on the Program.

  To "propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy.  Propagation includes copying,
distribution (with or without modification), making available to the
public, and in some countries other activities as well.

  To "convey" a work means any kind of propagation that enables other
parties to make or receive copies.  Mere interaction with a user through
a computer network, with no transfer of a copy, is not conveying.

  An interactive user interface displays "Appropriate Legal Notices"
to the extent that it includes a convenient and prominently visible
feature that (1) displays an appropriate copyright notice, and (2)
tells the user that there is no warranty for the work (except to the
extent that warranties are provided), that licensees may convey the
work under this License, and how to view a copy of this License.  If
the interface presents a list of user commands or options, such as a
menu, a prominent item in the list meets this criterion.

  1. Source Code.

  The "source code" for a work means the preferred form of the work
for making modifications to it.  "Object code" means any non-source
form of a work.

  A "Standard Interface" means an interface that either is an official
standard defined by a recognized standards body, or, in the case of
interfaces specified for a particular programming language, one that
is widely used among developers working in that language.

  The "System Libraries" of an executable work include anything, other
than the work as a whole, that (a) is included in the normal form of
packaging a Major Component, but which is not part of that Major
Component, and (b) serves only to enable use of the work with that
Major Component, or to implement a Standard Interface for which an
implementation is available to the public in source code form.  A
"Major Component", in this context, means a major essential component
(kernel, window system, and so on) of the specific operating system
(if any) on which the executable work runs, or a compiler used to
produce the work, or an object code interpreter used to run it.

  The "Corresponding Source" for a work in object code form means all
the source code needed to generate, install, and (for an executable
work) run the object code and to modify the work, including scripts to
control those activities.  However, it does not include the work's
System Libraries, or general-purpose tools or generally available free
programs which are used unmodified in performing those activities but
which are not part of the work.  For example, Corresponding Source
includes interface definition files associated with source files for
the work, and the source code for shared libraries and dynamically
linked subprograms that the work is specifically designed to require,
such as by intimate data communication or control flow between those
subprograms and other parts of the work.

  The Corresponding Source need not include anything that users
can regenerate automatically from other parts of the Corresponding
Source.

  The Corresponding Source for a work in source code form is that
same work.

  2. Basic Permissions.

  All rights granted under this License are granted for the term of
copyright on the Program, and are irrevocable provided the stated
conditions are met.  This License explicitly affirms your unlimited
permission to run the unmodified Program.  The output from running a
covered work is covered by this License only if the output, given its
content, constitutes a covered work.  This License acknowledges your
rights of fair use or other equivalent, as provided by copyright law.

  You may make, run and propagate covered works that you do not
convey, without conditions so long as your license otherwise remains
in force.  You may convey covered works to others for the sole purpose
of having them make modifications exclusively for you, or provide you
with facilities for running those works, provided that you comply with
the terms of this License in conveying all material for which you do
not control copyright.  Those thus making or running the covered works
for you must do so exclusively on your behalf, under your direction
and control, on terms that prohibit them from making any copies of
your copyrighted material outside their relationship with you.

  Conveying under any other circumstances is permitted solely under
the conditions stated below.  Sublicensing is not allowed; section 10
makes it unnecessary.

  3. Protecting Users' Legal Rights From Anti-Circumvention Law.

  No covered work shall be deemed part of an effective technological
measure under any applicable law fulfilling obligations under article
11 of the WIPO copyright treaty adopted on 20 December 1996, or
similar laws prohibiting or restricting circumvention of such
measures.

  When you convey a covered work, you waive any legal power to forbid
circumvention of technological measures to the extent such circumvention
is effected by exercising rights under this License with respect to
the covered work, and you disclaim any intention to limit operation or
modification of the work as a means of enforcing, against the work's
users, your or third parties' legal rights to forbid circumvention of
technological measures.

  4. Conveying Verbatim Copies.

  You may convey verbatim copies of the Program's source code as you
receive it, in any medium, provided that you conspicuously and
appropriately publish on each copy an appropriate copyright notice;
keep intact all notices stating that this License and any
non-permissive terms added in accord with section 7 apply to the code;
keep intact all notices of the absence of any warranty; and give all
recipients a copy of this License along with the Program.

  You may charge any price or no price for each copy that you convey,
and you may offer support or warranty protection for a fee.

  5. Conveying Modified Source Versions.

  You may convey a work based on the Program, or the modifications to
produce it from the Program, in the form of source code under the
terms of section 4, provided that you also meet all of these conditions:

    a) The work must carry prominent notices stating that you modified
    it, and giving a relevant date.

    b) The work must carry prominent notices stating that it is
    released under this License and any conditions added under section
    7.  This requirement modifies the requirement in section 4 to
    "keep intact all notices".

    c) You must license the entire work, as a whole, under this
    License to anyone who comes into possession of a copy.  This
    License will therefore apply, along with any applicable section 7
    additional terms, to the whole of the work, and all its parts,
    regardless of how they are packaged.  This License gives no
    permission to license the work in any other way, but it does not
    invalidate such permission if you have separately received it.

    d) If the work has interactive user interfaces, each must display
    Appropriate Legal Notices; however, if the Program has interactive
    interfaces that do not display Appropriate Legal Notices, your
    work need not make them do so.

  A compilation of a covered work with other separate and independent
works, which are not by their nature extensions of the covered work,
and which are not combined with it such as to form a larger program,
in or on a volume of a storage or distribution medium, is called an
"aggregate" if the compilation and its resulting copyright are not
used to limit the access or legal rights of the compilation's users
beyond what the individual works permit.  Inclusion of a covered work
in an aggregate does not cause this License to apply to the other
parts of the aggregate.

  6. Conveying Non-Source Forms.

  You may convey a covered work in object code form under the terms
of sections 4 and 5, provided that you also convey the
machine-readable Corresponding Source under the terms of this License,
in one of these ways:

    a) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by the
    Corresponding Source fixed on a durable physical medium
    customarily used for software interchange.

    b) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by a
    written offer, valid for at least three years and valid for as
    long as you offer spare parts or customer support for that product
    model, to give anyone who possesses the object code either (1) a
    copy of the Corresponding Source for all the software in the
    product that is covered by this License, on a durable physical
    medium customarily used for software interchange, for a price no
    more than your reasonable cost of physically performing this
    conveying of source, or (2) access to copy the
    Corresponding Source from a network server at no charge.

    c) Convey individual copies of the object code with a copy of the
    written offer to provide the Corresponding Source.  This
    alternative is allowed only occasionally and noncommercially, and
    only if you received the object code with such an offer, in accord
    with subsection 6b.

    d) Convey the object code by offering access from a designated
    place (gratis or for a charge), and offer equivalent access to the
    Corresponding Source in the same way through the same place at no
    further charge.  You need not require recipients to copy the
    Corresponding Source along with the object code.  If the place to
    copy the object code is a network server, the Corresponding Source
    may be on a different server (operated by you or a third party)
    that supports equivalent copying facilities, provided you maintain
    clear directions next to the object code saying where to find the
    Corresponding Source.  Regardless of what server hosts the
    Corresponding Source, you remain obligated to ensure that it is
    available for as long as needed to satisfy these requirements.

    e) Convey the object code using peer-to-peer transmission, provided
    you inform other peers where the object code and Corresponding
    Source of the work are being offered to the general public at no
    charge under subsection 6d.

  A separable portion of the object code, whose source code is excluded
from the Corresponding Source as a System Library, need not be
included in conveying the object code work.

  A "User Product" is either (1) a "consumer product", which means any
tangible personal property which is normally used for personal, family,
or household purposes, or (2) anything designed or sold for incorporation
into a dwelling.  In determining whether a product is a consumer product,
doubtful cases shall be resolved in favor of coverage.  For a particular
product received by a particular user, "normally used" refers to a
typical or common use of that class of product, regardless of the status
of the particular user or of the way in which the particular user
actually uses, or expects or is expected to use, the product.  A product
is a consumer product regardless of whether the product has substantial
commercial, industrial or non-consumer uses, unless such uses represent
the only significant mode of use of the product.

  "Installation Information" for a User Product means any methods,
procedures, authorization keys, or other information required to install
and execute modified versions of a covered work in that User Product from
a modified version of its Corresponding Source.  The information must
suffice to ensure that the continued functioning of the modified object
code is in no case prevented or interfered with solely because
modification has been made.

  If you convey an object code work under this section in, or with, or
specifically for use in, a User Product, and the conveying occurs as
part of a transaction in which the right of possession and use of the
User Product is transferred to the recipient in perpetuity or for a
fixed term (regardless of how the transaction is characterized), the
Corresponding Source conveyed under this section must be accompanied
by the Installation Information.  But this requirement does not apply
if neither you nor any third party retains the ability to install
modified object code on the User Product (for example, the work has
been installed in ROM).

  The requirement to provide Installation Information does not include a
requirement to continue to provide support service, warranty, or updates
for a work that has been modified or installed by the recipient, or for
the User Product in which it has been modified or installed.  Access to a
network may be denied when the modification itself materially and
adversely affects the operation of the network or violates the rules and
protocols for communication across the network.

  Corresponding Source conveyed, and Installation Information provided,
in accord with this section must be in a format that is publicly
documented (and with an implementation available to the public in
source code form), and must require no special password or key for
unpacking, reading or copying.

  7. Additional Terms.

  "Additional permissions" are terms that supplement the terms of this
License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall
be treated as though they were included in this License, to the extent
that they are valid under applicable law.  If additional permissions
apply only to part of the Program, that part may be used separately
under those permissions, but the entire Program remains governed by
this License without regard to the additional permissions.

  When you convey a copy of a covered work, you may at your option
remove any additional permissions from that copy, or from any part of
it.  (Additional permissions may be written to require their own
removal in certain cases when you modify the work.)  You may place
additional permissions on material, added by you to a covered work,
for which you have or can give appropriate copyright permission.

  Notwithstanding any other provision of this License, for material you
add to a covered work, you may (if authorized by the copyright holders of
that material) supplement the terms of this License with terms:

    a) Disclaiming warranty or limiting liability differently from the
    terms of sections 15 and 16 of this License; or

    b) Requiring preservation of specified reasonable legal notices or
    author attributions in that material or in the Appropriate Legal
    Notices displayed by works containing it; or

    c) Prohibiting misrepresentation of the origin of that material, or
    requiring that modified versions of such material be marked in
    reasonable ways as different from the original version; or

    d) Limiting the use for publicity purposes of names of licensors or
    authors of the material; or

    e) Declining to grant rights under trademark law for use of some
    trade names, trademarks, or service marks; or

    f) Requiring indemnification of licensors and authors of that
    material by anyone who conveys the material (or modified versions of
    it) with contractual assumptions of liability to the recipient, for
    any liability that these contractual assumptions directly impose on
    those licensors and authors.

  All other non-permissive additional terms are considered "further
restrictions" within the meaning of section 10.  If the Program as you
received it, or any part of it, contains a notice stating that it is
governed by this License along with a term that is a further
restriction, you may remove that term.  If a license document contains
a further restriction but permits relicensing or conveying under this
License, you may add to a covered work material governed by the terms
of that license document, provided that the further restriction does
not survive such relicensing or conveying.

  If you add terms to a covered work in accord with this section, you
must place, in the relevant source files, a statement of the
additional terms that apply to those files, or a notice indicating
where to find the applicable terms.

  Additional terms, permissive or non-permissive, may be stated in the
form of a separately written license, or stated as exceptions;
the above requirements apply either way.

  8. Termination.

  You may not propagate or modify a covered work except as expressly
provided under this License.  Any attempt otherwise to propagate or
modify it is void, and will automatically terminate your rights under
this License (including any patent licenses granted under the third
paragraph of section 11).

  However, if you cease all violation of this License, then your
license from a particular copyright holder is reinstated (a)
provisionally, unless and until the copyright holder explicitly and
finally terminates your license, and (b) permanently, if the copyright
holder fails to notify you of the violation by some reasonable means
prior to 60 days after the cessation.

  Moreover, your license from a particular copyright holder is
reinstated permanently if the copyright holder notifies you of the
violation by some reasonable means, this is the first time you have
received notice of violation of this License (for any work) from that
copyright holder, and you cure the violation prior to 30 days after
your receipt of the notice.

  Termination of your rights under this section does not terminate the
licenses of parties who have received copies or rights from you under
this License.  If your rights have been terminated and not permanently
reinstated, you do not qualify to receive new licenses for the same
material under section 10.

  9. Acceptance Not Required for Having Copies.

  You are not required to accept this License in order to receive or
run a copy of the Program.  Ancillary propagation of a covered work
occurring solely as a consequence of using peer-to-peer transmission
to receive a copy likewise does not require acceptance.  However,
nothing other than this License grants you permission to propagate or
modify any covered work.  These actions infringe copyright if you do
not accept this License.  Therefore, by modifying or propagating a
covered work, you indicate your acceptance of this License to do so.

  10. Automatic Licensing of Downstream Recipients.

  Each time you convey a covered work, the recipient automatically
receives a license from the original licensors, to run, modify and
propagate that work, subject to this License.  You are not responsible
for enforcing compliance by third parties with this License.

  An "entity transaction" is a transaction transferring control of an
organization, or substantially all assets of one, or subdividing an
organization, or merging organizations.  If propagation of a covered
work results from an entity transaction, each party to that
transaction who receives a copy of the work also receives whatever
licenses to the work the party's predecessor in interest had or could
give under the previous paragraph, plus a right to possession of the
Corresponding Source of the work from the predecessor in interest, if
the predecessor has it or can get it with reasonable efforts.

  You may not impose any further restrictions on the exercise of the
rights granted or affirmed under this License.  For example, you may
not impose a license fee, royalty, or other charge for exercise of
rights granted under this License, and you may not initiate litigation
(including a cross-claim or counterclaim in a lawsuit) alleging that
any patent claim is infringed by making, using, selling, offering for
sale, or importing the Program or any portion of it.

  11. Patents.

  A "contributor" is a copyright holder who authorizes use under this
License of the Program or a work on which the Program is based.  The
work thus licensed is called the contributor's "contributor version".

  A contributor's "essential patent claims" are all patent claims
owned or controlled by the contributor, whether already acquired or
hereafter acquired, that would be infringed by some manner, permitted
by this License, of making, using, or selling its contributor version,
but do not include claims that would be infringed only as a
consequence of further modification of the contributor version.  For
purposes of this definition, "control" includes the right to grant
patent sublicenses in a manner consistent with the requirements of
this License.

  Each contributor grants you a non-exclusive, worldwide, royalty-free
patent license under the contributor's essential patent claims, to
make, use, sell, offer for sale, import and otherwise run, modify and
propagate the contents of its contributor version.

  In the following three paragraphs, a "patent license" is any express
agreement or commitment, however denominated, not to enforce a patent
(such as an express permission to practice a patent or covenant not to
sue for patent infringement).  To "grant" such a patent license to a
party means to make such an agreement or commitment not to enforce a
patent against the party.

  If you convey a covered work, knowingly relying on a patent license,
and the Corresponding Source of the work is not available for anyone
to copy, free of charge and under the terms of this License, through a
publicly available network server or other readily accessible means,
then you must either (1) cause the Corresponding Source to be so
available, or (2) arrange to deprive yourself of the benefit of the
patent license for this particular work, or (3) arrange, in a manner
consistent with the requirements of this License, to extend the patent
license to downstream recipients.  "Knowingly relying" means you have
actual knowledge that, but for the patent license, your conveying the
covered work in a country, or your recipient's use of the covered work
in a country, would infringe one or more identifiable patents in that
country that you have reason to believe are valid.

  If, pursuant to or in connection with a single transaction or
arrangement, you convey, or propagate by procuring conveyance of, a
covered work, and grant a patent license to some of the parties
receiving the covered work authorizing them to use, propagate, modify
or convey a specific copy of the covered work, then the patent license
you grant is automatically extended to all recipients of the covered
work and works based on it.

  A patent license is "discriminatory" if it does not include within
the scope of its coverage, prohibits the exercise of, or is
conditioned on the non-exercise of one or more of the rights that are
specifically granted under this License.  You may not convey a covered
work if you are a party to an arrangement with a third party that is
in the business of distributing software, under which you make payment
to the third party based on the extent of your activity of conveying
the work, and under which the third party grants, to any of the
parties who would receive the covered work from you, a discriminatory
patent license (a) in connection with copies of the covered work
conveyed by you (or copies made from those copies), or (b) primarily
for and in connection with specific products or compilations that
contain the covered work, unless you entered into that arrangement,
or that patent license was granted, prior to 28 March 2007.

  Nothing in this License shall be construed as excluding or limiting
any implied license or other defenses to infringement that may
otherwise be available to you under applicable patent law.

  12. No Surrender of Others' Freedom.

  If conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot convey a
covered work so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you may
not convey it at all.  For example, if you agree to terms that obligate you
to collect a royalty for further conveying from those to whom you convey
the Program, the only way you could satisfy both those terms and this
License would be to refrain entirely from conveying the Program.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.  The terms of this
License will continue to apply to the part which is the covered work,
but the special requirements of the GNU Affero General Public License,
section 13, concerning interaction through a network will apply to the
combination as such.

  14. Revised Versions of this License.

  The Free Software Foundation may publish revised and/or new versions of
the GNU General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

  Each version is given a distinguishing version number.  If the
Program specifies that a certain numbered version of the GNU General
Public License "or any later version" applies to it, you have the
option of following the terms and conditions either of that numbered
version or of any later version published by the Free Software
Foundation.  If the Program does not specify a version number of the
GNU General Public License, you may choose any version ever published
by the Free Software Foundation.

  If the Program specifies that a proxy can decide which future
versions of the GNU General Public License can be used, that proxy's
public statement of acceptance of a version permanently authorizes you
to choose that version for the Program.

  Later license versions may give you additional or different
permissions.  However, no additional obligations are imposed on any
author or copyright holder as a result of your choosing to follow a
later version.

  15. Disclaimer of Warranty.

  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

  16. Limitation of Liability.

  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGES.

  17. Interpretation of Sections 15 and 16.

  If the disclaimer of warranty and limitation of liability provided
above cannot be given local legal effect according to their terms,
reviewing courts shall apply local law that most closely approximates
an absolute waiver of all civil liability in connection with the
Program, unless a warranty or assumption of liability accompanies a
copy of the Program in return for a fee.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
state the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

Also add information on how to contact you by electronic and paper mail.

  If the program does terminal interaction, make it output a short
notice like this when it starts in an interactive mode:

    <program>  Copyright (C) <year>  <name of author>
    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type `show c' for details.

The hypothetical commands `show w' and `show c' should show the appropriate
parts of the General Public License.  Of course, your program's commands
might be different; for a GUI interface, you would use an "about box".

  You should also get your employer (if you work as a programmer) or school,
if any, to sign a "copyright disclaimer" for the program, if necessary.
For more information on this, and how to apply and follow the GNU GPL, see
<https://www.gnu.org/licenses/>.

  The GNU General Public License does not permit incorporating your program
into proprietary programs.  If your program is a subroutine library, you
may consider it more useful to permit linking proprietary applications with
the library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.  But first, please read
<https://www.gnu.org/licenses/why-not-lgpl.html>.
~~~
<!-- LICENSE:END -->
