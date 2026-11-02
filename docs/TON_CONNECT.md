# TON Connect and persistent SQLite

Settings are available in Profile → Admin → TON Connect. Start in Testnet.
Configure the public HTTPS application URL, treasury receive address, GRAM-per-TON credit rate, deposit limits, withdrawal limits and Toncenter API key (optional; stored server-side and never returned to clients). The manifest is served at `/tonconnect-manifest.json`.

The integration transfers native TON. GRAM is the application's internal credit balance; this is not a GRAM jetton transfer implementation. The administrator explicitly configures the conversion rate.

A wallet connection is a payment address, not a wallet-based login. Telegram initData remains the authenticated identity. Wallet seed phrases and signing keys are never requested or stored. Each deposit gets a unique on-chain memo. A wallet's `sendTransaction` response does not credit balances: the server verifies destination, sender, exact nanoTON amount, memo, network and transaction hash through Toncenter. Crediting is transactional and idempotent. History exposes pending deposits for manual rechecking if a user leaves the page.

Only credits backed by verified deposits on the selected network are eligible for withdrawal, capped by the current application balance. Existing local test grants cannot be withdrawn as TON. Withdrawal requests reserve both balances. The operator prepares each request, approves the transfer in the treasury wallet through TON Connect, then checks the transaction on-chain. Preparation locks a request against a second send. An interrupted wallet approval remains in processing for operator reconciliation; the UI does not automatically resend it. There is no unattended private-key-based payout worker.

## Persistence

Render Free uses an ephemeral filesystem. WAL does not make it persistent.
Before changing compute plans or redeploying, download the authenticated SQLite backup from the TON Connect admin section. Backups contain private user data and the configured RPC API key: keep them private.

Attach a persistent disk at `/var/data` to a supported paid Render service. The application automatically uses `/var/data/crafter.sqlite3` when that directory is present, unless DATABASE explicitly specifies a different file. Restore the SQLite backup to that path while the service is stopped. Only files under the actual mount persist. Mainnet funding is blocked on Render unless the database is under the mounted `/var/data` disk.

No paid plan or disk is provisioned automatically by this code change.

## Verification performed

Local tests cover network matching, address parsing, deposit BoC memo round-trip, no credit from an unverified client response, single credit on repeated checks, funded-only withdrawal limits, repeated withdrawal requests and the mainnet storage guard. No real money transfer was initiated during implementation. A real wallet connection and end-to-end Testnet transaction still need to be exercised with the operator's configured treasury address.
