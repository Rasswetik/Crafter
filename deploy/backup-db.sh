#!/usr/bin/env bash
# Daily backup of the Crafter PostgreSQL database and the .env (secrets) on the same VPS.
# Install:  cp /opt/crafter/deploy/backup-db.sh /usr/local/bin/crafter-backup && chmod +x /usr/local/bin/crafter-backup
#           echo "15 3 * * * root /usr/local/bin/crafter-backup" > /etc/cron.d/crafter-backup
# Restore:  systemctl stop crafter && sudo -u postgres pg_restore --clean --if-exists -d crafter FILE.dump && systemctl start crafter
set -euo pipefail
DIR=/var/backups/crafter
KEEP_DAYS=14
umask 077
mkdir -p "$DIR"
STAMP="$(date +%F_%H%M)"
sudo -u postgres pg_dump -Fc crafter > "$DIR/crafter_$STAMP.dump"
cp /opt/crafter/.env "$DIR/env_$STAMP.bak"
find "$DIR" -type f \( -name 'crafter_*.dump' -o -name 'env_*.bak' \) -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $DIR/crafter_$STAMP.dump ($(du -h "$DIR/crafter_$STAMP.dump" | cut -f1))"
