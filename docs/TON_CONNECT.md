# TON Connect and persistent SQLite

Settings are available in Profile → Admin → TON Connect. Start in Testnet.
Configure the public HTTPS application URL, treasury receive address, GRAM-per-TON credit rate, deposit limits, withdrawal limits and Toncenter API key (optional; stored server-side and never returned to clients). The manifest is served at `/tonconnect-manifest.json`.

The integration transfers native TON. GRAM is the application's internal credit balance; this is not a GRAM jetton transfer implementation. The administrator explicitly configures the conversion rate.

A wallet connection is a payment address, not a wallet-based login. Telegram initData remains the authenticated identity. Wallet seed phrases and signing keys are never requested or stored. Each deposit gets a unique on-chain memo. A wallet's `sendTransaction` response does not credit balances: the server verifies destination, sender, exact nanoTON amount, memo, network and transaction hash through Toncenter. Crediting is transactional and idempotent. History exposes pending deposits for manual rechecking if a user leaves the page.

Only credits backed by verified deposits on the selected network are eligible for withdrawal, capped by the current application balance. Existing local test grants cannot be withdrawn as TON. Withdrawal requests reserve both balances. The operator prepares each request, approves the transfer in the treasury wallet through TON Connect, then checks the transaction on-chain. Preparation locks a request against a second send. An interrupted wallet approval remains in processing for operator reconciliation; the UI does not automatically resend it. There is no unattended private-key-based payout worker.

## Persistence

1. Before restarting or changing the Render plan, open Crafter as a Telegram administrator and download **Скачать резервную копию SQLite** from **Профиль → Админ-панель → TON Connect**. Schedule the cutover for a quiet period so purchases and wallet activity after the export are not lost. Keep the file private. It contains user data and may contain a configured RPC API key. The download strips Telegram bot credentials saved through the admin panel, so reconfigure that bot after restoring if needed.
2. Attach a persistent disk at `/var/data` on a paid Render web service. Render starts a new deploy when the disk is attached. Keep the application in maintenance during restoration.
3. Upload the backup and `scripts/restore_sqlite.py` privately via Render SSH/SFTP. Restore to a new filename, even if the app has already initialized an empty default database on the disk.

   ```sh
   python /var/data/restore_sqlite.py /var/data/crafter-backup.sqlite3 /var/data/crafter-restored.sqlite3
   ```

4. Set the Render environment variable `DATABASE` to `/var/data/crafter-restored.sqlite3` and deploy. Verify the reported storage path and durability in **TON Connect** admin settings. Compare existing balances, gift inventory, wallet history and pending transfers before reopening the app.

The restore command checks SQLite integrity and the required Crafter tables before publishing the file. It refuses to overwrite a database. Mainnet funding on Render requires a database under the mounted `/var/data` disk.

## Verification performed

Local tests cover network matching, address parsing, deposit BoC memo round-trip, no credit from an unverified client response, single credit on repeated checks, funded-only withdrawal limits, repeated withdrawal requests and the mainnet storage guard. No real money transfer was initiated during implementation. A real wallet connection and end-to-end Testnet transaction still need to be exercised with the operator's configured treasury address.
