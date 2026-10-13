# Direct Pump Privacy Policy

Last updated: October 13, 2026

Direct pump operates the Direct Pump Chrome extension. Contact: [ctb1729@gmail.com](mailto:ctb1729@gmail.com).

## Scope

Direct Pump provides a Solana trading side panel for GMGN, Axiom and FOMO Family. Basic uses transactions you approve in Phantom. Optional Pro sends reviewed commands to a personal server you configure; that server can execute registered orders without a separate Phantom prompt. This policy covers the extension and describes the optional self-hosted Pro components. External websites, wallets and service providers have their own policies.

## Data the extension processes

- Supported token-page URLs, token or pool addresses, and displayed token metadata, prices and chart context, to identify the current asset and display trading information. It does not collect a general browsing-history feed.
- Public wallet addresses, balances, token holdings, transaction signatures, trade amounts, fee information and locally tracked receipts, to show portfolio information, prepare transactions and reconcile results.
- Execution preferences, RPC and optional WebSocket endpoints, and a Jupiter API key you enter, to connect to your selected services and apply your settings.
- Optional Pro server address, server/device identifiers, pairing information, a device authentication key, orders, withdrawal instructions, balances and server events, to authenticate and operate your personal server connection. The device authentication key is separate from a wallet private key.
- Local diagnostic events, including errors, status and request context, to investigate failures. Diagnostic sanitization reduces sensitive content but exports can still contain financial or identifying information.

The extension does not request your Phantom seed phrase or wallet private key. A Pro wallet private key remains in the private server signer; it is not imported into browser storage or site DOM. This does not mean the browser stores no credentials: user-entered API credentials and Pro device authentication material are stored locally.

## Storage and retention

Settings, credentials, local receipts and diagnostics are stored in extension-owned Chrome storage and IndexedDB. Financial history and execution/recovery records persist so the extension can display history and resolve pending transactions. Local diagnostic retention is bounded to seven days and approximately 5 MiB by the diagnostic store.

The Pro server stores its own encrypted wallet keystore, device registrations, configuration and financial/authentication journals on the server you operate. Retention and backups of that server are under your control. Browser removal does not erase server records or cancel registered server orders.

## External communications

- Solana RPC providers, including the configured endpoint (PublicNode by default) and any configured subscriptions, receive account addresses, blockchain queries, simulations and signed transaction bytes when needed. Providers can receive connection information such as your IP address and any credentials required by the endpoint.
- Coinbase endpoints receive SOL/USD price requests, including historical dates where applicable. Those price requests do not intentionally include wallet credentials.
- Jupiter receives route/build requests, including asset identifiers, amounts and relevant wallet information where needed, and your Jupiter API key when using routed execution.
- Phantom receives wallet connection and transaction approval requests for Basic mode through its page provider. Basic trading requires your explicit Phantom approval.
- Your configured Pro server receives pairing/device authentication information, reviewed order and withdrawal commands, and requests for wallet/order state. Pro trading uses a separate server wallet.
- If you configure Telegram alerts on your Pro server, the server sends alert text, event/order or withdrawal identifiers and transaction links to Telegram using your bot and chat configuration. Optional Chrome notifications display server event summaries locally.
- Opening a Solscan transaction link, documentation, or a Telegram community link navigates to that external service, whose own policy applies.

The extension does not automatically upload diagnostics to a developer-operated analytics service. If you choose to export diagnostics or send support information, inspect and redact it before sharing. Email or issue reports you send to Direct pump are used to respond to the request; do not send keys, seed phrases, API credentials or pairing codes.

Blockchain transactions and associated wallet addresses are public. Confirmed blockchain records cannot be deleted by uninstalling the extension or by contacting us.

## Use and disclosure

Data is used to provide the described trading, portfolio, receipt, connection, notification and troubleshooting features. Direct pump does not sell extension user data, use it for advertising, or use it to determine creditworthiness or for lending. Data is not transferred for purposes unrelated to these features. Necessary service communications are described above. Information voluntarily sent to support may also be disclosed when required by law.

Direct Pump's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Your controls

You can change endpoints and credentials in extension settings, decline optional host/notification permissions, and disable optional features. Before removing the extension or its storage, resolve pending transactions and export any records you need: removing local recovery data can prevent the extension from resolving uncertainty. Uninstalling removes extension-owned browser data but not downloaded exports, browser/profile backups, Pro server data or public blockchain records.

For Pro, manage registered orders, device access, signer state and server backups on your own server. Closing the browser or uninstalling the extension does not stop server execution. Use the documented server pause and device-revocation procedures when needed; do not delete financial journals to resolve uncertainty.

## Changes and contact

Material changes to data handling will be reflected in this policy and its update date. For privacy questions, contact [ctb1729@gmail.com](mailto:ctb1729@gmail.com).
