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

CREATE TABLE IF NOT EXISTS automatic_spam_detection_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  spammer INTEGER NOT NULL DEFAULT 0,
  spammer_count INTEGER NOT NULL DEFAULT 0,
  last_alert_at TIMESTAMPTZ,
  last_alert_window_expires_at TIMESTAMPTZ,
  last_alert_protected BOOLEAN NOT NULL DEFAULT FALSE,
  last_danger_at TIMESTAMPTZ,
  last_channel_id TEXT,
  last_message_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS automatic_spam_detection_events (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  attachment_count INTEGER NOT NULL,
  reason TEXT NOT NULL,
  channels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_expires_at TIMESTAMPTZ NOT NULL,
  timeout_until TIMESTAMPTZ,
  timeout_status TEXT NOT NULL DEFAULT 'pending',
  timeout_error TEXT,
  status TEXT NOT NULL DEFAULT 'danger',
  window_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  danger_confirmed_at TIMESTAMPTZ,
  followup_message_count INTEGER NOT NULL DEFAULT 0,
  followup_attachment_count INTEGER NOT NULL DEFAULT 0,
  last_followup_at TIMESTAMPTZ,
  last_followup_channel_id TEXT,
  last_followup_message_id TEXT,
  last_followup_attachment_count INTEGER,
  appeal_message TEXT,
  ai_vision_status TEXT,
  ai_vision_model TEXT,
  ai_vision_image_url TEXT,
  ai_vision_confidence DOUBLE PRECISION,
  ai_vision_caption TEXT,
  ai_vision_ocr_text TEXT,
  ai_vision_matched_words_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_vision_error TEXT,
  ai_vision_checked_at TIMESTAMPTZ,
  review_channel_id TEXT,
  review_message_id TEXT,
  decided_by TEXT,
  decision_error TEXT,
  evidence_deleted_by TEXT,
  evidence_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automatic_spam_detection_ai_usage (
  guild_id TEXT NOT NULL,
  usage_date DATE NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, usage_date)
);

CREATE TABLE IF NOT EXISTS automatic_spam_detection_ai_usage_reservations (
  event_id BIGINT PRIMARY KEY REFERENCES automatic_spam_detection_events(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  usage_date DATE NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  used_count_after INTEGER NOT NULL DEFAULT 0,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  closed_by_reset BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE automatic_spam_detection_users
  ADD COLUMN IF NOT EXISTS last_alert_protected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE automatic_spam_detection_events
  ADD COLUMN IF NOT EXISTS evidence_deleted_by TEXT;

ALTER TABLE automatic_spam_detection_events
  ADD COLUMN IF NOT EXISTS evidence_deleted_at TIMESTAMPTZ;

ALTER TABLE automatic_spam_detection_ai_usage_reservations
  ADD COLUMN IF NOT EXISTS closed_by_reset BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS ai_vision_daily_limit_bypass_guilds (
  guild_id TEXT PRIMARY KEY,
  bypassed BOOLEAN NOT NULL DEFAULT TRUE,
  added_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_vision_daily_limit_bypass_guilds
  ADD COLUMN IF NOT EXISTS bypassed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS automatic_spam_detection_event_messages (
  event_id BIGINT NOT NULL REFERENCES automatic_spam_detection_events(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  attachment_count INTEGER NOT NULL,
  message_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, message_id)
);

CREATE TABLE IF NOT EXISTS automatic_spam_detection_evidence_messages (
  event_id BIGINT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, message_id)
);

ALTER TABLE automatic_spam_detection_evidence_messages
  ADD COLUMN IF NOT EXISTS protected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE automatic_spam_detection_evidence_messages
  DROP CONSTRAINT IF EXISTS automatic_spam_detection_evidence_messages_event_id_fkey;

CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_guild_created
  ON spam_catcher_events(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_ban_due
  ON spam_catcher_events(status, ban_after);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_guild_user
  ON spam_catcher_events(guild_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spam_catcher_notice_messages_guild
  ON spam_catcher_notice_messages(guild_id);

CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_user_created
  ON automatic_spam_detection_events(guild_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_review_message
  ON automatic_spam_detection_events(review_channel_id, review_message_id);

CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_evidence_messages_event
  ON automatic_spam_detection_evidence_messages(event_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_window
  ON automatic_spam_detection_events(guild_id, user_id, window_expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_status_window
  ON automatic_spam_detection_events(status, guild_id, user_id, window_started_at, window_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_window_claim
  ON automatic_spam_detection_events(guild_id, user_id, window_started_at)
  WHERE window_claimed = TRUE;
