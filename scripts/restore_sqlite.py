"""Verify a Crafter SQLite backup and restore it to a new database file."""
import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


REQUIRED_TABLES = {
    'users', 'demo_accounts', 'inventory', 'history', 'settings',
    'ton_deposits', 'ton_withdrawals', 'ton_transactions', 'wallet_balances',
}


def restore(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f'Destination already exists: {destination}')
    if not source.is_file():
        raise ValueError('Source must be a SQLite backup file')

    with tempfile.TemporaryDirectory(prefix='.crafter-restore-', dir=destination.parent) as directory:
        restored = Path(directory) / 'database.sqlite3'
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as backup:
            with closing(sqlite3.connect(restored)) as database:
                backup.backup(database)
                database.execute('PRAGMA journal_mode=DELETE')
                result = database.execute('PRAGMA integrity_check').fetchall()
                if result != [('ok',)]:
                    raise ValueError('SQLite integrity check failed')
                tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not REQUIRED_TABLES <= tables:
                    raise ValueError('The backup does not contain the required Crafter tables')

        restored.chmod(0o600)
        with restored.open('rb') as file:
            os.fsync(file.fileno())
        # Publish the verified file without replacing a file created in the meantime.
        os.link(restored, destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        restore(args.backup, args.destination)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Restore failed: {error}\n')
    print(f'Validated and restored SQLite database to {args.destination}')


if __name__ == '__main__':
    main()
