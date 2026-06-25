# Spam Catcher

Standalone Discord Spam Catcher bot extracted from `rosydaqbar/lfg-tool`.

It watches configured trap text channels. When a non-admin user posts in one, it records the event and either times them out, bans them immediately, or schedules a delayed ban with an appeal window.

## Included

- `src/bot/spam-catcher.js`: copied Spam Catcher runtime logic.
- `src/config-store.js`: trimmed Postgres storage for Spam Catcher config, events, and notice messages.
- `scripts/post-notices.js`: posts trap-channel warning notices and stores their message IDs for live count updates.
- `scripts/upsert-guild-config.js`: creates or updates one guild's Spam Catcher config.
- `scripts/list-guild-configs.js`: lists configured guilds.
- `scripts/schema-postgres.sql`: optional SQL schema if you want to create tables manually.
- `/spam-catcher setup`: in-Discord Component V2 setup panel for server admins.

## Not Included

The LFG bot, voice logging, dashboard, landing page, and setup wizard from `lfg-tool` were intentionally not copied.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
cp .env.example .env
```

3. Fill in runtime values in `.env`:

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://spamcatcher:password@127.0.0.1:5432/spam_catcher
PG_SSL_MODE=disable
BOT_POSTGRES_POOL_MAX=2
ALLOWED_GUILD_IDS=
```

Guild IDs, trap channels, review channel, log channel, and moderation behavior are stored in the database per guild, not in `.env`.

4. Invite the bot with these Discord permissions:

- View Channels
- Send Messages
- Read Message History
- Moderate Members, for timeout mode
- Ban Members, for ban modes

5. Add one guild config from Discord:

```text
/spam-catcher setup
```

The setup panel uses Component V2 and lets a server admin select trap channels, review channel, log channel, moderation mode, enable/disable the feature, and post trap notices.

CLI setup is also available:

```bash
npm run config:upsert -- \
  --guild-id YOUR_GUILD_ID \
  --log-channel-id ADMIN_LOG_CHANNEL_ID \
  --review-channel-id ADMIN_REVIEW_CHANNEL_ID \
  --trap-channel-ids TRAP_CHANNEL_ID_1,TRAP_CHANNEL_ID_2 \
  --timeout-minutes 60 \
  --auto-ban false \
  --ban-mode delayed \
  --ban-delay-minutes 10
```

6. Start the bot:

```bash
npm start
```

## Multi-Guild Behavior

The bot can be invited to multiple Discord servers. It only acts in guilds that have an enabled row in `spam_catcher_config`.

- Unknown guilds default to disabled.
- Each guild has independent trap channels, log channel, review channel, timeout settings, ban mode, and webhook notice config.
- Optional `ALLOWED_GUILD_IDS` can restrict the bot to a comma-separated list of guild IDs.

List configured guilds:

```bash
npm run config:list
```

Admins can also manage a guild directly in Discord:

```text
/spam-catcher setup
```

## Trap Notices

To post or refresh the warning notice messages in all configured trap channels:

```bash
npm run post:notices -- --guild-id YOUR_GUILD_ID
```

To post notices for every enabled configured guild:

```bash
npm run post:notices -- --all
```

The script stores notice message IDs in `spam_catcher_notice_messages`; the bot uses those rows to update the caught count after each event.

## Configuration

The bot reads guild config from `spam_catcher_config.config_json`, keyed by `guild_id`.

If a guild has no config row, Spam Catcher is disabled for that guild.

Example JSON for `spam_catcher_config.config_json`:

```json
{
  "enabled": true,
  "channelIds": ["trap_channel_id"],
  "logChannelId": "admin_log_channel_id",
  "timeoutMinutes": 60,
  "autoBanEnabled": false,
  "banMode": "delayed",
  "banDelayMinutes": 10,
  "reviewChannelId": "admin_review_channel_id",
  "webhookEnabled": false,
  "webhookUrls": []
}
```

`banMode` supports `delayed`, `immediate`, and `after_timeout`.

## Database

Tables are auto-created at runtime. You can also run the SQL in `scripts/schema-postgres.sql` manually in Postgres.

For a local PostgreSQL database on your own VPS, follow `setup.md`.

## Behavior Notes

- Discord Administrators are ignored.
- Caught messages are left in the trap channel.
- Caught counts are event counts, not distinct-user counts.
- Delayed bans are checked every 30 seconds while the bot is running.
