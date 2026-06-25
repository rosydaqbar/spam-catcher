# Spam Catcher

Standalone Discord Spam Catcher bot extracted from `rosydaqbar/lfg-tool`.

It watches configured trap text channels. When a non-admin user posts in one, it records the event and either times them out, bans them immediately, or schedules a delayed ban with an appeal window.

## Included

- `src/bot/spam-catcher.js`: copied Spam Catcher runtime logic.
- `src/config-store.js`: trimmed Postgres storage for Spam Catcher config, events, and notice messages.
- `scripts/post-notices.js`: posts trap-channel warning notices and stores their message IDs for live count updates.
- `scripts/schema-postgres.sql`: optional SQL schema if you want to create tables manually.

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

3. Fill in `DISCORD_TOKEN`, `DATABASE_URL`, `DISCORD_GUILD_ID`, `LOG_CHANNEL_ID`, and the `SPAM_CATCHER_*` values.

4. Invite the bot with these Discord permissions:

- View Channels
- Send Messages
- Read Message History
- Moderate Members, for timeout mode
- Ban Members, for ban modes

5. Start the bot:

```bash
npm start
```

## Trap Notices

To post or refresh the warning notice messages in all configured trap channels:

```bash
npm run post:notices
```

The script stores notice message IDs in `spam_catcher_notice_messages`; the bot uses those rows to update the caught count after each event.

## Configuration

The bot reads config in this order:

1. `spam_catcher_config.config_json` row for the guild, if present.
2. Environment variables in `.env`.

Example JSON for `spam_catcher_config.config_json`:

```json
{
  "enabled": true,
  "channelIds": ["trap_channel_id"],
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
