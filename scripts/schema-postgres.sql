CREATE TABLE IF NOT EXISTS spam_catcher_config (
  guild_id TEXT PRIMARY KEY,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spam_catcher_events (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'caught',
  timeout_until TIMESTAMPTZ,
  ban_after TIMESTAMPTZ,
  appeal_message TEXT,
  review_channel_id TEXT,
  review_message_id TEXT,
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS spam_catcher_notice_messages (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  delivery_method TEXT NOT NULL DEFAULT 'bot',
  webhook_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_guild_created
  ON spam_catcher_events(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_ban_due
  ON spam_catcher_events(status, ban_after);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_notice_messages_guild
  ON spam_catcher_notice_messages(guild_id);
