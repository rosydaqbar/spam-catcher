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

const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_AI_VISION_DAILY_LIMIT = 3;

const DEFAULT_AI_VISION_TRIGGER_WORDS = [
  'free nitro',
  'free discord nitro',
  'steam gift',
  'steam gift card',
  'seed phrase',
  'recovery phrase',
  'connect wallet',
  'connect wallet to claim',
  'wallet connect reward',
  'claim reward',
  'claim your reward',
  'how to claim your reward receive your $2,500 bonus',
  'receive your $2500 bonus',
  'verify wallet',
  'wallet verification',
  'validate wallet',
  'crypto giveaway',
  'limited reward',
  'double your money',
  'guaranteed crypto profit',
  'crypto signal group',
  'crypto casino',
  'cryptocurrency casino',
  'own cryptocurrency casino',
  'claim airdrop',
  'free airdrop reward',
  'airdrop claim page',
  'mint claim page',
  'free mint now',
  'whitelist spot',
  'claim free token',
  'seed phrase required',
  'recovery phrase required',
  'private key required',
  'vyro project',
  'vyro',
  'giving away $2,500',
  'giving away $2500',
  '$2,500 to everyone',
  '$2500 to everyone',
  'everyone who registers',
  'everyone who registers bonus',
  'withdraw the bonus immediately',
  'bonus immediately',
  'this post will be deleted',
  'deleted an hour after publication',
  'only the fastest people',
  'promotion will last',
  "don't miss your chance",
  'dont miss your chance',
  'launch new rates',
  'kasowin advertising',
  'activate code for bonus',
  'activate promo code',
  'exclusive reward',
  'offer is limited',
  'withdrawal success',
  'withdrawal success USDC',
  'withdrawal of $2700',
  'withdrawal of $2,700',
  'withdrawal of $2,700 receive your $2,500 bonus',
  'mrbeast casino',
  'mr beast casino',
  'beast casino',
  'mrbeast slots',
  'mrbeast jackpot',
  'mrbeast reward',
  'mrbeast giveaway',
  'beast rewards',
  'mrbeast kasowin',
  'mrbeast promo code',
  'mrbeast crypto giveaway',
  'mrbeast free money',
  'mrbeast $2500',
  'kasowin bonus',
  'kasowin withdraw',
  'crypto casino bonus',
  'promo code withdraw',
  'deleted an hour bonus',
  '@everyone free nitro',
  '@here free nitro',
  '@everyone casino',
  '@here casino',
  '@everyone you won',
  '@here you won',
  '@everyone claim nitro',
  '@here claim nitro',
  '@everyone scan qr',
  '@here scan qr',
  'discord nitro free',
  'nitro gift link',
  'claim nitro gift',
  'redeem nitro gift',
  'nitro giveaway link',
  'nitro boost reward',
  'free server boost',
  'steam nitro gift',
  'discord gift redeem',
  'scan to claim nitro',
  'scan to verify discord',
  'scan qr to claim',
  'scan qr to verify',
  'qr nitro gift',
  'qr discord login',
  'discord qr login',
  'mobile login qr',
  'login to verify discord',
  'verify your discord account',
  'verify discord to access',
  'server verification required',
  'anti raid verification required',
  'age verification required',
  'verify or get kicked',
  'verify before ban',
  'connect discord account',
  'link your discord account',
  'accidentally reported you',
  'i reported you by mistake',
  'false report on your account',
  'mistaken report on your account',
  'your account is under investigation',
  'your account will be banned',
  'contact discord admin',
  'contact discord staff',
  'message this discord admin',
  'ban appeal required',
  'tos violation warning',
  'account suspension warning',
  'test my game',
  'try my game',
  'download my game',
  'game beta test',
  'private game build',
  'new game launcher',
  'download this game build',
  'can you test my game',
  'nitro generator',
  'free nitro generator',
  'discord token grabber',
  'token grabber',
  'paste this in console',
  'open developer console',
  'copy this script',
  'run this script',
  'paste code here',
  'inspect element discord',
  'local storage token',
  'discord token',
  'auth token',
  'session token',
  'authorize this bot',
  'authorize bot admin',
  'give bot admin',
  'administrator permission required',
  'manage server permission',
  'manage roles permission',
  'manage webhooks permission',
  'add verification bot',
  'add security bot',
  'anti raid bot required',
  'free moderation bot',
  'official nitro announcement',
  'official giveaway announcement',
  'server reward announcement',
  'discord security update',
  'urgent security update',
  'free reward announcement',
  'limited reward announcement',
  'fake server announcement',
  'webhook announcement',
  'free onlyfans leak',
  'leaked nudes',
  'nude leak',
  'private video leak',
  'your photos leaked',
  'i have your nudes',
  'i will leak your photos',
  'pay or leak',
  'send money or leak',
  'expose your photos',
  'webcam recording proof',
  'doxx your family',
  'trusted middleman',
  'fake middleman',
  'escrow server',
  'send first trade',
  'trade first',
  'fake payment proof',
  'cheap discord account',
  'buy discord account',
  'sell discord account',
  'lifetime nitro',
  'cheap nitro seller',
  'gift card payment',
  'steam card payment',
  'paid moderator job',
  'discord mod job',
  'staff application reward',
  'fake partnership offer',
  'server partnership offer',
  'sponsorship offer discord',
  'brand deal discord',
  'paid collab offer',
  'easy remote job discord',
];

const DEFAULT_SPAM_CATCHER_CONFIG = {
  enabled: false,
  requiredChannelsSet: 0,
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
  aiVisionSpamCheckEnabled: false,
  aiVisionConfidenceThreshold: 0.7,
  aiVisionDailyLimit: DEFAULT_AI_VISION_DAILY_LIMIT,
  aiVisionTriggerWords: DEFAULT_AI_VISION_TRIGGER_WORDS,
  timezone: DEFAULT_TIMEZONE,
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

async function runTransactionWithRetry(label, work) {
  const db = await getPool();
  const delays = [250, 1000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    let client;
    let commitStarted = false;
    try {
      client = await db.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await work(client);
      commitStarted = true;
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => null);
        client.release(isTransientPostgresError(error) ? error : undefined);
      }
      if (commitStarted || !isTransientPostgresError(error) || attempt >= delays.length) throw error;
      console.warn(
        `[postgres] Transient ${label} failure, retrying in ${delays[attempt]}ms:`,
        error?.message || error
      );
      await wait(delays[attempt]);
    }
  }
  throw new Error(`${label} failed without an error.`);
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
  const aiVisionConfidenceThreshold = Number(source.aiVisionConfidenceThreshold);
  const aiVisionDailyLimit = Number(source.aiVisionDailyLimit);
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
    requiredChannelsSet: !Object.prototype.hasOwnProperty.call(source, 'requiredChannelsSet')
      || source.requiredChannelsSet === null
      ? null
      : source.requiredChannelsSet === true || source.requiredChannelsSet === 1 ? 1 : 0,
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
    aiVisionSpamCheckEnabled: source.aiVisionSpamCheckEnabled === true,
    aiVisionConfidenceThreshold: Number.isFinite(aiVisionConfidenceThreshold)
      ? Math.max(0, Math.min(1, aiVisionConfidenceThreshold))
      : DEFAULT_SPAM_CATCHER_CONFIG.aiVisionConfidenceThreshold,
    aiVisionDailyLimit: Number.isFinite(aiVisionDailyLimit)
      ? Math.max(0, Math.min(10_000, Math.floor(aiVisionDailyLimit)))
      : DEFAULT_SPAM_CATCHER_CONFIG.aiVisionDailyLimit,
    aiVisionTriggerWords: normalizeAiVisionTriggerWords(source.aiVisionTriggerWords),
    timezone: normalizeTimezone(source.timezone),
    language: normalizeLanguage(source.language),
  };
}

function normalizeTimezone(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function normalizeAiVisionTriggerWords(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : DEFAULT_AI_VISION_TRIGGER_WORDS;
  const normalized = items
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((item) => item.length > 0 && item.length <= 100);
  const unique = [...new Set(normalized)].slice(0, 100);
  return unique.length > 0 ? unique : [...DEFAULT_AI_VISION_TRIGGER_WORDS];
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
  await query(
    'CREATE INDEX IF NOT EXISTS idx_spam_catcher_events_guild_user ON spam_catcher_events(guild_id, user_id, created_at DESC)'
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
        last_alert_window_expires_at TIMESTAMPTZ,
        last_alert_protected BOOLEAN NOT NULL DEFAULT FALSE,
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
        moderation_action TEXT NOT NULL DEFAULT 'timeout',
        ban_status TEXT NOT NULL DEFAULT 'none',
        ban_after TIMESTAMPTZ,
        banned_at TIMESTAMPTZ,
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
        review_channel_id TEXT,
        review_message_id TEXT,
        decided_by TEXT,
        decision_error TEXT,
        evidence_deleted_by TEXT,
        evidence_deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS appeal_message TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_users ADD COLUMN IF NOT EXISTS last_alert_window_expires_at TIMESTAMPTZ'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_users ADD COLUMN IF NOT EXISTS last_alert_protected BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS window_claimed BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS danger_confirmed_at TIMESTAMPTZ'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS followup_message_count INTEGER NOT NULL DEFAULT 0'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS followup_attachment_count INTEGER NOT NULL DEFAULT 0'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS last_followup_channel_id TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS last_followup_message_id TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS last_followup_attachment_count INTEGER'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_status TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_model TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_image_url TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_confidence DOUBLE PRECISION'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_caption TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_ocr_text TEXT'
  );
  await query(
    "ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_matched_words_json JSONB NOT NULL DEFAULT '[]'::jsonb"
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_error TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ai_vision_checked_at TIMESTAMPTZ'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS evidence_deleted_by TEXT'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS evidence_deleted_at TIMESTAMPTZ'
  );
  await query(
    "ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS moderation_action TEXT NOT NULL DEFAULT 'timeout'"
  );
  await query(
    "ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ban_status TEXT NOT NULL DEFAULT 'none'"
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS ban_after TIMESTAMPTZ'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_events ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ'
  );
  await query(
    `
      UPDATE automatic_spam_detection_events
      SET ban_status = CASE
            WHEN status = 'banned' THEN 'banned'
            WHEN status = 'ban_failed' THEN 'failed'
            ELSE ban_status
          END,
          banned_at = CASE
            WHEN status = 'banned' THEN COALESCE(banned_at, updated_at)
            ELSE banned_at
          END
      WHERE ban_status = 'none'
        AND status IN ('banned', 'ban_failed')
    `
  );
  await query(
    `
      CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_window
      ON automatic_spam_detection_events(guild_id, user_id, window_expires_at DESC)
    `
  );
  await query(
    `
      CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_status_window
      ON automatic_spam_detection_events(status, guild_id, user_id, window_started_at, window_expires_at)
    `
  );
  await query(
    `
      UPDATE automatic_spam_detection_users AS users
      SET last_alert_window_expires_at = CASE
            WHEN users.last_alert_window_expires_at IS NULL
              OR users.last_alert_window_expires_at > resolved.closed_before
              THEN resolved.closed_before
            ELSE users.last_alert_window_expires_at
          END,
          updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (source_user.guild_id, source_user.user_id)
          source_user.guild_id,
          source_user.user_id,
          resolved_event.updated_at - INTERVAL '1 millisecond' AS closed_before
        FROM automatic_spam_detection_users AS source_user
        JOIN automatic_spam_detection_events AS resolved_event
          ON resolved_event.guild_id = source_user.guild_id
          AND resolved_event.user_id = source_user.user_id
          AND source_user.last_alert_at >= resolved_event.window_started_at
          AND source_user.last_alert_at <= resolved_event.window_expires_at
        WHERE resolved_event.status IN ('timeout_removed', 'user_unavailable', 'banned')
        ORDER BY source_user.guild_id, source_user.user_id, resolved_event.updated_at DESC, resolved_event.id DESC
      ) AS resolved
      WHERE users.guild_id = resolved.guild_id
        AND users.user_id = resolved.user_id
        AND (
          users.last_alert_window_expires_at IS NULL
          OR users.last_alert_window_expires_at > resolved.closed_before
        )
    `
  );
  await query(
    `
      UPDATE automatic_spam_detection_events AS event
      SET window_expires_at = LEAST(event.window_expires_at, closure.closed_before)
      FROM (
        SELECT
          candidate.id,
          MIN(resolved.updated_at - INTERVAL '1 millisecond') AS closed_before
        FROM automatic_spam_detection_events AS candidate
        JOIN automatic_spam_detection_events AS resolved
          ON resolved.guild_id = candidate.guild_id
          AND resolved.user_id = candidate.user_id
          AND candidate.window_started_at <= resolved.window_expires_at
          AND candidate.window_expires_at >= resolved.window_started_at
          AND candidate.window_expires_at > resolved.updated_at - INTERVAL '1 millisecond'
        WHERE resolved.status IN ('timeout_removed', 'user_unavailable', 'banned')
        GROUP BY candidate.id
      ) AS closure
      WHERE event.id = closure.id
        AND event.window_expires_at > closure.closed_before
    `
  );
  await query(
    `
      UPDATE automatic_spam_detection_events
      SET danger_confirmed_at = COALESCE(ai_vision_checked_at, created_at)
      WHERE danger_confirmed_at IS NULL
        AND status IN ('danger', 'banned', 'timeout_removed', 'user_unavailable', 'ban_failed', 'timeout_remove_failed')
        AND (ai_vision_status IS NULL OR ai_vision_status = 'matched')
    `
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_user_created ON automatic_spam_detection_events(guild_id, user_id, created_at DESC)'
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_review_message ON automatic_spam_detection_events(review_channel_id, review_message_id)'
  );
  await query(
    'CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_ban_due ON automatic_spam_detection_events(ban_status, ban_after)'
  );
  await query(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_automatic_spam_detection_events_window_claim
      ON automatic_spam_detection_events(guild_id, user_id, window_started_at)
      WHERE window_claimed = TRUE
    `
  );
  await query(
    `
      CREATE TABLE IF NOT EXISTS automatic_spam_detection_event_messages (
        event_id BIGINT NOT NULL REFERENCES automatic_spam_detection_events(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        attachment_count INTEGER NOT NULL,
        message_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (event_id, message_id)
      )
    `
  );
  await query(
    `
      CREATE TABLE IF NOT EXISTS automatic_spam_detection_ai_usage (
        guild_id TEXT NOT NULL,
        usage_date DATE NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, usage_date)
      )
    `
  );
  await query(
    `
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
      )
    `
  );
  await query(
    `
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
      )
    `
  );
  await query(
    'ALTER TABLE automatic_spam_detection_evidence_messages ADD COLUMN IF NOT EXISTS protected BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await query(
    'ALTER TABLE automatic_spam_detection_evidence_messages DROP CONSTRAINT IF EXISTS automatic_spam_detection_evidence_messages_event_id_fkey'
  );
  await query(
    `
      CREATE INDEX IF NOT EXISTS idx_automatic_spam_detection_evidence_messages_event
      ON automatic_spam_detection_evidence_messages(event_id, created_at ASC)
    `
  );
  await query(
    'ALTER TABLE automatic_spam_detection_ai_usage_reservations ADD COLUMN IF NOT EXISTS closed_by_reset BOOLEAN NOT NULL DEFAULT FALSE'
  );
  await query(
    `
      CREATE TABLE IF NOT EXISTS ai_vision_daily_limit_bypass_guilds (
        guild_id TEXT PRIMARY KEY,
        bypassed BOOLEAN NOT NULL DEFAULT TRUE,
        added_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  );
  await query(
    'ALTER TABLE ai_vision_daily_limit_bypass_guilds ADD COLUMN IF NOT EXISTS bypassed BOOLEAN NOT NULL DEFAULT TRUE'
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
    lastAlertWindowExpiresAt: row.last_alert_window_expires_at ? new Date(row.last_alert_window_expires_at) : null,
    lastAlertProtected: row.last_alert_protected === true,
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
    moderationAction: row.moderation_action || 'timeout',
    banStatus: row.ban_status || 'none',
    banAfter: row.ban_after ? new Date(row.ban_after) : null,
    bannedAt: row.banned_at ? new Date(row.banned_at) : null,
    status: row.status || 'danger',
    windowClaimed: row.window_claimed === true,
    dangerConfirmedAt: row.danger_confirmed_at ? new Date(row.danger_confirmed_at) : null,
    followupMessageCount: Number(row.followup_message_count || 0),
    followupAttachmentCount: Number(row.followup_attachment_count || 0),
    lastFollowupAt: row.last_followup_at ? new Date(row.last_followup_at) : null,
    lastFollowupChannelId: row.last_followup_channel_id || null,
    lastFollowupMessageId: row.last_followup_message_id || null,
    lastFollowupAttachmentCount: row.last_followup_attachment_count === null || row.last_followup_attachment_count === undefined
      ? null
      : Number(row.last_followup_attachment_count),
    appealMessage: row.appeal_message || null,
    aiVisionStatus: row.ai_vision_status || null,
    aiVisionModel: row.ai_vision_model || null,
    aiVisionImageUrl: row.ai_vision_image_url || null,
    aiVisionConfidence: row.ai_vision_confidence === null || row.ai_vision_confidence === undefined
      ? null
      : Number(row.ai_vision_confidence),
    aiVisionCaption: row.ai_vision_caption || null,
    aiVisionOcrText: row.ai_vision_ocr_text || null,
    aiVisionMatchedWords: Array.isArray(row.ai_vision_matched_words_json)
      ? row.ai_vision_matched_words_json
      : parseJson(row.ai_vision_matched_words_json) || [],
    aiVisionError: row.ai_vision_error || null,
    aiVisionCheckedAt: row.ai_vision_checked_at ? new Date(row.ai_vision_checked_at) : null,
    reviewChannelId: row.review_channel_id || null,
    reviewMessageId: row.review_message_id || null,
    decidedBy: row.decided_by || null,
    decisionError: row.decision_error || null,
    evidenceDeletedBy: row.evidence_deleted_by || null,
    evidenceDeletedAt: row.evidence_deleted_at ? new Date(row.evidence_deleted_at) : null,
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

async function withGuildConfigLock(guildId, work) {
  await ensureSpamCatcherConfigTable();
  const db = await getPool();
  const client = await db.connect();
  let locked = false;
  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtextextended($1, 0))',
      [`guild-config:${guildId}`]
    );
    locked = true;
    const res = await client.query(
      'SELECT config_json FROM spam_catcher_config WHERE guild_id = $1',
      [guildId]
    );
    const config = res.rows[0]
      ? normalizeSpamCatcherConfig(res.rows[0].config_json)
      : { ...DEFAULT_SPAM_CATCHER_CONFIG };
    return await work(config, client);
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [`guild-config:${guildId}`]
      ).catch(() => null);
    }
    client.release();
  }
}

async function withAutomaticSpamDetectionEventLock(eventId, work) {
  await ensureAutomaticSpamDetectionTables();
  const db = await getPool();
  const client = await db.connect();
  let locked = false;
  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtextextended($1, 0))',
      [`automatic-spam-event:${eventId}`]
    );
    locked = true;
    return await work(client);
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [`automatic-spam-event:${eventId}`]
      ).catch(() => null);
    }
    client.release();
  }
}

async function saveSpamCatcherConfig(guildId, config, dbClient = null) {
  await ensureSpamCatcherConfigTable();
  const normalized = normalizeSpamCatcherConfig(config);
  const save = async (client) => {
    await client.query(
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
  };
  if (dbClient) return save(dbClient);
  return withGuildConfigLock(guildId, async (_current, client) => save(client));
}

async function setGuildAiVisionDailyLimit(guildId, limit) {
  await ensureSpamCatcherConfigTable();
  const safeLimit = Math.max(0, Math.min(10_000, Math.floor(Number(limit) || 0)));
  return withGuildConfigLock(guildId, async (_current, client) => {
    const res = await client.query(
      `
        INSERT INTO spam_catcher_config (guild_id, config_json, updated_at)
        VALUES ($1, jsonb_build_object('aiVisionDailyLimit', $2::integer), NOW())
        ON CONFLICT(guild_id) DO UPDATE SET
          config_json = jsonb_set(
            COALESCE(spam_catcher_config.config_json, '{}'::jsonb),
            '{aiVisionDailyLimit}',
            to_jsonb($2::integer),
            TRUE
          ),
          updated_at = NOW()
        RETURNING config_json
      `,
      [guildId, safeLimit]
    );
    return normalizeSpamCatcherConfig(res.rows[0]?.config_json);
  });
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
          ban_after = CASE
            WHEN $2 IN ('banned', 'ban_failed', 'timeout_failed', 'timeout_removed', 'admin_reset') THEN NULL
            ELSE ban_after
          END,
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

async function scheduleSpamCatcherBan(id, banAfter) {
  await ensureSpamCatcherEventsTable();
  const scheduledAt = new Date(banAfter);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new TypeError('A valid Spam Catcher ban schedule is required.');
  }
  const res = await query(
    `
      UPDATE spam_catcher_events
      SET status = 'ban_pending',
          ban_after = $2,
          timeout_until = CASE
            WHEN action = 'ban_after_timeout' THEN $2
            ELSE timeout_until
          END,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'timed_out'
        AND action IN ('ban_delayed', 'ban_after_timeout')
        AND ban_after IS NULL
      RETURNING *
    `,
    [id, scheduledAt]
  );
  return mapSpamCatcherEvent(res.rows[0]);
}

async function cancelPendingSpamCatcherBans(guildId, dbClient = null) {
  await ensureSpamCatcherEventsTable();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE spam_catcher_events
      SET status = 'timed_out',
          ban_after = NULL,
          updated_at = NOW()
      WHERE guild_id = $1
        AND status = 'ban_pending'
    `,
    [guildId]
  );
  return res.rowCount;
}

async function cancelPendingAutomaticSpamDetectionBans(guildId, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE automatic_spam_detection_events
      SET ban_status = 'cancelled',
          ban_after = NULL,
          updated_at = NOW()
      WHERE guild_id = $1
        AND ban_status = 'pending'
    `,
    [guildId]
  );
  return res.rowCount;
}

async function resetSpamCatcherSetup(guildId) {
  await ensureSpamCatcherConfigTable();
  await ensureSpamCatcherEventsTable();
  await ensureAutomaticSpamDetectionTables();
  const config = normalizeSpamCatcherConfig(DEFAULT_SPAM_CATCHER_CONFIG);

  return runTransactionWithRetry('Spam Catcher setup reset', async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`guild-config:${guildId}`]
    );
    await client.query(
      `
        INSERT INTO spam_catcher_config (guild_id, config_json, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT(guild_id) DO UPDATE SET
          config_json = EXCLUDED.config_json,
          updated_at = EXCLUDED.updated_at
      `,
      [guildId, JSON.stringify(config)]
    );
    await client.query(
      `
        UPDATE automatic_spam_detection_users
        SET spammer = 0,
            last_alert_at = NULL,
            last_alert_window_expires_at = NULL,
            last_alert_protected = FALSE,
            last_channel_id = NULL,
            last_message_id = NULL,
            updated_at = NOW()
        WHERE guild_id = $1
      `,
      [guildId]
    );
    await client.query(
      `
        UPDATE automatic_spam_detection_ai_usage_reservations AS reservation
        SET closed_by_reset = TRUE,
            updated_at = NOW()
        WHERE reservation.guild_id = $1
          AND reservation.closed_by_reset = FALSE
          AND EXISTS (
            SELECT 1
            FROM automatic_spam_detection_events AS event
            WHERE event.id = reservation.event_id
              AND event.guild_id = $1
              AND event.ai_vision_status = 'pending'
          )
      `,
      [guildId]
    );
    await client.query(
      `
        UPDATE automatic_spam_detection_events
        SET status = CASE
              WHEN status = 'evaluating' THEN 'ai_analysis_failed'
              ELSE status
            END,
            window_expires_at = CASE
              WHEN window_expires_at >= NOW() OR status = 'evaluating'
                THEN LEAST(window_expires_at, NOW() - INTERVAL '1 millisecond')
              ELSE window_expires_at
            END,
            ai_vision_status = CASE
              WHEN ai_vision_status = 'pending' THEN 'failed'
              ELSE ai_vision_status
            END,
            ai_vision_error = CASE
              WHEN ai_vision_status = 'pending' THEN 'AI Verdict cancelled by setup reset.'
              ELSE ai_vision_error
            END,
            ai_vision_checked_at = CASE
              WHEN ai_vision_status = 'pending' THEN NOW()
              ELSE ai_vision_checked_at
            END,
            updated_at = NOW()
        WHERE guild_id = $1
          AND (
            window_expires_at >= NOW()
            OR status = 'evaluating'
            OR ai_vision_status = 'pending'
          )
      `,
      [guildId]
    );
    const automaticBanCancellationCount = await cancelPendingAutomaticSpamDetectionBans(guildId, client);
    const spamCatcherBanCancellationCount = await cancelPendingSpamCatcherBans(guildId, client);
    return {
      config,
      automaticBanCancellationCount,
      spamCatcherBanCancellationCount,
    };
  });
}

async function getSpamCatcherEventsByUser(guildId, userId, limit = 5) {
  await ensureSpamCatcherEventsTable();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const res = await query(
    `
      SELECT * FROM spam_catcher_events
      WHERE guild_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [guildId, userId, safeLimit]
  );
  return res.rows.map(mapSpamCatcherEvent);
}

async function getAutomaticSpamDetectionEventsByUser(guildId, userId, limit = 5) {
  await ensureAutomaticSpamDetectionTables();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const res = await query(
    `
      SELECT * FROM automatic_spam_detection_events
      WHERE guild_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [guildId, userId, safeLimit]
  );
  return res.rows.map(mapAutomaticSpamDetectionEvent);
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

async function recordAutomaticSpamDetectionAlert({
  guildId,
  userId,
  channelId,
  messageId,
  alertAt,
  windowExpiresAt,
  protectedEvidence = false,
}) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO automatic_spam_detection_users (
        guild_id, user_id, spammer, spammer_count, last_alert_at, last_alert_window_expires_at,
        last_alert_protected, last_channel_id, last_message_id, updated_at
      )
      VALUES ($1, $2, 0, 0, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        last_alert_at = EXCLUDED.last_alert_at,
        last_alert_window_expires_at = EXCLUDED.last_alert_window_expires_at,
        last_alert_protected = EXCLUDED.last_alert_protected,
        last_channel_id = EXCLUDED.last_channel_id,
        last_message_id = EXCLUDED.last_message_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [guildId, userId, alertAt || new Date(), windowExpiresAt || null, protectedEvidence === true, channelId, messageId || null]
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

async function confirmAutomaticSpamDetectionDanger({
  eventId,
  guildId,
  userId,
  channelId,
  messageId,
  dangerAt,
  aiVisionStatus,
  aiVisionModel,
  moderationAction = 'timeout',
  banStatus = 'none',
  banAfter = null,
  bannedAt = null,
}) {
  await ensureAutomaticSpamDetectionTables();
  return runTransactionWithRetry('Automatic Spam Detection danger confirmation', async (client) => {
    const lockedEvent = await client.query(
      'SELECT * FROM automatic_spam_detection_events WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE',
      [eventId, guildId, userId]
    );
    if (lockedEvent.rowCount === 0) return null;

    let eventRow = lockedEvent.rows[0];
    if (!['evaluating', 'danger'].includes(eventRow.status)) return null;
    if (eventRow.status === 'evaluating') {
      const updatedEvent = await client.query(
        `
          UPDATE automatic_spam_detection_events
          SET status = 'danger',
              danger_confirmed_at = $4,
              ai_vision_status = $5,
              ai_vision_model = $6,
              moderation_action = $7,
              ban_status = $8,
              ban_after = $9,
              banned_at = $10,
              updated_at = NOW()
          WHERE id = $1 AND guild_id = $2 AND user_id = $3
          RETURNING *
        `,
        [
          eventId,
          guildId,
          userId,
          dangerAt,
          aiVisionStatus || null,
          aiVisionModel || null,
          moderationAction || 'timeout',
          banStatus || 'none',
          banAfter || null,
          bannedAt || null,
        ]
      );
      eventRow = updatedEvent.rows[0];
      await client.query(
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
            updated_at = NOW()
        `,
        [guildId, userId, dangerAt, channelId, messageId]
      );
    }

    const userRes = await client.query(
      'SELECT * FROM automatic_spam_detection_users WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    return {
      event: mapAutomaticSpamDetectionEvent(eventRow),
      user: mapAutomaticSpamDetectionUser(userRes.rows[0]),
    };
  });
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

async function claimAutomaticSpamDetectionWindowEvent({
  guildId,
  userId,
  sourceChannelId,
  sourceMessageId,
  attachmentCount,
  reason,
  channels,
  windowStartedAt,
  windowExpiresAt,
  evidenceMessages = [],
  moderationAction = 'timeout',
  banStatus = 'none',
  banAfter = null,
  bannedAt = null,
}) {
  await ensureAutomaticSpamDetectionTables();
  const references = [...new Map(
    (Array.isArray(evidenceMessages) ? evidenceMessages : [])
      .filter((item) => item?.channelId && item?.messageId)
      .map((item) => [`${item.channelId}:${item.messageId}`, item])
  ).values()];
  const initialAttachmentCount = references.reduce(
    (total, reference) => total + Math.max(0, Number(reference.attachmentCount) || 0),
    0
  );
  return runTransactionWithRetry('Automatic Spam Detection event claim', async (client) => {
    const res = await client.query(
      `
        INSERT INTO automatic_spam_detection_events (
          guild_id, user_id, source_channel_id, source_message_id,
          attachment_count, reason, channels_json, window_started_at,
          window_expires_at, moderation_action, ban_status, ban_after,
          banned_at, status, window_claimed, followup_message_count,
          followup_attachment_count, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
          $10, $11, $12, $13, 'evaluating', TRUE, $14, $15, NOW()
        )
        ON CONFLICT (guild_id, user_id, window_started_at) WHERE window_claimed = TRUE
        DO NOTHING
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
        moderationAction || 'timeout',
        banStatus || 'none',
        banAfter || null,
        bannedAt || null,
        references.length,
        initialAttachmentCount,
      ]
    );
    if (res.rows[0]) {
      for (const reference of references) {
        await client.query(
          `
            INSERT INTO automatic_spam_detection_evidence_messages (
              event_id, guild_id, channel_id, message_id, protected, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (event_id, message_id) DO NOTHING
          `,
          [res.rows[0].id, guildId, reference.channelId, reference.messageId, reference.protected === true]
        );
      }
      return { event: mapAutomaticSpamDetectionEvent(res.rows[0]), claimed: true };
    }

    const existing = await client.query(
      `
        SELECT *
        FROM automatic_spam_detection_events
        WHERE guild_id = $1
          AND user_id = $2
          AND window_started_at = $3
          AND window_claimed = TRUE
        LIMIT 1
      `,
      [guildId, userId, windowStartedAt]
    );
    return { event: mapAutomaticSpamDetectionEvent(existing.rows[0]), claimed: false };
  });
}

async function updateAutomaticSpamDetectionAiVisionResult(id, {
  aiVisionStatus,
  aiVisionModel,
  aiVisionImageUrl,
  aiVisionConfidence,
  aiVisionCaption,
  aiVisionOcrText,
  aiVisionMatchedWords,
  aiVisionError,
  aiVisionCheckedAt,
}, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  if (!dbClient) {
    return withAutomaticSpamDetectionEventLock(id, (client) =>
      updateAutomaticSpamDetectionAiVisionResult(id, {
        aiVisionStatus, aiVisionModel, aiVisionImageUrl, aiVisionConfidence,
        aiVisionCaption, aiVisionOcrText, aiVisionMatchedWords, aiVisionError, aiVisionCheckedAt,
      }, client)
    );
  }
  const execute = dbClient.query.bind(dbClient);
  const res = await execute(
    `
      UPDATE automatic_spam_detection_events
      SET ai_vision_status = $2,
          ai_vision_model = $3,
          ai_vision_image_url = $4,
          ai_vision_confidence = $5,
          ai_vision_caption = $6,
          ai_vision_ocr_text = $7,
          ai_vision_matched_words_json = $8::jsonb,
          ai_vision_error = $9,
          ai_vision_checked_at = $10,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      aiVisionStatus || null,
      aiVisionModel || null,
      aiVisionImageUrl || null,
      aiVisionConfidence === null || aiVisionConfidence === undefined ? null : Number(aiVisionConfidence),
      aiVisionCaption || null,
      aiVisionOcrText || null,
      JSON.stringify(Array.isArray(aiVisionMatchedWords) ? aiVisionMatchedWords : []),
      aiVisionError || null,
      aiVisionCheckedAt || null,
    ]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function getAutomaticSpamDetectionEventById(id, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute('SELECT * FROM automatic_spam_detection_events WHERE id = $1', [id]);
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

async function updateAutomaticSpamDetectionModeration(id, {
  moderationAction,
  banStatus,
  banAfter,
  bannedAt,
}) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      UPDATE automatic_spam_detection_events
      SET moderation_action = $2,
          ban_status = $3,
          ban_after = $4,
          banned_at = CASE
            WHEN $5::timestamptz IS NOT NULL THEN $5
            WHEN $3 = 'banned' THEN COALESCE(banned_at, NOW())
            ELSE banned_at
          END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, moderationAction || 'timeout', banStatus || 'none', banAfter || null, bannedAt || null]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function getDueAutomaticSpamDetectionBanEvents(limit = 25) {
  await ensureAutomaticSpamDetectionTables();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const res = await query(
    `
      SELECT * FROM automatic_spam_detection_events
      WHERE ban_status = 'pending'
        AND ban_after IS NOT NULL
        AND ban_after <= NOW()
      ORDER BY ban_after ASC
      LIMIT $1
    `,
    [safeLimit]
  );
  return res.rows.map(mapAutomaticSpamDetectionEvent);
}

async function getPendingAutomaticSpamDetectionAiEvents(limit = 25) {
  await ensureAutomaticSpamDetectionTables();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  const res = await query(
    `
      SELECT * FROM automatic_spam_detection_events
      WHERE status = 'evaluating'
         OR (status = 'danger' AND ai_vision_status = 'pending')
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [safeLimit]
  );
  return res.rows.map(mapAutomaticSpamDetectionEvent);
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

async function updateAutomaticSpamDetectionDecision(
  id,
  status,
  decidedBy,
  decisionError = null,
  dbClient = null,
  expectedStatus = null
) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE automatic_spam_detection_events
      SET status = $2,
          decided_by = $3,
          decision_error = $4,
          updated_at = NOW()
      WHERE id = $1
        AND ($5::text IS NULL OR status = $5)
      RETURNING *
    `,
    [id, status, decidedBy || null, decisionError || null, expectedStatus]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function updateAutomaticSpamDetectionDecisionAndModeration(id, {
  status,
  decidedBy,
  decisionError = null,
  moderationAction,
  banStatus,
  banAfter = null,
  bannedAt = null,
}, dbClient = null, expectedStatus = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE automatic_spam_detection_events
      SET status = $2,
          decided_by = $3,
          decision_error = $4,
          moderation_action = $5,
          ban_status = $6,
          ban_after = $7,
          banned_at = CASE
            WHEN $8::timestamptz IS NOT NULL THEN $8
            WHEN $6 = 'banned' THEN COALESCE(banned_at, NOW())
            ELSE banned_at
          END,
          updated_at = NOW()
      WHERE id = $1
        AND ($9::text IS NULL OR status = $9)
      RETURNING *
    `,
    [
      id,
      status,
      decidedBy || null,
      decisionError || null,
      moderationAction || 'timeout',
      banStatus || 'none',
      banAfter || null,
      bannedAt || null,
      expectedStatus,
    ]
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

async function getLatestOpenAutomaticSpamDetectionDangerEvent(guildId, userId, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      SELECT *
      FROM automatic_spam_detection_events
      WHERE guild_id = $1
        AND user_id = $2
        AND status = 'danger'
        AND danger_confirmed_at IS NOT NULL
      ORDER BY danger_confirmed_at DESC, id DESC
      LIMIT 1
    `,
    [guildId, userId]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function resolveAutomaticSpamDetectionEventAndCloseWindow(id, {
  guildId,
  userId,
  status,
  decidedBy,
  decisionError = null,
  closedAt = new Date(),
}, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const closedBefore = new Date(new Date(closedAt).getTime() - 1);
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      WITH target_window AS (
        SELECT window_started_at, window_expires_at, danger_confirmed_at
        FROM automatic_spam_detection_events
        WHERE id = $1
          AND guild_id = $2
          AND user_id = $3
          AND status = 'danger'
      ),
      guarded_window AS (
        SELECT *
        FROM target_window
        WHERE NOT EXISTS (
          SELECT 1
          FROM automatic_spam_detection_events AS newer
          WHERE newer.guild_id = $2
            AND newer.user_id = $3
            AND newer.id <> $1
            AND newer.status = 'danger'
            AND newer.danger_confirmed_at IS NOT NULL
            AND newer.danger_confirmed_at > target_window.danger_confirmed_at
        )
      ),
      cleared_user AS (
        UPDATE automatic_spam_detection_users
        SET spammer = 0,
            last_alert_window_expires_at = CASE
              WHEN last_alert_window_expires_at IS NULL OR last_alert_window_expires_at > $7 THEN $7
              ELSE last_alert_window_expires_at
            END,
            updated_at = NOW()
        FROM guarded_window
        WHERE automatic_spam_detection_users.guild_id = $2
          AND automatic_spam_detection_users.user_id = $3
        RETURNING automatic_spam_detection_users.guild_id
      )
      UPDATE automatic_spam_detection_events AS event
      SET status = CASE WHEN event.id = $1 THEN $4 ELSE event.status END,
          decided_by = CASE WHEN event.id = $1 THEN $5 ELSE event.decided_by END,
          decision_error = CASE WHEN event.id = $1 THEN $6 ELSE event.decision_error END,
          window_expires_at = LEAST(event.window_expires_at, $7),
          updated_at = NOW()
      FROM guarded_window
      WHERE event.guild_id = $2
        AND event.user_id = $3
        AND (
          (
            event.window_started_at <= guarded_window.window_expires_at
            AND event.window_expires_at >= guarded_window.window_started_at
          )
          OR (
            event.window_claimed = TRUE
            AND event.danger_confirmed_at IS NULL
            AND event.window_started_at <= $7
            AND event.window_expires_at >= $7
          )
        )
      RETURNING event.*
    `,
    [id, guildId, userId, status, decidedBy || null, decisionError || null, closedBefore]
  );
  return mapAutomaticSpamDetectionEvent(res.rows.find((row) => Number(row.id) === Number(id)));
}

async function getAutomaticSpamDetectionWindowEventForMessage(guildId, userId, messageAt) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      SELECT *
      FROM automatic_spam_detection_events
      WHERE guild_id = $1
        AND user_id = $2
        AND window_started_at <= $3
        AND window_expires_at >= $3
      ORDER BY window_claimed DESC, created_at DESC, id DESC
      LIMIT 1
    `,
    [guildId, userId, messageAt]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function appendAutomaticSpamDetectionWindowFollowup({
  eventId,
  guildId,
  userId,
  channelId,
  messageId,
  attachmentCount,
  messageAt,
  protectedEvidence = false,
}, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      WITH inserted AS (
        INSERT INTO automatic_spam_detection_event_messages (
          event_id, message_id, channel_id, attachment_count, message_at
        )
        SELECT id, $5, $4, $6, $7
        FROM automatic_spam_detection_events
        WHERE id = $1
          AND guild_id = $2
          AND user_id = $3
          AND window_started_at <= $7
          AND window_expires_at >= $7
          AND source_message_id IS DISTINCT FROM $5
        ON CONFLICT (event_id, message_id) DO NOTHING
        RETURNING event_id, message_id, channel_id, attachment_count, message_at
      ), stored_evidence AS (
        INSERT INTO automatic_spam_detection_evidence_messages (
          event_id, guild_id, channel_id, message_id, protected, updated_at
        )
        SELECT inserted.event_id, $2, inserted.channel_id, inserted.message_id, $8, NOW()
        FROM inserted
        ON CONFLICT (event_id, message_id) DO NOTHING
        RETURNING event_id
      )
      UPDATE automatic_spam_detection_events AS event
      SET channels_json = CASE
            WHEN event.channels_json ? inserted.channel_id THEN event.channels_json
            ELSE event.channels_json || jsonb_build_array(inserted.channel_id)
          END,
          reason = CASE
            WHEN event.channels_json ? inserted.channel_id OR jsonb_array_length(event.channels_json) = 0 THEN event.reason
            ELSE 'same_author_2plus_attachments_in_2plus_channels'
          END,
          followup_message_count = event.followup_message_count + 1,
          followup_attachment_count = event.followup_attachment_count + inserted.attachment_count,
          last_followup_at = CASE
            WHEN event.last_followup_at IS NULL OR inserted.message_at >= event.last_followup_at THEN inserted.message_at
            ELSE event.last_followup_at
          END,
          last_followup_channel_id = CASE
            WHEN event.last_followup_at IS NULL OR inserted.message_at >= event.last_followup_at THEN inserted.channel_id
            ELSE event.last_followup_channel_id
          END,
          last_followup_message_id = CASE
            WHEN event.last_followup_at IS NULL OR inserted.message_at >= event.last_followup_at THEN inserted.message_id
            ELSE event.last_followup_message_id
          END,
          last_followup_attachment_count = CASE
            WHEN event.last_followup_at IS NULL OR inserted.message_at >= event.last_followup_at THEN inserted.attachment_count
            ELSE event.last_followup_attachment_count
          END,
          evidence_deleted_by = NULL,
          evidence_deleted_at = NULL,
          updated_at = NOW()
      FROM inserted
      WHERE event.id = inserted.event_id
      RETURNING event.*
    `,
    [eventId, guildId, userId, channelId, messageId, Math.max(0, Number(attachmentCount) || 0), messageAt, protectedEvidence === true]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

function mapAutomaticSpamDetectionEvidenceMessage(row) {
  if (!row) return null;
  return {
    eventId: Number(row.event_id),
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    protected: row.protected === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

async function getAutomaticSpamDetectionEvidenceMessages(eventId, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      SELECT *
      FROM automatic_spam_detection_evidence_messages
      WHERE event_id = $1
      ORDER BY created_at ASC, message_id ASC
    `,
    [eventId]
  );
  return res.rows.map(mapAutomaticSpamDetectionEvidenceMessage);
}

async function markAutomaticSpamDetectionEvidenceDeleted(eventId, messageId, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE automatic_spam_detection_evidence_messages
      SET deleted_at = COALESCE(deleted_at, NOW()),
          updated_at = NOW()
      WHERE event_id = $1 AND message_id = $2
      RETURNING message_id
    `,
    [eventId, messageId]
  );
  return res.rowCount > 0;
}

async function completeAutomaticSpamDetectionEvidenceDeletion(eventId, guildId, deletedBy, dbClient = null) {
  await ensureAutomaticSpamDetectionTables();
  const execute = dbClient ? dbClient.query.bind(dbClient) : query;
  const res = await execute(
    `
      UPDATE automatic_spam_detection_events
      SET evidence_deleted_by = COALESCE(evidence_deleted_by, $3),
          evidence_deleted_at = COALESCE(evidence_deleted_at, NOW()),
          updated_at = NOW()
      WHERE id = $1 AND guild_id = $2
      RETURNING *
    `,
    [eventId, guildId, deletedBy]
  );
  return mapAutomaticSpamDetectionEvent(res.rows[0]);
}

async function reserveAiVisionDailyUsageForEvent(eventId, guildId, usageDate, limit) {
  await ensureAutomaticSpamDetectionTables();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : DEFAULT_AI_VISION_DAILY_LIMIT;
  if (safeLimit <= 0) {
    return { allowed: false, usedCount: 0, limit: safeLimit };
  }

  const db = await getPool();
  const delays = [250, 1000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`ai-vision:${guildId}:${usageDate}`]
      );

      const eventRes = await client.query(
        'SELECT id FROM automatic_spam_detection_events WHERE id = $1 AND guild_id = $2 FOR UPDATE',
        [eventId, guildId]
      );
      if (eventRes.rowCount === 0) {
        throw new Error(`Automatic Spam Detection event ${eventId} not found for AI usage reservation.`);
      }

      let reservationRes = await client.query(
        `
          SELECT allowed, used_count_after, refunded, closed_by_reset, usage_date::text AS usage_date
          FROM automatic_spam_detection_ai_usage_reservations
          WHERE event_id = $1
        `,
        [eventId]
      );

      if (reservationRes.rowCount === 0) {
        const consumedRes = await client.query(
          `
            INSERT INTO automatic_spam_detection_ai_usage (guild_id, usage_date, used_count, updated_at)
            VALUES ($1, $2::date, 1, NOW())
            ON CONFLICT (guild_id, usage_date) DO UPDATE SET
              used_count = automatic_spam_detection_ai_usage.used_count + 1,
              updated_at = NOW()
            WHERE automatic_spam_detection_ai_usage.used_count < $3
            RETURNING used_count
          `,
          [guildId, usageDate, safeLimit]
        );
        const allowed = consumedRes.rowCount > 0;
        let usedCount = Number(consumedRes.rows[0]?.used_count || 0);
        if (!allowed) {
          const currentUsageRes = await client.query(
            `
              SELECT used_count
              FROM automatic_spam_detection_ai_usage
              WHERE guild_id = $1 AND usage_date = $2::date
            `,
            [guildId, usageDate]
          );
          usedCount = Number(currentUsageRes.rows[0]?.used_count || 0);
        }
        reservationRes = await client.query(
          `
            INSERT INTO automatic_spam_detection_ai_usage_reservations (
              event_id, guild_id, usage_date, allowed, used_count_after, updated_at
            )
            VALUES ($1, $2, $3::date, $4, $5, NOW())
            RETURNING allowed, used_count_after, refunded, closed_by_reset, usage_date::text AS usage_date
          `,
          [eventId, guildId, usageDate, allowed, usedCount]
        );
      }

      await client.query('COMMIT');
      client.release();
      const row = reservationRes.rows[0];
      return {
        allowed: row?.allowed === true && row?.refunded !== true && row?.closed_by_reset !== true,
        usedCount: Number(row?.used_count_after || 0),
        limit: safeLimit,
        usageDate: row?.usage_date || usageDate,
      };
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => null);
        client.release(isTransientPostgresError(error) ? error : undefined);
      }
      if (!isTransientPostgresError(error) || attempt >= delays.length) {
        throw error;
      }
      console.warn(
        `[postgres] Transient AI usage reservation failure, retrying in ${delays[attempt]}ms:`,
        error?.message || error
      );
      await wait(delays[attempt]);
    }
  }
  throw new Error('AI usage reservation failed without an error.');
}

async function getAiVisionDailyUsage(guildId, usageDate) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      SELECT used_count
      FROM automatic_spam_detection_ai_usage
      WHERE guild_id = $1
        AND usage_date = $2::date
    `,
    [guildId, usageDate]
  );
  return Number(res.rows[0]?.used_count || 0);
}

async function addAiVisionDailyLimitBypassGuild(guildId, addedBy) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO ai_vision_daily_limit_bypass_guilds (guild_id, bypassed, added_by, updated_at)
      VALUES ($1, TRUE, $2, NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        bypassed = TRUE,
        added_by = EXCLUDED.added_by,
        updated_at = NOW()
      RETURNING guild_id, added_by, created_at, updated_at
    `,
    [guildId, addedBy]
  );
  return res.rows[0] || null;
}

async function removeAiVisionDailyLimitBypassGuild(guildId, removedBy) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      INSERT INTO ai_vision_daily_limit_bypass_guilds (guild_id, bypassed, added_by, updated_at)
      VALUES ($1, FALSE, $2, NOW())
      ON CONFLICT (guild_id) DO UPDATE SET
        bypassed = FALSE,
        added_by = EXCLUDED.added_by,
        updated_at = NOW()
      RETURNING guild_id
    `,
    [guildId, removedBy]
  );
  return res.rowCount > 0;
}

async function listAiVisionDailyLimitBypassGuilds() {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    `
      SELECT guild_id, bypassed, added_by, created_at, updated_at
      FROM ai_vision_daily_limit_bypass_guilds
      ORDER BY created_at ASC, guild_id ASC
    `
  );
  return res.rows;
}

async function getAiVisionDailyLimitBypassOverride(guildId) {
  await ensureAutomaticSpamDetectionTables();
  const res = await query(
    'SELECT bypassed FROM ai_vision_daily_limit_bypass_guilds WHERE guild_id = $1',
    [guildId]
  );
  return res.rowCount > 0 ? res.rows[0].bypassed === true : null;
}

async function resetAiVisionDailyUsage(guildId, usageDate) {
  await ensureAutomaticSpamDetectionTables();
  return runTransactionWithRetry('AI usage reset', async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`ai-vision:${guildId}:${usageDate}`]
    );
    const previousRes = await client.query(
      `
        SELECT used_count
        FROM automatic_spam_detection_ai_usage
        WHERE guild_id = $1 AND usage_date = $2::date
      `,
      [guildId, usageDate]
    );
    const closedRes = await client.query(
      `
        UPDATE automatic_spam_detection_ai_usage_reservations
        SET closed_by_reset = TRUE,
            updated_at = NOW()
        WHERE guild_id = $1
          AND usage_date = $2::date
          AND closed_by_reset = FALSE
        RETURNING event_id
      `,
      [guildId, usageDate]
    );
    await client.query(
      `
        INSERT INTO automatic_spam_detection_ai_usage (guild_id, usage_date, used_count, updated_at)
        VALUES ($1, $2::date, 0, NOW())
        ON CONFLICT (guild_id, usage_date) DO UPDATE SET
          used_count = 0,
          updated_at = NOW()
      `,
      [guildId, usageDate]
    );
    return {
      previousUsedCount: Number(previousRes.rows[0]?.used_count || 0),
      usedCount: 0,
      closedReservationCount: closedRes.rowCount,
    };
  });
}

async function resetUserDatabaseState(guildId, userId, scope, decidedBy) {
  await ensureSpamCatcherEventsTable();
  await ensureAutomaticSpamDetectionTables();

  if (scope === 'full') {
    const res = await query(
      `
        WITH deleted_automatic_events AS (
          DELETE FROM automatic_spam_detection_events
          WHERE guild_id = $1 AND user_id = $2
          RETURNING id
        ), deleted_automatic_user AS (
          DELETE FROM automatic_spam_detection_users
          WHERE guild_id = $1 AND user_id = $2
          RETURNING user_id
        ), deleted_trap_events AS (
          DELETE FROM spam_catcher_events
          WHERE guild_id = $1 AND user_id = $2
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*) FROM deleted_automatic_events) AS automatic_event_count,
          (SELECT COUNT(*) FROM deleted_automatic_user) AS automatic_user_count,
          (SELECT COUNT(*) FROM deleted_trap_events) AS trap_event_count
      `,
      [guildId, userId]
    );
    return {
      scope,
      automaticEventCount: Number(res.rows[0]?.automatic_event_count || 0),
      automaticUserCount: Number(res.rows[0]?.automatic_user_count || 0),
      trapEventCount: Number(res.rows[0]?.trap_event_count || 0),
    };
  }

  const res = await query(
    `
      WITH reset_automatic_user AS (
        UPDATE automatic_spam_detection_users
        SET spammer = 0,
            last_alert_at = NULL,
            last_alert_window_expires_at = NULL,
            last_alert_protected = FALSE,
            last_channel_id = NULL,
            last_message_id = NULL,
            updated_at = NOW()
        WHERE guild_id = $1 AND user_id = $2
        RETURNING user_id
      ), reset_automatic_events AS (
        UPDATE automatic_spam_detection_events
        SET status = 'admin_reset',
            window_expires_at = LEAST(window_expires_at, NOW() - INTERVAL '1 millisecond'),
            ai_vision_status = CASE WHEN ai_vision_status = 'pending' THEN 'failed' ELSE ai_vision_status END,
            ai_vision_error = CASE
              WHEN ai_vision_status = 'pending' THEN 'AI Verdict cancelled by Super Admin reset.'
              ELSE ai_vision_error
            END,
            ai_vision_checked_at = CASE
              WHEN ai_vision_status = 'pending' THEN NOW()
              ELSE ai_vision_checked_at
            END,
            ban_status = 'cancelled',
            ban_after = NULL,
            decided_by = $3,
            decision_error = 'Database state reset by Super Admin.',
            updated_at = NOW()
        WHERE guild_id = $1
          AND user_id = $2
          AND status IN ('danger', 'evaluating', 'ban_failed', 'timeout_remove_failed')
        RETURNING id
      ), reset_trap_events AS (
        UPDATE spam_catcher_events
        SET status = 'admin_reset',
            ban_after = NULL,
            decided_by = $3,
            updated_at = NOW()
        WHERE guild_id = $1
          AND user_id = $2
          AND status IN ('caught', 'timed_out', 'ban_pending')
        RETURNING id
      )
      SELECT
        (SELECT COUNT(*) FROM reset_automatic_user) AS automatic_user_count,
        (SELECT COUNT(*) FROM reset_automatic_events) AS automatic_event_count,
        (SELECT COUNT(*) FROM reset_trap_events) AS trap_event_count
    `,
    [guildId, userId, decidedBy]
  );
  return {
    scope: 'active',
    automaticUserCount: Number(res.rows[0]?.automatic_user_count || 0),
    automaticEventCount: Number(res.rows[0]?.automatic_event_count || 0),
    trapEventCount: Number(res.rows[0]?.trap_event_count || 0),
  };
}

async function refundAiVisionDailyUsageForEvent(eventId, guildId, usageDate) {
  await ensureAutomaticSpamDetectionTables();
  return runTransactionWithRetry('AI usage refund', async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`ai-vision:${guildId}:${usageDate}`]
    );
    const reservationRes = await client.query(
      `
        SELECT allowed, refunded, closed_by_reset
        FROM automatic_spam_detection_ai_usage_reservations
        WHERE event_id = $1
          AND guild_id = $2
          AND usage_date = $3::date
        FOR UPDATE
      `,
      [eventId, guildId, usageDate]
    );
    const reservation = reservationRes.rows[0];
    if (!reservation || reservation.allowed !== true) {
      return { refunded: false, usedCount: null };
    }

    const usageRes = await client.query(
      `
        SELECT used_count
        FROM automatic_spam_detection_ai_usage
        WHERE guild_id = $1 AND usage_date = $2::date
      `,
      [guildId, usageDate]
    );
    if (reservation.refunded === true || reservation.closed_by_reset === true) {
      return {
        refunded: true,
        usedCount: Number(usageRes.rows[0]?.used_count || 0),
      };
    }

    await client.query(
      `
        UPDATE automatic_spam_detection_ai_usage_reservations
        SET refunded = TRUE,
            updated_at = NOW()
        WHERE event_id = $1
      `,
      [eventId]
    );
    const refundedUsageRes = await client.query(
      `
        UPDATE automatic_spam_detection_ai_usage
        SET used_count = GREATEST(0, used_count - 1),
            updated_at = NOW()
        WHERE guild_id = $1
          AND usage_date = $2::date
          AND used_count > 0
        RETURNING used_count
      `,
      [guildId, usageDate]
    );
    return {
      refunded: true,
      usedCount: Number(refundedUsageRes.rows[0]?.used_count || 0),
    };
  });
}

async function close() {
  if (pool) {
    await pool.end();
  }
}

module.exports = {
  DEFAULT_SPAM_CATCHER_CONFIG,
  normalizeSpamCatcherConfig,
  normalizeTimezone,
  getGuildConfig,
  getSpamCatcherConfig,
  withGuildConfigLock,
  withAutomaticSpamDetectionEventLock,
  saveSpamCatcherConfig,
  setGuildAiVisionDailyLimit,
  listSpamCatcherConfigs,
  createSpamCatcherEvent,
  getSpamCatcherEventById,
  updateSpamCatcherEventStatus,
  markSpamCatcherAppealed,
  updateSpamCatcherReviewMessage,
  resolveSpamCatcherAppeal,
  getDueSpamCatcherBanEvents,
  scheduleSpamCatcherBan,
  cancelPendingSpamCatcherBans,
  cancelPendingAutomaticSpamDetectionBans,
  resetSpamCatcherSetup,
  getSpamCatcherEventsByUser,
  getSpamCatcherCaughtCount,
  getSpamCatcherNoticeMessage,
  saveSpamCatcherNoticeMessages,
  recordAutomaticSpamDetectionAlert,
  markAutomaticSpamDetectionDangerUser,
  confirmAutomaticSpamDetectionDanger,
  resetAutomaticSpamDetectionSpammer,
  getAutomaticSpamDetectionUser,
  claimAutomaticSpamDetectionWindowEvent,
  updateAutomaticSpamDetectionAiVisionResult,
  getAutomaticSpamDetectionWindowEventForMessage,
  appendAutomaticSpamDetectionWindowFollowup,
  getAutomaticSpamDetectionEvidenceMessages,
  markAutomaticSpamDetectionEvidenceDeleted,
  completeAutomaticSpamDetectionEvidenceDeletion,
  getAutomaticSpamDetectionEventById,
  getLatestOpenAutomaticSpamDetectionDangerEvent,
  getAutomaticSpamDetectionEventsByUser,
  updateAutomaticSpamDetectionTimeout,
  updateAutomaticSpamDetectionModeration,
  getDueAutomaticSpamDetectionBanEvents,
  getPendingAutomaticSpamDetectionAiEvents,
  updateAutomaticSpamDetectionReviewMessage,
  updateAutomaticSpamDetectionDecision,
  updateAutomaticSpamDetectionDecisionAndModeration,
  resolveAutomaticSpamDetectionEventAndCloseWindow,
  markAutomaticSpamDetectionAppealed,
  reserveAiVisionDailyUsageForEvent,
  getAiVisionDailyUsage,
  addAiVisionDailyLimitBypassGuild,
  removeAiVisionDailyLimitBypassGuild,
  listAiVisionDailyLimitBypassGuilds,
  getAiVisionDailyLimitBypassOverride,
  resetAiVisionDailyUsage,
  resetUserDatabaseState,
  refundAiVisionDailyUsageForEvent,
  close,
};
