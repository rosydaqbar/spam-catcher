# Multi-Guild Spam Catcher Plan

## Goal

Make the bot safely support multiple Discord guilds. Each guild should have independent Spam Catcher settings, trap channels, review channel, log channel, webhook settings, timeout duration, and ban behavior.

In the target multi-guild design, guild-specific IDs do not belong in `.env` anymore. Values like `DISCORD_GUILD_ID`, `LOG_CHANNEL_ID`, `SPAM_CATCHER_CHANNEL_IDS`, and `SPAM_CATCHER_REVIEW_CHANNEL_ID` should be replaced by one `spam_catcher_config` row per guild.

## Current State

- Core tables already support multi-guild data through `guild_id`.
- `src/bot/spam-catcher.js` already loads config by `message.guild.id`.
- Current risk: `.env` fallback config is global, so one guild's fallback trap settings could accidentally apply to another guild.
- `LOG_CHANNEL_ID` is global.
- `scripts/post-notices.js` only handles one `DISCORD_GUILD_ID`.
- There is no simple script to add or manage guild configs without editing SQL manually.

## Environment Boundary

After this change, `.env` should only contain process-level/runtime settings:

- `DISCORD_TOKEN`
- `DATABASE_URL`
- `PG_SSL_MODE`
- `BOT_POSTGRES_POOL_MAX`
- optional `ALLOWED_GUILD_IDS`
- optional `DEBUG`

These values should no longer be part of the recommended `.env` flow:

- `DISCORD_GUILD_ID`
- `LOG_CHANNEL_ID`
- `SPAM_CATCHER_CHANNEL_IDS`
- `SPAM_CATCHER_REVIEW_CHANNEL_ID`
- `SPAM_CATCHER_TIMEOUT_MINUTES`
- `SPAM_CATCHER_AUTO_BAN_ENABLED`
- `SPAM_CATCHER_BAN_MODE`
- `SPAM_CATCHER_BAN_DELAY_MINUTES`
- `SPAM_CATCHER_WEBHOOK_ENABLED`
- `SPAM_CATCHER_WEBHOOK_URLS`

Those values are guild config, not bot process config. They should be stored in `spam_catcher_config.config_json`, keyed by `guild_id`.

## Changes

### 1. Make Database Config The Source Of Truth

Update `src/config-store.js` so `getSpamCatcherConfig(guildId)` behaves like this:

- If `spam_catcher_config` has a row for the guild, return that normalized config.
- If no row exists, return disabled default config.
- Do not use global `.env` Spam Catcher channel settings for arbitrary guilds.

Reason: this prevents accidental moderation in a guild that was not explicitly configured.

### 2. Add Per-Guild `logChannelId`

Extend Spam Catcher config JSON with:

```json
{
  "logChannelId": "admin_log_channel_id"
}
```

Update `getGuildConfig(guildId)` to read `logChannelId` from that guild's config row. Do not use `LOG_CHANNEL_ID` as a runtime fallback.

### 3. Add Optional Guild Allowlist

Add optional env:

```env
ALLOWED_GUILD_IDS=
```

Behavior:

- Empty value: allow any guild that has `enabled: true` in DB config.
- Non-empty value: only allow guild IDs listed in `ALLOWED_GUILD_IDS`.

Add allowlist checks before handling:

- Trap-channel messages
- Appeal/admin interactions
- Delayed-ban loop events

### 4. Add Guild Config Upsert Script

Create `scripts/upsert-guild-config.js`.

Example usage:

```bash
node scripts/upsert-guild-config.js \
  --guild-id 123 \
  --log-channel-id 456 \
  --review-channel-id 789 \
  --trap-channel-ids 111,222 \
  --timeout-minutes 60 \
  --auto-ban false \
  --ban-mode delayed \
  --ban-delay-minutes 10
```

Responsibilities:

- Validate required IDs.
- Normalize config with existing config-store logic.
- Upsert into `spam_catcher_config`.
- Print a safe summary without secrets.

### 5. Add Guild Config List Script

Create `scripts/list-guild-configs.js`.

Output for each guild:

- Guild ID
- Enabled status
- Trap channel count
- Review channel ID
- Log channel ID
- Ban mode
- Webhook enabled status

Purpose: simple VPS/admin visibility without a dashboard.

### 6. Update Notice Posting Script

Update `scripts/post-notices.js` to support:

```bash
npm run post:notices -- --guild-id 123
```

Optional later support:

```bash
npm run post:notices -- --all
```

Behavior:

- `--guild-id` posts notices for one configured guild.
- `--all` posts notices for every enabled guild config.
- If neither is provided, fail with a clear usage message.

### 7. Update Environment Docs

Update `.env.example` to separate runtime values from per-guild config.

Keep recommended runtime values:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
DEBUG=false
```

Move guild-specific settings out of the primary `.env` flow and into the upsert script examples.

The implementation should also stop reading global `SPAM_CATCHER_*` fallback values for unknown guilds. Unknown guilds must default to disabled unless a database row exists and is enabled.

### 8. Update README And VPS Setup Guide

Update `README.md` with:

- Multi-guild behavior explanation.
- How to add a guild with `scripts/upsert-guild-config.js`.
- How to list configured guilds.
- How to post trap notices per guild.

Update `setup.md` with:

- Database setup remains unchanged.
- Add one `spam_catcher_config` row per Discord guild.
- Prefer scripts over hand-written SQL for guild config.

## Validation Plan

Run syntax checks:

```bash
npm run check
```

Run DB behavior smoke test:

- Insert config for guild A with trap channel A.
- Insert config for guild B with trap channel B.
- Verify `getSpamCatcherConfig(guildA)` and `getSpamCatcherConfig(guildB)` return different config.
- Verify unknown guild returns `enabled: false`.

Run script checks:

```bash
node scripts/upsert-guild-config.js --help
node scripts/list-guild-configs.js
node scripts/post-notices.js --help
```

If a real test guild is available:

```bash
node scripts/post-notices.js --guild-id YOUR_GUILD_ID
```

## Expected Result

The bot can be invited to multiple Discord servers. It only acts in guilds that have an enabled row in `spam_catcher_config`, and each guild's moderation behavior is isolated by `guild_id`.
