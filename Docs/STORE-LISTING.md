# Chrome Web Store submission copy

Prepared for Direct Pump 0.8.0 on October 14, 2026. Reconcile with the final submitted ZIP before use. Operator: Direct pump. Public contact: ctb1729@gmail.com. UI and primary listing language: English. Use an appropriate available category for a finance/trading tool; dashboard categories can change.

## Store listing — package summary

The manifest summary (also saved in `wxt.config.ts`):

```text
Keep the terminal. Skip the terminal fee. Trade Solana on Axiom, GMGN & FOMO Family. Open source.
```

An already uploaded ZIP retains its old summary. Rebuild and upload a new package to update it; a materials ZIP cannot change package metadata.

## Store listing — detailed description

```text
Keep the terminal. Skip the terminal fee.

Found a token on Axiom, GMGN or FOMO Family? Trade it right there. No copying addresses. No switching tabs.

Direct Pump adds quick buys, percentage sells, holdings, estimated PnL and execution receipts beside the charts you already use.

0% added terminal fees. Open source.
Basic: approve every trade in Phantom.
Pro: limit orders, TP/SL and trailing exits through your self-hosted server wallet.

Supported Solana tokens only. Network, protocol and other execution costs still apply.
```

## Graphic assets and video

| Asset | Copy | Format |
| --- | --- | --- |
| Small promo tile | Direct Pump / Keep the terminal. Skip the terminal fee. | 440 × 280 PNG |
| Marquee promo tile | Keep the terminal. Skip the terminal fee. / Your execution layer for Axiom, GMGN & FOMO Family. / 0% added terminal fees. Open source. | 1400 × 560 PNG |
| Screenshot 1 — Basic | Keep the terminal. Skip the terminal fee. / Trade the token you're already watching. / Basic trades stay Phantom-approved. | 1280 × 800 PNG |
| Screenshot 2 — Receipts | See where every fee goes. / Execution receipts. Real costs. Clear history. | 1280 × 800 PNG |
| Screenshot 3 — Settings | Your trades. Your settings. / Set your amounts, slippage and priority fees. | 1280 × 800 PNG |
| Screenshot 4 — Pro | Plan your exit before you enter. / Limit orders. TP/SL. Trailing exits. / Pro requires your self-hosted server wallet. | 1280 × 800 PNG |
| Screenshot 5 — Pro orders | Let your server watch the price. / Reviewed orders run while your server and signer are online. | 1280 × 800 PNG |

Screenshots retain synthetic-data disclosure. Fee claims retain the distinction between added terminal fees and actual network/protocol costs. The optional marquee uses the same product identity and an actual Basic panel capture.

The official store instructions specify PNG/JPEG promotional artwork and a YouTube URL for video. Animated GIF is not an officially documented upload format; use static PNG artwork and a YouTube demo for motion. A video does not replace mandatory screenshots or the small promo tile.

Suggested YouTube title:

```text
Direct Pump — Keep the terminal. Skip the terminal fee.
```

Suggested YouTube description:

```text
Trade supported Solana tokens directly from Axiom, GMGN and FOMO Family.
0% added terminal fees. Phantom-approved in Basic. Open source.

Demo uses synthetic sample data. No real transaction was sent.
Network, protocol and other execution costs still apply.

Source and setup: https://github.com/superb43/direct_pump
```

The existing `Docs/media/demo.gif` shows the Basic interaction. Convert the animation to MP4 before uploading to YouTube; include the synthetic-data disclosure. If showing Pro, label it as self-hosted personal-server execution rather than Phantom-approved execution. No YouTube upload is performed by preparing these files.

## Privacy — single purpose

```text
Provide a Solana trading side panel for supported GMGN, Axiom and FOMO Family token pages, including reviewed trade execution, associated holdings and receipts. Basic uses explicit Phantom approval; optional Pro submits reviewed orders to the user's self-hosted personal server wallet.
```

## Privacy — permission justifications

Paste the matching explanation for each permission shown by the dashboard.

| Permission | Explanation |
| --- | --- |
| storage | Store user-selected execution settings, API credentials, Pro connection/device metadata, transaction/recovery records and notification cursors in extension-owned storage. Content scripts receive only policy-approved public settings, not credentials or complete history. |
| scripting | Inject packaged token readers and chart integration into supported pages and communicate with the installed Phantom provider for user-approved Basic transactions. Frame/document checks bind each request to the active supported page. No remote JavaScript is fetched for injection. |
| sidePanel | Display the extension's trading, holdings, Pro, wallet and settings interface in a native Chrome side panel beside the supported token page. |
| alarms | Wake the background worker approximately once per minute to poll personal-server events when Pro and Chrome notifications are enabled. This alarm does not approve or sign Basic trades. |
| notifications (optional) | Display user-enabled Pro execution/order/withdrawal event notifications. Permission is requested when the user enables Chrome notifications. |
| https://gmgn.ai/* | Identify the current supported Solana token, read displayed token/chart context, mount chart integration and communicate with Phantom for Basic approval on GMGN. |
| https://axiom.trade/* | Identify the current supported Solana pool/token page, read displayed token/chart context, mount chart integration and communicate with Phantom for Basic approval on Axiom. Pool identity is validated before execution. |
| https://fomo.family/* | Identify the current supported Solana token, read displayed token/chart context, mount chart integration and communicate with Phantom for Basic approval on FOMO Family. |
| https://api.mainnet-beta.solana.com/* and https://solana-rpc.publicnode.com/* | Query blockchain accounts, balances, transactions and simulation results, and submit signed transactions when required for the reviewed trade and recovery workflow. PublicNode is the current default RPC endpoint. |
| https://api.coinbase.com/* and https://api.exchange.coinbase.com/* | Request current/historical SOL/USD conversion data for USD valuation, receipts and fee comparisons. |
| https://*/* (optional host permission) | Let users grant access to the specific HTTPS origin of their configured custom Solana RPC, Jupiter routing service or self-hosted Pro server. The runtime requests the selected origin when saving/connecting, rather than requesting every HTTPS site. These services provide blockchain reads, routed execution or personal-server authentication/order state. General browsing surveillance is not a feature. |

## Privacy — data categories

Recommended disclosure for the current implementation, to compare with the exact labels in your dashboard:

- **Personally identifiable information:** public wallet and Pro device identifiers, and support contact information if voluntarily sent. Public wallet addresses can identify users when combined with other data.
- **Financial and payment information:** balances, holdings, orders, trade/withdrawal amounts, signatures, fees and receipts.
- **Authentication information:** user-entered API credentials, RPC URL credentials where configured, Pro pairing and device authentication material. Wallet private keys are not imported into the extension.
- **Web history:** supported token-page URLs used for context; this is not a general history collection feature.
- **Website content:** displayed token metadata, prices and chart information read from the supported sites.

Health information, personal communications, precise location and general user-activity tracking are not implemented extension features. Providers can observe IP addresses during network connections; this is explained in the policy. These recommendations are intentionally based on data handling, not on whether a developer analytics backend exists.

Only certify the dashboard's no-sale/unrelated-use/creditworthiness statements after checking the policy and actual deployment. A self-hosted server or third-party provider is not a developer analytics service, but still involves data transfer.

## Privacy — remote code

Source inspection found packaged scripting injections and data/API communications, not a remote JavaScript loader. The Pro server executes its own server-side software; it does not deliver JavaScript for browser execution. Validate the final built package before selecting “No, I am not using remote code.” Jupiter returns transaction data that is locally decoded/validated, not downloaded browser code.

## Test instructions

```text
Direct Pump is a native side-panel extension for Solana token pages on https://gmgn.ai, https://axiom.trade and https://fomo.family. The interface is in English. No Direct Pump developer account is required for Basic mode.

1. Install the extension in Chrome 116 or later and pin the action icon.
2. Open a current Solana token page through a supported site's own navigation:
   GMGN: /sol/token/<mint> (some pages include an address prefix)
   Axiom: /meme/<pool>
   FOMO Family: /tokens/solana/<mint>
3. Click the extension action to open the side panel. Verify token context and trading controls. On an unsupported page, an empty-state message is expected; non-Solana pages are not trade targets.
4. Use Settings to inspect presets, slippage, fees and RPC options. No wallet seed phrase or wallet private key is requested. Custom endpoint access is an optional permission requested for the selected origin.
5. Basic wallet connection requires an installed Phantom provider. Use an unfunded test wallet to inspect connection and the interface. No funded transaction, deposit or signing is requested as part of these test instructions. Every actual Basic trade requires explicit Phantom approval. Without holdings or a funded wallet, balance/quote/receipt availability can be limited.
6. Turn the Pro switch on to see the introduction. Choose Explore to inspect the unpaired preview. Preview actions show setup guidance and cannot execute an order. Managed Pro is marked as coming soon.
7. Real Pro execution requires a user-operated personal HTTPS server, separate server wallet, device pairing and a private-console signer unlock. The optional mode supports server-side automatic execution of reviewed orders. Closing the browser does not cancel server orders. No production signer, funded wallet, pairing secret or provider API key is supplied with this submission.

Complete personal-server setup instructions: https://github.com/superb43/direct_pump/blob/main/Docs/PROJECT.md#pro-setup
Source: https://github.com/superb43/direct_pump
Contact: ctb1729@gmail.com

Store screenshots show the actual UI with synthetic sample data, not funded execution. Site availability, site authentication and external RPC/router availability are outside the extension's control. If additional access is required to review server-dependent functionality, contact the developer to arrange a suitable isolated test environment before approving that functionality.
```

Reviewers must be able to assess all shipped functionality. Unpaired preview alone is not evidence that live Pro works; respond to requests for an isolated review environment without sharing production credentials or funding trades merely for verification.

## Reference sources

- [Listing fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy and permissions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Images](https://developer.chrome.com/docs/webstore/images)
- [Review process](https://developer.chrome.com/docs/webstore/review-process)
