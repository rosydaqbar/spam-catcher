const { Pool } = require('pg');
const { buildPgSslConfig, sanitizePgConnectionString } = require('./lib/pg-ssl');

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

const DEFAULT_SPAM_CATCHER_CONFIG = {
  enabled: false,
  channelIds: [],
  timeoutMinutes: 60,
  autoBanEnabled: false,
  banMode: 'delayed',
  banDelayMinutes: 10,
  reviewChannelId: null,
  webhookEnabled: false,
  webhookUrl: null,
  webhookUrls: [],
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

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

function envSpamCatcherConfig() {
  const webhookUrls = parseJson(process.env.SPAM_CATCHER_WEBHOOK_URLS);
  return normalizeSpamCatcherConfig({
    enabled: parseBoolean(process.env.SPAM_CATCHER_ENABLED, false),
    channelIds: parseList(process.env.SPAM_CATCHER_CHANNEL_IDS),
    timeoutMinutes: Number(process.env.SPAM_CATCHER_TIMEOUT_MINUTES || DEFAULT_SPAM_CATCHER_CONFIG.timeoutMinutes),
    autoBanEnabled: parseBoolean(process.env.SPAM_CATCHER_AUTO_BAN_ENABLED, false),
    banMode: process.env.SPAM_CATCHER_BAN_MODE || DEFAULT_SPAM_CATCHER_CONFIG.banMode,
    banDelayMinutes: Number(process.env.SPAM_CATCHER_BAN_DELAY_MINUTES || DEFAULT_SPAM_CATCHER_CONFIG.banDelayMinutes),
    reviewChannelId: process.env.SPAM_CATCHER_REVIEW_CHANNEL_ID || null,
    webhookEnabled: parseBoolean(process.env.SPAM_CATCHER_WEBHOOK_ENABLED, false),
    webhookUrl: process.env.SPAM_CATCHER_WEBHOOK_URL || null,
    webhookUrls: Array.isArray(webhookUrls) ? webhookUrls : [],
  });
}

function normalizeSpamCatcherConfig(value) {
  const source = typeof value === 'string' ? parseJson(value) : value;
  if (!source || typeof source !== 'object') {
    return { ...DEFAULT_SPAM_CATCHER_CONFIG };
  }

  const timeoutMinutes = Number(source.timeoutMinutes);
  const banDelayMinutes = Number(source.banDelayMinutes);
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

async function getGuildConfig() {
  return {
    logChannelId: process.env.LOG_CHANNEL_ID || null,
  };
}

async function getSpamCatcherConfig(guildId) {
  await ensureSpamCatcherConfigTable();
  const res = await query(
    'SELECT config_json FROM spam_catcher_config WHERE guild_id = $1',
    [guildId]
  );
  if (!res.rows[0]) return envSpamCatcherConfig();
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
  close,
};
