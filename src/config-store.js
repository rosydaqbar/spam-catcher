const { Pool } = require('pg');
const { buildPgSslConfig, sanitizePgConnectionString } = require('./lib/pg-ssl');
const { DEFAULT_LANGUAGE, normalizeLanguage } = require('./bot/i18n');

const DATABASE_URL = process.env.DATABASE_URL;
const POSTGRES_POOL_MAX = Number.parseInt(
  process.env.BOT_POSTGRES_POOL_MAX || process.env.POSTGRES_POOL_MAX || '2',
  10
);

const pool = DATABASE_URL
  ? new Pool({
      connectionString: sanitizePgConnectionString(DATABASE_URL),
      ssl: buildPgSslConfig(),
      max: Number.isFinite(POSTGRES_POOL_MAX) && POSTGRES_POOL_MAX > 0
        ? POSTGRES_POOL_MAX
        : 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

if (pool) {
  pool.on('error', (error) => {
    console.warn('[postgres] Idle client error, pool will replace the connection:', error?.message || error);
  });
}

let spamCatcherConfigEnsured = false;
let spamCatcherEventsEnsured = false;
let spamCatcherNoticeMessagesEnsured = false;
let automaticSpamDetectionEnsured = false;

const DEFAULT_SPAM_CATCHER_CONFIG = {
  enabled: false,
  channelIds: [],
  logChannelId: null,
  timeoutMinutes: 60,
  autoBanEnabled: false,
  banMode: 'delayed',
  banDelayMinutes: 10,
  reviewChannelId: null,
  webhookEnabled: false,
  webhookUrl: null,
  webhookUrls: [],
  automaticSpamDetectionEnabled: false,
  attachmentSpamThreshold: 2,
  attachmentSpamWindowSeconds: 600,
  attachmentSpamTimeoutMinutes: 40_320,
  language: DEFAULT_LANGUAGE,
};

function isTransientPostgresError(error) {
  const message = String(error?.message || '').toLowerCase();
  return Boolean(
    error?.code === 'ECONNRESET'
    || error?.code === 'ECONNREFUSED'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'EPIPE'
    || error?.code === '08006'
    || message.includes('connection terminated unexpectedly')
    || message.includes('connection terminated')
    || message.includes('connection timeout')
    || message.includes('econnrefused')
    || message.includes('terminating connection')
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPool() {
  if (!pool) {
    throw new Error('DATABASE_URL is required.');
  }
  return pool;
}

async function query(text, params) {
  const db = await getPool();
  const delays = [250, 1000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await db.query(text, params);
    } catch (error) {
      if (!isTransientPostgresError(error) || attempt >= delays.length) {
        throw error;
      }
      console.warn(
        `[postgres] Transient query failure, retrying in ${delays[attempt]}ms:`,
        error?.message || error
      );
      await wait(delays[attempt]);
    }
  }
  throw new Error('Postgres query failed without an error.');
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeSpamCatcherConfig(value) {
  const source = typeof value === 'string' ? parseJson(value) : value;
  if (!source || typeof source !== 'object') {
    return { ...DEFAULT_SPAM_CATCHER_CONFIG };
  }

  const timeoutMinutes = Number(source.timeoutMinutes);
  const banDelayMinutes = Number(source.banDelayMinutes);
  const attachmentSpamThreshold = Number(source.attachmentSpamThreshold);
  const attachmentSpamWindowSeconds = Number(source.attachmentSpamWindowSeconds);
  const attachmentSpamTimeoutMinutes = Number(source.attachmentSpamTimeoutMinutes);
  const webhookUrls = Array.isArray(source.webhookUrls)
    ? source.webhookUrls
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        channelId: typeof item.channelId === 'string' ? item.channelId.trim() : '',
        webhookUrl: typeof item.webhookUrl === 'string' ? item.webhookUrl.trim() : '',
      }))
      .filter((item) => item.channelId.length > 0 && item.webhookUrl.length > 0)
    : [];
  if (webhookUrls.length === 0 && typeof source.webhookUrl === 'string' && source.webhookUrl.trim().length > 0) {
    const firstChannelId = Array.isArray(source.channelIds) && typeof source.channelIds[0] === 'string'
      ? source.channelIds[0].trim()
      : '';
    if (firstChannelId) webhookUrls.push({ channelId: firstChannelId, webhookUrl: source.webhookUrl.trim() });
  }

  return {
    enabled: source.enabled === true,
    channelIds: Array.isArray(source.channelIds)
      ? [...new Set(source.channelIds
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0))]
      : [],
    logChannelId:
      typeof source.logChannelId === 'string' && source.logChannelId.trim().length > 0
        ? source.logChannelId.trim()
        : null,
    timeoutMinutes: Number.isFinite(timeoutMinutes)
      ? Math.max(1, Math.min(40_320, Math.floor(timeoutMinutes)))
      : DEFAULT_SPAM_CATCHER_CONFIG.timeoutMinutes,
    autoBanEnabled: source.autoBanEnabled === true,
    banMode:
      source.banMode === 'immediate' || source.banMode === 'after_timeout'
        ? source.banMode
        : 'delayed',
    banDelayMinutes: Number.isFinite(banDelayMinutes)
      ? Math.floor(banDelayMinutes) <= 60
        ? Math.max(1, Math.floor(banDelayMinutes))
        : Math.max(2, Math.min(24, Math.floor(banDelayMinutes / 60))) * 60
      : DEFAULT_SPAM_CATCHER_CONFIG.banDelayMinutes,
    reviewChannelId:
      typeof source.reviewChannelId === 'string' && source.reviewChannelId.trim().length > 0
        ? source.reviewChannelId.trim()
        : null,
    webhookEnabled: source.webhookEnabled === true,
    webhookUrl:
      typeof source.webhookUrl === 'string' && source.webhookUrl.trim().length > 0
        ? source.webhookUrl.trim()
        : null,
    webhookUrls,
    automaticSpamDetectionEnabled: source.automaticSpamDetectionEnabled === true,
    attachmentSpamThreshold: Number.isFinite(attachmentSpamThreshold)
      ? Math.max(1, Math.min(10, Math.floor(attachmentSpamThreshold)))
      : DEFAULT_SPAM_CATCHER_CONFIG.attachmentSpamThreshold,
    attachmentSpamWindowSeconds: Number.isFinite(attachmentSpamWindowSeconds)
      ? Math.max(1, Math.min(86_400, Math.floor(attachmentSpamWindowSeconds)))
      : DEFAULT_SPAM_CATCHER_CONFIG.attachmentSpamWindowSeconds,
    attachmentSpamTimeoutMinutes: Number.isFinite(attachmentSpamTimeoutMinutes)
      ? Math.max(1, Math.min(40_320, Math.floor(attachmentSpamTimeoutMinutes)))
      : DEFAULT_SPAM_CATCHER_CONFIG.attachmentSpamTimeoutMinutes,
    language: normalizeLanguage(source.language),
  };
}

async function ensureSpamCatcherConfigTable() {
  if (spamCatcherConfigEnsured) return;
  await query(
    `
      CREATE TABLE IF NOT EXISTS spam_catcher_config (
        guild_id TEXT PRIMARY KEY,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );
  spamCatcherConfigEnsured = true;
}

async function ensureSpamCatcherEventsTable() {
  if (spamCatcherEventsEnsured) return;
  await query(
    `
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
      )
    `
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_guild_created ON spam_catcher_events(guild_id, created_at DESC)'
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_ban_due ON spam_catcher_events(status, ban_after)'
  );
  spamCatcherEventsEnsured = true;
}

async function ensureSpamCatcherNoticeMessagesTable() {
  if (spamCatcherNoticeMessagesEnsured) return;
  await query(
    `
      CREATE TABLE IF NOT EXISTS spam_catcher_notice_messages (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        delivery_method TEXT NOT NULL DEFAULT 'bot',
        webhook_url TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, channel_id)
      )
    `
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_spam_catcher_notice_messages_guild ON spam_catcher_notice_messages(guild_id)'
  );
  spamCatcherNoticeMessagesEnsured = true;
}

async function ensureAutomaticSpamDetectionTables() {
  if (automaticSpamDetectionEnsured) return;
  await query(
    `
      CREATE TABLE IF NOT EXISTS automatic_spam_detection_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        spammer INTEGER NOT NULL DEFAULT 0,
        spammer_count INTEGER NOT NULL DEFAULT 0,
        last_alert_at TIMESTAMPTZ,
        last_danger_at TIMESTAMPTZ,
        last_channel_id TEXT,
        last_message_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, user_id)
      )
    `
  );
  await query(
    `
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
        appeal_message TEXT,
        review_channel_id TEXT,
        review_message_id TEXT,
        decided_by TEXT,
        decision_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS appeal_message TEXT'
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_user_created ON automatic_spam_detection_events(guild_id, user_id, created_at DESC)'
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_review_message ON automatic_spam_detection_events(review_channel_id, review_message_id)'
  );
  automaticSpamDetectionEnsured = true;
}

function mapAutomaticSpamDetectionUser(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    spammer: Number(row.spammer || 0),
    spammerCount: Number(row.spammer_count || 0),
    lastAlertAt: row.last_alert_at ? new Date(row.last_alert_at) : null,
    lastDangerAt: row.last_danger_at ? new Date(row.last_danger_at) : null,
    lastChannelId: row.last_channel_id || null,
    lastMessageId: row.last_message_id || null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

function mapAutomaticSpamDetectionEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    userId: row.user_id,
    sourceChannelId: row.source_channel_id,
    sourceMessageId: row.source_message_id,
    attachmentCount: Number(row.attachment_count || 0),
    reason: row.reason,
    channels: Array.isArray(row.channels_json) ? row.channels_json : parseJson(row.channels_json) || [],
    windowStartedAt: row.window_started_at ? new Date(row.window_started_at) : null,
    windowExpiresAt: row.window_expires_at ? new Date(row.window_expires_at) : null,
    timeoutUntil: row.timeout_until ? new Date(row.timeout_until) : null,
    timeoutStatus: row.timeout_status || 'pending',
    timeoutError: row.timeout_error || null,
    status: row.status || 'danger',
    appealMessage: row.appeal_message || null,
    reviewChannelId: row.review_channel_id || null,
    reviewMessageId: row.review_message_id || null,
    decidedBy: row.decided_by || null,
    decisionError: row.decision_error || null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

function mapSpamCatcherEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    userId: row.user_id,
    channelId: row.channel_id,
    messageId: row.message_id ?? null,
    action: row.action,
    status: row.status,
    timeoutUntil: row.timeout_until ? new Date(row.timeout_until) : null,
    banAfter: row.ban_after ? new Date(row.ban_after) : null,
    appealMessage: row.appeal_message ?? null,
    reviewChannelId: row.review_channel_id ?? null,
    reviewMessageId: row.review_message_id ?? null,
    decidedBy: row.decided_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    bannedAt: row.banned_at ? new Date(row.banned_at) : null,
  };
}

async function getGuildConfig(guildId) {
  const config = await getSpamCatcherConfig(guildId);
  return {
    logChannelId: config.logChannelId || null,
  };
}

async function getSpamCatcherConfig(guildId) {
  await ensureSpamCatcherConfigTable();
  const res = await query(
    'SELECT config_json FROM spam_catcher_config WHERE guild_id = $1',
    [guildId]
  );
  if (!res.rows[0]) return { ...DEFAULT_SPAM_CATCHER_CONFIG };
  return normalizeSpamCatcherConfig(res.rows[0].config_json);
}

async function saveSpamCatcherConfig(guildId, config) {
  await ensureSpamCatcherConfigTable();
  const normalized = normalizeSpamCatcherConfig(config);
  await query(
    `
      INSERT INTO spam_catcher_config (guild_id, config_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT(guild_id) DO UPDATE SET
        config_json = EXCLUDED.config_json,
        updated_at = EXCLUDED.updated_at
    `,
    [guildId, JSON.stringify(normalized)]
  );
  return normalized;
}

async function listSpamCatcherConfigs() {
  await ensureSpamCatcherConfigTable();
  const res = await query(
    `
      SELECT guild_id, config_json, updated_at
      FROM spam_catcher_config
      ORDER BY updated_at DESC, guild_id ASC
    `
  );
  return res.rows.map((row) => ({
    guildId: row.guild_id,
    config: normalizeSpamCatcherConfig(row.config_json),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }));
}

async function createSpamCatcherEvent({
  guildId,
  userId,
  channelId,
  messageId,
  action,
  status,
  timeoutUntil,
  banAfter,
  reviewChannelId,
}) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      INSERT INTO spam_catcher_events (
        guild_id, user_id, channel_id, message_id, action, status,
        timeout_until, ban_after, review_channel_id, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `,
    [
      guildId,
      userId,
      channelId,
      messageId || null,
      action,
      status || 'caught',
      timeoutUntil || null,
      banAfter || null,
      reviewChannelId || null,
    ]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function getSpamCatcherEventById(id) {
  await ensureSpamCatcherEventsTable();
  const res = await query('SELECT * FROM spam_catcher_events WHERE id = $1', [id]);
  return mapSpamCatcherEvent(res.rows[0]);
}

async function updateSpamCatcherEventStatus(id, status, decidedBy = null) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      UPDATE spam_catcher_events
      SET status = $2,
          decided_by = COALESCE($3, decided_by),
          ban_after = CASE WHEN $2 = 'banned' THEN NULL ELSE ban_after END,
          updated_at = NOW(),
          banned_at = CASE WHEN $2 = 'banned' THEN NOW() ELSE banned_at END
      WHERE id = $1
      RETURNING *
    `,
    [id, status, decidedBy]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function markSpamCatcherAppealed(id, appealMessage) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      UPDATE spam_catcher_events
      SET appeal_message = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, appealMessage]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function updateSpamCatcherReviewMessage(id, reviewChannelId, reviewMessageId) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      UPDATE spam_catcher_events
      SET review_channel_id = $2, review_message_id = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, reviewChannelId, reviewMessageId]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function resolveSpamCatcherAppeal(id, decidedBy) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      UPDATE spam_catcher_events
      SET status = 'timeout_removed', ban_after = NULL, decided_by = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, decidedBy]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function getDueSpamCatcherBanEvents(limit = 25) {
  await ensureSpamCatcherEventsTable();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const res = await query(
    `
      SELECT * FROM spam_catcher_events
      WHERE status = 'ban_pending'
        AND ban_after IS NOT NULL
        AND ban_after <= NOW()
      ORDER BY ban_after ASC
      LIMIT $1
    `,
    [safeLimit]
  );
  return res.rows.map(mapSpamCatcherEvent);
}

async function getSpamCatcherCaughtCount(guildId, channelId) {
  await ensureSpamCatcherEventsTable();
  const res = await query(
    `
      SELECT COUNT(id)::bigint AS count
      FROM spam_catcher_events
      WHERE guild_id = $1
        AND channel_id = $2
    `,
    [guildId, channelId]
  );
  return Number(res.rows[0]?.count || 0);
}

async function getSpamCatcherNoticeMessage(guildId, channelId) {
  await ensureSpamCatcherNoticeMessagesTable();
  const res = await query(
    `
      SELECT channel_id, message_id, delivery_method, webhook_url
      FROM spam_catcher_notice_messages
      WHERE guild_id = $1
        AND channel_id = $2
    `,
    [guildId, channelId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    channelId: row.channel_id,
    messageId: row.message_id,
    deliveryMethod: row.delivery_method === 'webhook' ? 'webhook' : 'bot',
    webhookUrl: row.webhook_url || null,
  };
}

async function saveSpamCatcherNoticeMessages(guildId, notices) {
  const validNotices = (Array.isArray(notices) ? notices : []).filter(
    (notice) => notice?.channelId?.trim() && notice?.messageId?.trim()
  );
  if (validNotices.length === 0) return;

  await ensureSpamCatcherNoticeMessagesTable();
  for (const notice of validNotices) {
    await query(
      `
        INSERT INTO spam_catcher_notice_messages (
          guild_id, channel_id, message_id, delivery_method, webhook_url, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT(guild_id, channel_id) DO UPDATE SET
          message_id = EXCLUDED.message_id,
          delivery_method = EXCLUDED.delivery_method,
          webhook_url = EXCLUDED.webhook_url,
          updated_at = EXCLUDED.updated_at
      `,
      [
        guildId,
        notice.channelId,
        notice.messageId,
        notice.deliveryMethod === 'webhook' ? 'webhook' : 'bot',
        notice.webhookUrl || null,
      ]
    );
  }
}

async function recordAutomaticSpamDetectionAlert({ guildId, userId, channelId, messageId, alertAt }) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO automatic_spam_detection_users (
        guild_id, user_id, spammer, spammer_count, last_alert_at,
        last_channel_id, last_message_id, updated_at
      )
      VALUES ($1, $2, 0, 0, $3, $4, $5, NOW())
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        last_alert_at = EXCLUDED.last_alert_at,
        last_channel_id = EXCLUDED.last_channel_id,
        last_message_id = EXCLUDED.last_message_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [guildId, userId, alertAt || new Date(), channelId, messageId || null]
  );
  return mapAutomaticSpamDetectionUser(res.rows[0]);
}

async function markAutomaticSpamDetectionDangerUser({ guildId, userId, channelId, messageId, dangerAt }) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO automatic_spam_detection_users (
        guild_id, user_id, spammer, spammer_count, last_danger_at,
        last_channel_id, last_message_id, updated_at
      )
      VALUES ($1, $2, 1, 1, $3, $4, $5, NOW())
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        spammer = 1,
        spammer_count = automatic_spam_detection_users.spammer_count + 1,
        last_danger_at = EXCLUDED.last_danger_at,
        last_channel_id = EXCLUDED.last_channel_id,
        last_message_id = EXCLUDED.last_message_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [guildId, userId, dangerAt || new Date(), channelId, messageId || null]
  );
  return mapAutomaticSpamDetectionUser(res.rows[0]);
}

async function resetAutomaticSpamDetectionSpammer(guildId, userId) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_users
      SET spammer = 0, updated_at = NOW()
      WHERE guild_id = $1 AND user_id = $2
      RETURNING *
    `,
    [guildId, userId]
  );
  return mapAutomaticSpamDetectionUser(res.rows[0]);
}

async function getAutomaticSpamDetectionUser(guildId, userId) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    'SELECT * FROM automatic_spam_detection_users WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId]
  );
  return mapAutomaticSpamDetectionUser(res.rows[0]);
}

async function createAutomaticSpamDetectionEvent({
  guildId,
  userId,
  sourceChannelId,
  sourceMessageId,
  attachmentCount,
  reason,
  channels,
  windowStartedAt,
  windowExpiresAt,
}) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO automatic_spam_detection_events (
        guild_id, user_id, source_channel_id, source_message_id,
        attachment_count, reason, channels_json, window_started_at,
        window_expires_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())
      RETURNING *
    `,
    [
      guildId,
      userId,
      sourceChannelId,
      sourceMessageId,
      Number(attachmentCount) || 0,
      reason,
      JSON.stringify(Array.isArray(channels) ? channels : []),
      windowStartedAt,
      windowExpiresAt,
    ]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function getAutomaticSpamDetectionEventById(id) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query('SELECT * FROM automatic_spam_detection_events WHERE id = $1', [id]);
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function updateAutomaticSpamDetectionTimeout(id, { timeoutUntil, timeoutStatus, timeoutError }) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_events
      SET timeout_until = $2,
          timeout_status = $3,
          timeout_error = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, timeoutUntil || null, timeoutStatus || 'pending', timeoutError || null]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function updateAutomaticSpamDetectionReviewMessage(id, reviewChannelId, reviewMessageId) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_events
      SET review_channel_id = $2,
          review_message_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, reviewChannelId || null, reviewMessageId || null]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function updateAutomaticSpamDetectionDecision(id, status, decidedBy, decisionError = null) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_events
      SET status = $2,
          decided_by = $3,
          decision_error = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, status, decidedBy || null, decisionError || null]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function markAutomaticSpamDetectionAppealed(id, appealMessage) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_events
      SET appeal_message = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, appealMessage]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function close() {
  if (pool) {
    await pool.end();
  }
}

module.exports = {
  DEFAULT_SPAM_CATCHER_CONFIG,
  normalizeSpamCatcherConfig,
  getGuildConfig,
  getSpamCatcherConfig,
  saveSpamCatcherConfig,
  listSpamCatcherConfigs,
  createSpamCatcherEvent,
  getSpamCatcherEventById,
  updateSpamCatcherEventStatus,
  markSpamCatcherAppealed,
  updateSpamCatcherReviewMessage,
  resolveSpamCatcherAppeal,
  getDueSpamCatcherBanEvents,
  getSpamCatcherCaughtCount,
  getSpamCatcherNoticeMessage,
  saveSpamCatcherNoticeMessages,
  recordAutomaticSpamDetectionAlert,
  markAutomaticSpamDetectionDangerUser,
  resetAutomaticSpamDetectionSpammer,
  getAutomaticSpamDetectionUser,
  createAutomaticSpamDetectionEvent,
  getAutomaticSpamDetectionEventById,
  updateAutomaticSpamDetectionTimeout,
  updateAutomaticSpamDetectionReviewMessage,
  updateAutomaticSpamDetectionDecision,
  markAutomaticSpamDetectionAppealed,
  close,
};
