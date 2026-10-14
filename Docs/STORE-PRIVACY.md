# Chrome Web Store — Privacy tab

Copy these fields into the developer dashboard for Direct Pump 0.8.0. This file documents the form; including it in an extension ZIP does not fill or certify the form. Based on the current extension and [published privacy policy](https://github.com/superb43/direct_pump/blob/main/Docs/PRIVACY.md).

## Single purpose description

```text
Trade supported Solana tokens from a side panel on Axiom, GMGN and FOMO Family, with related holdings and execution receipts. Basic requires Phantom approval; optional Pro sends reviewed orders to the user's self-hosted server wallet.
```

## Permission justification — storage

```text
Save execution preferences, user-entered API credentials, Pro connection/device metadata and transaction recovery records in extension-owned storage. Website content scripts receive only approved public presets, not credentials or private history.
```

## Permission justification — scripting

```text
Run packaged token readers and chart integration on supported pages, and communicate with Phantom for explicitly approved Basic trades. Frame and document checks bind requests to the selected page. No remote JavaScript is injected.
```

## Permission justification — sidePanel

```text
Show trading controls, holdings, receipts and optional Pro features in a native side panel beside the current supported token page.
```

## Permission justification — alarms

```text
Poll the paired personal server for Pro event notifications approximately once per minute when Pro and Chrome notifications are enabled. The alarm does not authorize or sign Basic trades.
```

## Permission justification — notifications

```text
Display optional Pro order, execution and withdrawal notifications. Access is requested when the user enables Chrome notifications.
```

## Host permission justification

If the dashboard presents one combined host-permission field, use:

```text
gmgn.ai, axiom.trade and fomo.family: identify the current Solana token/pool, read token and chart context, and communicate with Phantom for Basic approval on that page.

api.mainnet-beta.solana.com and solana-rpc.publicnode.com: query blockchain accounts, balances, transaction status and simulations, and submit signed transactions when needed for reviewed execution and recovery.

api.coinbase.com and api.exchange.coinbase.com: obtain current and historical SOL/USD conversion data.

Optional https://*/*: allow users to grant only the selected HTTPS origin for a custom RPC, Jupiter routing service or self-hosted Pro server. Access is requested while saving/connecting to that service; the extension does not request access to every HTTPS site. This enables user-selected service connections, not general browsing surveillance.
```

If domains are listed individually, use the matching explanations in [the listing's permission table](STORE-LISTING.md#privacy--permission-justifications).

## Remote code

Select **No, I am not using remote code** for the current packaged implementation. If a text field is shown, use:

```text
All browser-executed code is bundled in the extension. External services return blockchain, pricing, routing or personal-server data. Jupiter transaction instructions are locally decoded and validated; they are not downloaded browser code. Pro's server-side execution does not load remote JavaScript into the extension.
```

Confirm this remains true for the exact package being submitted.

## Data usage — checkboxes

Use the current dashboard's equivalent labels:

| Category | Select | Data handled |
| --- | --- | --- |
| Personally identifiable information | Yes | Wallet and device identifiers; support contact information if voluntarily supplied. |
| Financial and payment information | Yes | Balances, holdings, orders, withdrawals, trade amounts, signatures, fees and receipts. |
| Authentication information | Yes | User-entered API credentials, credential-bearing RPC URLs, Pro pairing and device authentication material. |
| Web history | Yes | Supported token-page URLs used for the active trading context; no general browsing-history feed. |
| Website content | Yes | Token metadata, displayed prices and chart context from supported pages. |
| Health information | No | Not a feature. |
| Personal communications | No | No access to emails, messages or conversations; sending optional event alerts does not read conversations. |
| Location | No | No location feature; external providers can observe connection IP addresses as explained in the policy. |
| User activity | No | No general tracking of clicks, keystrokes or browsing behavior. |

Local-only processing is still data handling. Do not select “no data collected” simply because there is no developer analytics backend.

## Data-use certifications

For the current implementation and published policy, select the three certifications that data is:

- Not sold or transferred to third parties outside approved use cases.
- Not used or transferred for purposes unrelated to the extension's single purpose.
- Not used or transferred to determine creditworthiness or for lending purposes.

Necessary RPC/router/Pro-server communications are disclosed service uses, not a claim that no data ever leaves the browser. These declarations cover actual deployment practices as well as source code.

## Privacy policy URL

```text
https://github.com/superb43/direct_pump/blob/main/Docs/PRIVACY.md
```

## Registration behavior

The uploaded manifest supplies permission names; it does not supply the purpose, permission explanations, data-use selections, certifications or policy URL. Those belong to the dashboard's Privacy tab. Text files in the ZIP are not interpreted as dashboard fields. Writing this document does not save the dashboard or submit the extension for review.

Reference: [Chrome Web Store privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).
