# Pro operations and recovery

[← README](../README.md) · [Server setup](HOW-TO-SET-PRO.md)

Pro uses a separate server wallet. Basic retains manual Phantom approval. Pro is
disabled by default, but registered orders can continue while the browser is closed.
For installation, OS permissions, HTTPS, pairing and initial unlock, follow the
[setup guide](HOW-TO-SET-PRO.md).

## Orders and recovery

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

## Pausing and restarting

**Pro OFF** pauses unsubmitted orders only after server acknowledgement. A lost
acknowledgement leaves the stop unconfirmed. Already signed or uncertain attempts
continue to be reconciled. Closing the browser does not stop the server.

The signer starts locked. After a restart or lock, unlock it on the private console
and explicitly enable Pro or resume the engine. Unlocking alone does not resume
execution. Individually paused orders need their own resume in Orders. See
[unlock and enable](HOW-TO-SET-PRO.md#6-unlock-and-enable-pro) and
[stop and restart](HOW-TO-SET-PRO.md#stop-restart-and-troubleshoot) for commands.

If a signer process lock remains after an unclean stop, inspect its PID and verify
that no signer is running before manually removing the lock. Never remove a live
signer's lock or start a second signer against the same state.

## Withdrawals and saved recipients

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

## Alerts and diagnostics

Chrome alerts are optional. Server-side Telegram delivery can continue after
browser closure. Alerts may be delayed or duplicated after delivery timeouts and
are not final execution evidence. Configure routing and Telegram credentials only
through the [server environment](HOW-TO-SET-PRO.md#optional-routing-and-alerts).
Basic's Jupiter setting is separate from the server setting.

Settings and the receipt dashboard export sanitized browser diagnostics; Pro also
provides server events/logs. Correlate request nonce, order ID, attempt ID and
signature. Keys, passphrases, credentials and signed transaction bytes are excluded.
Browser diagnostics retain up to 7 days / 5 MiB; server diagnostics retain up to
30 days / 250 MiB. Debug capture expires within 60 minutes. These limits never
remove unresolved financial evidence or authorization journals. Optional logging
failure does not change a trade result; failed durable authorization prevents signing.

## State, backups and access

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

## Dependency limits

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

## Troubleshooting

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
