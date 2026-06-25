# VPS PostgreSQL Setup Guide

Use this guide for an agent setting up the Spam Catcher database on a VPS.

## Goal

Set up a local-only PostgreSQL database for this project.

- Database: `spam_catcher`
- App user: `spamcatcher`
- Host: `127.0.0.1`
- Port: `5432`
- SSL mode: `disable`, because the bot and database are on the same VPS
- Schema file: `scripts/schema-postgres.sql`

Do not expose PostgreSQL to the public internet.

## Safety Rules

- Inspect the VPS OS and existing PostgreSQL state before making changes.
- Do not reinstall PostgreSQL if it is already installed and healthy.
- Do not delete existing databases, users, or config files.
- Keep PostgreSQL bound to localhost only.
- Use a dedicated database user; do not run the bot as the `postgres` superuser.
- Store the final password only in the app `.env` and any root-only backup config if needed.

## 1. Preflight

Run from the project directory on the VPS.

```bash
pwd
test -f scripts/schema-postgres.sql
uname -a
cat /etc/os-release
```

Check whether PostgreSQL is installed:

```bash
psql --version
systemctl status postgresql --no-pager
```

If `psql` is missing on Ubuntu/Debian, install PostgreSQL:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

For non-Ubuntu/Debian systems, use the OS package manager equivalent and keep the same database/user/schema goals.

## 2. Keep PostgreSQL Local-Only

Check listen address:

```bash
sudo -u postgres psql -tAc "SHOW listen_addresses;"
sudo ss -ltnp | grep ':5432' || true
```

Expected safe result: PostgreSQL listens on `127.0.0.1:5432`, `localhost`, or a local Unix socket only.

If it is listening on `0.0.0.0`, `::`, or `*`, edit the active `postgresql.conf` and set:

```conf
listen_addresses = 'localhost'
```

Find the active config file if needed:

```bash
sudo -u postgres psql -tAc "SHOW config_file;"
```

After editing, restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

Do not add public `host all all 0.0.0.0/0` entries to `pg_hba.conf`.

## 3. Create Database User

Generate a password and save it in your notes for the `.env` step:

```bash
DB_PASS=$(openssl rand -hex 24)
printf 'Generated database password: %s\n' "$DB_PASS"
```

Create the app role if it does not exist:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spamcatcher') THEN
    CREATE ROLE spamcatcher LOGIN;
  END IF;
END
$$;
SQL
```

Set or rotate its password:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE spamcatcher WITH LOGIN PASSWORD '$DB_PASS';"
```

## 4. Create Database

Create the database if it does not exist:

```bash
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'spam_catcher'" | grep -q 1; then
  sudo -u postgres createdb -O spamcatcher spam_catcher
fi
```

Grant app privileges:

```bash
sudo -u postgres psql -d spam_catcher -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL PRIVILEGES ON DATABASE spam_catcher TO spamcatcher;
GRANT CREATE, USAGE ON SCHEMA public TO spamcatcher;
ALTER SCHEMA public OWNER TO spamcatcher;
SQL
```

## 5. Apply Schema

Apply this project's schema as the app user:

```bash
PGPASSWORD="$DB_PASS" psql \
  -h 127.0.0.1 \
  -U spamcatcher \
  -d spam_catcher \
  -v ON_ERROR_STOP=1 \
  -f scripts/schema-postgres.sql
```

Verify tables exist:

```bash
PGPASSWORD="$DB_PASS" psql \
  -h 127.0.0.1 \
  -U spamcatcher \
  -d spam_catcher \
  -c "\dt"
```

Expected tables:

- `spam_catcher_config`
- `spam_catcher_events`
- `spam_catcher_notice_messages`

## 6. Confirm App Connection

Build the connection string:

```bash
DATABASE_URL="postgresql://spamcatcher:${DB_PASS}@127.0.0.1:5432/spam_catcher"
printf '%s\n' "$DATABASE_URL"
```

Test it:

```bash
DATABASE_URL="postgresql://spamcatcher:${DB_PASS}@127.0.0.1:5432/spam_catcher" \
PG_SSL_MODE=disable \
node -e "const { Pool } = require('pg'); const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false }); p.query('select now()').then(r => { console.log(r.rows[0]); return p.end(); }).catch(e => { console.error(e); process.exit(1); });"
```

## 7. Update `.env`

Set these values in the project's `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:REPLACE_WITH_DB_PASS@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
DEBUG=false
```

Do not put guild-specific IDs in `.env`. These values belong in `spam_catcher_config`, one row per Discord guild:

- Guild/server ID
- Trap channel IDs
- Review channel ID
- Log channel ID
- Timeout and ban behavior
- Webhook notice settings

Then run:

```bash
npm run check
```

## 8. Add A Guild Config

Preferred path: start the bot, then run this command inside the Discord server as an Administrator:

```text
/spam-catcher setup
```

The command opens a Component V2 setup panel for selecting trap channels, review channel, log channel, moderation mode, enabling the feature, and posting trap notices.

CLI setup is also available.

Use the config script instead of hand-written SQL:

```bash
npm run config:upsert -- \
  --guild-id YOUR_DISCORD_GUILD_ID \
  --log-channel-id ADMIN_LOG_CHANNEL_ID \
  --review-channel-id ADMIN_REVIEW_CHANNEL_ID \
  --trap-channel-ids TRAP_CHANNEL_ID_1,TRAP_CHANNEL_ID_2 \
  --timeout-minutes 60 \
  --auto-ban false \
  --ban-mode delayed \
  --ban-delay-minutes 10
```

List configured guilds:

```bash
npm run config:list
```

Post trap-channel warning notices for that guild:

```bash
npm run post:notices -- --guild-id YOUR_DISCORD_GUILD_ID
```

Start the bot:

```bash
npm start
```

Optional: restrict the bot to known guilds by setting a comma-separated allowlist:

```env
ALLOWED_GUILD_IDS=GUILD_ID_1,GUILD_ID_2
```

## 9. Optional: Seed Config With SQL

Prefer `npm run config:upsert`. If you must use SQL, insert one row per guild:

```bash
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U spamcatcher -d spam_catcher <<'SQL'
INSERT INTO spam_catcher_config (guild_id, config_json, updated_at)
VALUES (
  'YOUR_DISCORD_GUILD_ID',
  '{
    "enabled": true,
    "channelIds": ["TRAP_CHANNEL_ID"],
    "logChannelId": "ADMIN_LOG_CHANNEL_ID",
    "timeoutMinutes": 60,
    "autoBanEnabled": false,
    "banMode": "delayed",
    "banDelayMinutes": 10,
    "reviewChannelId": "ADMIN_REVIEW_CHANNEL_ID",
    "webhookEnabled": false,
    "webhookUrls": []
  }'::jsonb,
  NOW()
)
ON CONFLICT (guild_id) DO UPDATE SET
  config_json = EXCLUDED.config_json,
  updated_at = EXCLUDED.updated_at;
SQL
```

Replace the placeholder IDs before running.

## 10. Daily Backups

Create a root-owned backup directory:

```bash
sudo install -d -m 700 -o root -g root /var/backups/spam-catcher
```

Create `/etc/cron.d/spam-catcher-db-backup`:

```cron
15 3 * * * root sudo -u postgres pg_dump -d spam_catcher | gzip > /var/backups/spam-catcher/spam_catcher_$(date +\%F).sql.gz && find /var/backups/spam-catcher -type f -name 'spam_catcher_*.sql.gz' -mtime +14 -delete
```

Test one backup immediately:

```bash
sudo -u postgres pg_dump -d spam_catcher | gzip | sudo tee /var/backups/spam-catcher/spam_catcher_test.sql.gz >/dev/null
sudo ls -lh /var/backups/spam-catcher
```

To inspect a backup without restoring:

```bash
zcat /var/backups/spam-catcher/spam_catcher_test.sql.gz | head
```

## 11. Final Report

Report back with:

- PostgreSQL version
- Whether PostgreSQL is bound to localhost only
- Database name created or reused
- App user created or reused
- Schema tables verified
- Final `.env` runtime values, with the database password shown only to the server owner
- Guild config rows created or updated
- Backup path and retention period

Do not print the database password in shared logs or public chat.
