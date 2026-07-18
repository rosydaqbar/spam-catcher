const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorSpacingSize,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  parseAiVisionDailyLimitBypassGuildIds,
  parseAllowedGuildIds,
} = require('./env');
const {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  createAiVisionChecker,
  decideScamFromVision,
  firstSupportedImageAttachment,
} = require('./ai-vision-checker');
const { createTranslator } = require('./i18n');
const { createModerationWorkflow } = require('./moderation-workflow');
const { createLogger } = require('../lib/logger');

const BAN_PREFIX = 'autospam_ban';
const BAN_CONFIRM_PREFIX = 'autospam_ban_confirm';
const BAN_CANCEL_PREFIX = 'autospam_ban_cancel';
const REMOVE_TIMEOUT_PREFIX = 'autospam_remove_timeout';
const DELETE_EVIDENCE_PREFIX = 'autospam_delete_evidence';
const SHOW_DETAILS_PREFIX = 'autospam_show_details';
const DANGER_TITLE_EMOJI = '<a:692859sirene:1527955940400173067>';
const BANNED_EMOJI = '<a:banned:1527957634009927791>';
const CONFIG_CACHE_TTL_MS = 5000;
const DISCORD_TIMEOUT_MAX_MS = (28 * 24 * 60 * 60 * 1000) - 60_000;
const AI_VISION_CAPTION_MAX_LENGTH = 220;
const AI_VISION_OCR_MAX_LENGTH = 350;
const AI_VISION_GUILD_CONCURRENCY = 2;
const EVENT_MESSAGE_UPDATE_DEBOUNCE_MS = 750;
const EVENT_MESSAGE_UPDATE_RETRY_DELAYS_MS = [1500, 5000, 15_000];

function createAutomaticSpamDetectionManager({
  client,
  configStore,
  runGuildConfigOperation = async (_guildId, task) => task(),
}) {
  const allowedGuildIds = parseAllowedGuildIds();
  const aiVisionDailyLimitBypassGuildIds = parseAiVisionDailyLimitBypassGuildIds();
  const configCache = new Map();
  const configGenerationByGuild = new Map();
  const attachmentSessionByAuthor = new Map();
  const messageQueueByAuthor = new Map();
  const aiVisionQueueByGuild = new Map();
  const aiVisionTaskByEvent = new Map();
  const cancelledAiVisionEventIds = new Set();
  const eventMessageQueueByEvent = new Map();
  const eventMessageUpdateTimerByEvent = new Map();
  const logger = createLogger('automatic-spam-detection');
  const visionChecker = createAiVisionChecker({
    openRouterApiKey: OPENROUTER_API_KEY,
    openRouterModel: OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    geminiApiKey: GEMINI_API_KEY,
    geminiModel: GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  });

  function isGuildAllowed(guildId) {
    if (!guildId) return false;
    return allowedGuildIds.size === 0 || allowedGuildIds.has(guildId);
  }

  async function getConfig(guildId) {
    const cached = configCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await configStore.getSpamCatcherConfig(guildId);
    configCache.set(guildId, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return value;
  }

  async function isAiVisionDailyLimitBypassed(guildId) {
    let lookupFailed = false;
    const override = await configStore.getAiVisionDailyLimitBypassOverride(guildId).catch((error) => {
      lookupFailed = true;
      logger.error('Failed to check persistent AI Verdict daily limit bypass', {
        guildId,
        error: safeError(error),
      });
      return null;
    });
    if (lookupFailed) return false;
    return override === null ? aiVisionDailyLimitBypassGuildIds.has(guildId) : override;
  }

  function authorKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function safeError(error) {
    return String(error?.message || error || 'Unknown error').slice(0, 500);
  }

  function isUnknownMemberError(error) {
    return error?.code === 10007 || safeError(error).toLowerCase().includes('unknown member');
  }

  function isEvidenceAlreadyGone(error) {
    return error?.code === 10003 || error?.code === 10008;
  }

  function existingTimeoutUntil(member) {
    const until = member?.communicationDisabledUntilTimestamp;
    return Number.isFinite(until) && until > Date.now() ? new Date(until) : null;
  }

  function timestamp(date, style = 'R') {
    if (!date) return null;
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
  }

  function localDateString(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date || new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function drainAiVisionQueue(guildId, state) {
    while (state.active < AI_VISION_GUILD_CONCURRENCY && state.queue.length > 0) {
      const next = state.queue.shift();
      state.active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          state.active -= 1;
          if (state.active === 0 && state.queue.length === 0) {
            aiVisionQueueByGuild.delete(guildId);
          } else {
            drainAiVisionQueue(guildId, state);
          }
        });
    }
  }

  function runQueuedAiVision(guildId, eventId, task) {
    let state = aiVisionQueueByGuild.get(guildId);
    if (!state) {
      state = { active: 0, queue: [] };
      aiVisionQueueByGuild.set(guildId, state);
    }
    return new Promise((resolve, reject) => {
      state.queue.push({ eventId, task, resolve, reject });
      drainAiVisionQueue(guildId, state);
    });
  }

  function cancelQueuedAiVision(guildId, eventId) {
    const state = aiVisionQueueByGuild.get(guildId);
    if (!state) return null;
    const index = state.queue.findIndex((entry) => entry.eventId === eventId);
    if (index < 0) return null;
    const [entry] = state.queue.splice(index, 1);
    if (state.active === 0 && state.queue.length === 0) aiVisionQueueByGuild.delete(guildId);
    return entry;
  }

  function restoreQueuedAiVision(guildId, entry) {
    let state = aiVisionQueueByGuild.get(guildId);
    if (!state) {
      state = { active: 0, queue: [] };
      aiVisionQueueByGuild.set(guildId, state);
    }
    state.queue.unshift(entry);
    drainAiVisionQueue(guildId, state);
  }

  function reasonText(reason, t) {
    if (reason === 'same_author_2plus_attachments_in_2plus_channels') {
      return t('automatic.reasonCrossChannel');
    }
    return t('automatic.reasonRepeated');
  }

  function statusText(event, t) {
    if (event.status === 'banned') return t('automatic.statusBanned', { userId: event.decidedBy });
    if (event.status === 'timeout_removed') return t('automatic.statusTimeoutRemoved', { userId: event.decidedBy });
    if (event.status === 'user_unavailable') return t('automatic.statusUserUnavailable', { userId: event.decidedBy });
    if (event.status === 'ban_failed') return t('automatic.statusBanFailed', { error: event.decisionError || 'unknown error' });
    if (event.status === 'timeout_remove_failed') return t('automatic.statusTimeoutRemoveFailed', { error: event.decisionError || 'unknown error' });
    if (event.status === 'admin_reset') return t('automatic.statusSuperAdminReset', { userId: event.decidedBy });
    if (event.status === 'ai_analysis_failed') return t('automatic.statusAiAnalysisFailed');
    if (event.status === 'ai_daily_limit_reached') return t('automatic.statusAiDailyLimitReached');
    if (event.status === 'ai_low_confidence') return t('automatic.statusAiLowConfidence');
    if (event.status === 'ai_no_match') return t('automatic.statusAiNoMatch');
    return t('automatic.statusWaiting');
  }

  function moderationHeaderStatus(event, t) {
    if (event.status === 'banned') return t('automatic.headerModerationBanned');
    if (event.status === 'timeout_removed') return t('automatic.headerModerationCleared');
    if (event.status === 'user_unavailable') return t('automatic.headerModerationUnavailable');
    if (event.status === 'ban_failed') return t('automatic.headerModerationBanFailed');
    if (event.status === 'timeout_remove_failed') return t('automatic.headerModerationRemoveFailed');
    if (event.status === 'admin_reset') return t('automatic.headerModerationReset');
    if (event.timeoutStatus === 'failed') return t('automatic.headerModerationTimeoutFailed');
    if (event.timeoutStatus === 'already_active') return t('automatic.headerModerationAlreadyActive');
    if (event.timeoutStatus === 'applied') return t('automatic.headerModerationActive');
    return t('automatic.headerModerationPending');
  }

  function aiVisionHeaderStatus(event, t) {
    if (event.aiVisionStatus === 'pending') return t('automatic.headerAiPending');
    if (event.aiVisionStatus === 'matched') return t('automatic.headerAiMatched');
    if (event.aiVisionStatus === 'no_match') return t('automatic.headerAiNoMatch');
    if (event.aiVisionStatus === 'low_confidence') return t('automatic.headerAiLowConfidence');
    if (event.aiVisionStatus === 'failed') return t('automatic.headerAiFailed');
    if (event.aiVisionStatus === 'daily_limit_reached') return t('automatic.headerAiDailyLimit');
    return null;
  }

  function eventHeaderTitle(event, t) {
    if (event.status === 'banned') {
      return `${BANNED_EMOJI} ${t('automatic.bannedTitle')}`;
    }
    if (event.status === 'timeout_removed' || event.status === 'admin_reset') {
      return `📝 ${t('automatic.summaryTitle')}`;
    }
    return `${DANGER_TITLE_EMOJI} ${t('automatic.dangerTitle')}`;
  }

  function aiVisionStatusText(event, t) {
    if (event.aiVisionStatus === 'pending') return t('automatic.aiVisionPending');
    if (event.aiVisionStatus === 'matched') return t('automatic.aiVisionScamMatched');
    if (event.aiVisionStatus === 'no_match') return t('automatic.aiVisionNoMatch');
    if (event.aiVisionStatus === 'low_confidence') return t('automatic.aiVisionLowConfidence');
    if (event.aiVisionStatus === 'failed') return t('automatic.aiVisionFailed');
    if (event.aiVisionStatus === 'daily_limit_reached') return t('automatic.aiVisionDailyLimitReached');
    return event.aiVisionStatus || t('automatic.notAvailable');
  }

  function spammerStateText(userState, t) {
    return userState?.spammer ? t('automatic.spammerStateActive') : t('automatic.spammerStateCleared');
  }

  function eventAccentColor(event) {
    if (event.status === 'danger') return 0xef4444;
    if (event.status === 'banned' || event.status === 'ban_failed') return 0x7f1d1d;
    if (event.status === 'timeout_remove_failed') return 0xf59e0b;
    return 0x22c55e;
  }

  function divider() {
    return new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small);
  }

  function deleteEvidenceButton(event, t) {
    const completed = Boolean(event.evidenceDeletedAt);
    return new ButtonBuilder()
      .setCustomId(`${DELETE_EVIDENCE_PREFIX}:${event.id}`)
      .setLabel(t(completed ? 'automatic.evidenceDeleted' : 'automatic.deleteEvidence'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(completed);
  }

  function showDetailsButton(event, t) {
    return new ButtonBuilder()
      .setCustomId(`${SHOW_DETAILS_PREFIX}:${event.id}`)
      .setLabel(t('automatic.showDetails'))
      .setStyle(ButtonStyle.Primary);
  }

  function sectionWithLink(content, label, url) {
    return new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
      .setButtonAccessory(
        new ButtonBuilder()
          .setLabel(label)
          .setStyle(ButtonStyle.Link)
          .setURL(url)
      );
  }

  function truncateText(value, maxLength = 700) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
  }

  function aiVisionLines(event, t) {
    if (!event.aiVisionStatus) return null;
    return [
      `### ${t('automatic.aiVisionFinding')}`,
      `**${t('automatic.aiVisionVerdict')}:** \`${aiVisionStatusText(event, t)}\``,
      event.aiVisionConfidence === null || event.aiVisionConfidence === undefined
        ? null
        : `**${t('automatic.aiVisionConfidence')}:** \`${Math.round(event.aiVisionConfidence * 100)}%\``,
      event.aiVisionCaption ? `**${t('automatic.aiVisionCaption')}:** \`${truncateText(event.aiVisionCaption, AI_VISION_CAPTION_MAX_LENGTH)}\`` : null,
      event.aiVisionOcrText ? `**${t('automatic.aiVisionOcrText')}:** \`${truncateText(event.aiVisionOcrText, AI_VISION_OCR_MAX_LENGTH)}\`` : null,
      event.aiVisionMatchedWords?.length
        ? `**${t('automatic.aiVisionMatchedWords')}:** ${event.aiVisionMatchedWords.map((word) => `\`${word}\``).join(', ')}`
        : null,

      event.aiVisionError ? `**${t('automatic.aiVisionError')}:** \`${truncateText(event.aiVisionError, 250)}\`` : null,
    ].filter(Boolean);
  }

  function aggregateEvidenceLines(event, t) {
    const channels = event.channels.length > 0 ? event.channels : [event.sourceChannelId];
    const visibleChannels = channels.slice(0, 15);
    const channelList = [
      visibleChannels.map((channelId) => `<#${channelId}>`).join(', '),
      channels.length > visibleChannels.length
        ? t('automatic.andMoreChannels', { count: channels.length - visibleChannels.length })
        : null,
    ].filter(Boolean).join(' ');
    const latestFollowupUrl = event.lastFollowupChannelId && event.lastFollowupMessageId
      ? `https://discord.com/channels/${event.guildId}/${event.lastFollowupChannelId}/${event.lastFollowupMessageId}`
      : null;
    return [
      `**${t('automatic.channelsInWindow')}:** ${channelList}`,
      event.lastFollowupAt && event.lastFollowupChannelId
        ? `**${t('automatic.latestFollowup')}:** <#${event.lastFollowupChannelId}> · \`${event.lastFollowupAttachmentCount || 0}\` ${t('automatic.attachments')} · ${timestamp(event.lastFollowupAt)}${latestFollowupUrl ? ` · [${t('automatic.openMessage')}](${latestFollowupUrl})` : ''}`
        : null,
    ].filter(Boolean);
  }

  function buildDangerPayload(event, userState, config = {}, options = {}) {
    const t = createTranslator(config.language);
    const successfulResolution = event.status === 'timeout_removed' || event.status === 'banned';
    const compact = options.forceDetailed !== true && successfulResolution;
    const includeActions = options.includeActions !== false;
    const messageUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}/${event.sourceMessageId}`;
    const channelUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}`;
    const timeoutLine = event.timeoutStatus === 'applied'
      ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutApplied')}\` ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'already_active'
        ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutAlreadyActive')}\` ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'failed'
        ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutFailed')}\` (\`${event.timeoutError || 'unknown error'}\`)`
        : `**${t('automatic.timeout')}:** \`${t('automatic.timeoutPending')}\``;
    const aiHeaderStatus = aiVisionHeaderStatus(event, t);
    const moderationStateLines = [
      `### ${t('automatic.moderationState')}`,
      `**${t('automatic.spammerState')}:** \`${spammerStateText(userState, t)}\``,
      `**${t('automatic.spammerCount')}:** \`${userState?.spammerCount || 0}\``,
      timeoutLine,
      `**${t('automatic.status')}:** ${statusText(event, t)}`,
      event.evidenceDeletedBy && event.evidenceDeletedAt
        ? `**${t('automatic.evidenceDeletionState')}:** ${t('automatic.evidenceDeletedBy', {
          userId: event.evidenceDeletedBy,
          deletedAt: timestamp(event.evidenceDeletedAt),
        })}`
        : null,
    ].filter(Boolean);

    const container = new ContainerBuilder()
      .setAccentColor(eventAccentColor(event))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${eventHeaderTitle(event, t)}`,
          `### ${t('automatic.headerStatus')}:`,
          moderationHeaderStatus(event, t),
          aiHeaderStatus,
          `-# ${t('automatic.eventId')}: \`${event.id}\``,
        ].filter(Boolean).join('\n'))
      )
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
        `### ${t('automatic.incident')}`,
        `**${t('automatic.user')}:** <@${event.userId}> (\`${event.userId}\`)`,
        `**${t('automatic.reason')}:** \`${reasonText(event.reason, t)}\``,
      ].join('\n'), t('automatic.openMessage'), messageUrl));

    if (compact) {
      container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(moderationStateLines.join('\n'))
        );
      if (includeActions) {
        container
          .addSeparatorComponents(divider())
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              deleteEvidenceButton(event, t),
              showDetailsButton(event, t)
            )
          );
      }
      return {
        flags: MessageFlags.IsComponentsV2 | (options.ephemeral === true ? MessageFlags.Ephemeral : 0),
        components: [container],
        allowedMentions: { parse: [] },
      };
    }

    container
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
         `### ${t('automatic.evidence')}`,
         `**${t('automatic.sourceChannel')}:** <#${event.sourceChannelId}>`,
         ...aggregateEvidenceLines(event, t),
       ].filter(Boolean).join('\n'), t('automatic.openChannel'), channelUrl))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('automatic.window')}`,
          `${timestamp(event.windowStartedAt, 'T')} - ${timestamp(event.windowExpiresAt, 'T')}`,
        ].join('\n'))
      );

    const aiLines = aiVisionLines(event, t);
    if (aiLines) {
      container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(aiLines.join('\n')));
    }

    container
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(moderationStateLines.join('\n'))
      );

    if (event.appealMessage) {
      container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `### ${t('automatic.appeal')}`,
            event.appealMessage,
          ].join('\n'))
        );
    }

    if (includeActions && event.status === 'danger') {
      container
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${t('automatic.adminHint')}`)
        )
        .addSeparatorComponents(divider())
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${REMOVE_TIMEOUT_PREFIX}:${event.id}`)
              .setLabel(t('automatic.removeTimeout'))
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${BAN_PREFIX}:${event.id}`)
              .setLabel(t('automatic.banUser'))
              .setStyle(ButtonStyle.Danger),
            deleteEvidenceButton(event, t)
          )
        );
    } else if (includeActions) {
      container
        .addSeparatorComponents(divider())
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            deleteEvidenceButton(event, t)
          )
        );
    }

    return {
      flags: MessageFlags.IsComponentsV2 | (options.ephemeral === true ? MessageFlags.Ephemeral : 0),
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  async function getModeratableMember(message) {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member?.moderatable) return null;
    return member;
  }

  async function getLogChannel(guild, config) {
    if (!config.logChannelId) return null;
    const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }

  async function loadSessionFromDb(guildId, userId, config, messageAtMs) {
    const messageAt = new Date(messageAtMs);
    const windowEvent = await configStore.getAutomaticSpamDetectionWindowEventForMessage(
      guildId,
      userId,
      messageAt
    );
    if (windowEvent) {
      return {
        startedAtMs: windowEvent.windowStartedAt.getTime(),
        windowExpiresAtMs: windowEvent.windowExpiresAt.getTime(),
        windowEventId: windowEvent.id,
        events: windowEvent.channels.map((channelId) => ({ channelId })),
      };
    }

    const row = await configStore.getAutomaticSpamDetectionUser(guildId, userId);
    if (!row?.lastAlertAt) return null;

    const startedAtMs = row.lastAlertAt.getTime();
    const windowMs = config.attachmentSpamWindowSeconds * 1000;
    const persistedWindowExpiresAtMs = row.lastAlertWindowExpiresAt?.getTime();
    const windowExpiresAtMs = Number.isFinite(persistedWindowExpiresAtMs)
      ? persistedWindowExpiresAtMs
      : startedAtMs + windowMs;
    if (!Number.isFinite(startedAtMs) || messageAtMs < startedAtMs || messageAtMs > windowExpiresAtMs) return null;

    return {
      startedAtMs,
      windowExpiresAtMs,
      windowEventId: null,
      events: [
        {
          messageId: row.lastMessageId,
          channelId: row.lastChannelId,
          attachmentCount: config.attachmentSpamThreshold,
          timestampMs: startedAtMs,
          protected: row.lastAlertProtected,
        },
      ].filter((event) => event.channelId),
    };
  }

  async function timeoutUser(guild, member, event, config) {
    const configuredTimeoutMs = Number(config.attachmentSpamTimeoutMinutes) * 60 * 1000;
    const timeoutMs = Math.min(
      Number.isFinite(configuredTimeoutMs) ? Math.max(60_000, Math.floor(configuredTimeoutMs)) : 60_000,
      DISCORD_TIMEOUT_MAX_MS
    );
    const timeoutUntil = new Date(Date.now() + timeoutMs);
    const alreadyTimedOutUntil = existingTimeoutUntil(member);
    if (alreadyTimedOutUntil) {
      logger.info('Automatic Spam Detection user already timed out', {
        guildId: guild.id,
        userId: member.id,
        eventId: event.id,
        timeoutUntil: alreadyTimedOutUntil.toISOString(),
      });
      return { timeoutStatus: 'already_active', timeoutUntil: alreadyTimedOutUntil, timeoutError: null };
    }

    try {
      await member.timeout(timeoutMs, `Automatic Spam Detection event ${event.id}`);
      return { timeoutStatus: 'applied', timeoutUntil, timeoutError: null };
    } catch (error) {
      logger.warn(isUnknownMemberError(error)
        ? 'Automatic Spam Detection user is no longer in guild'
        : 'Failed to timeout automatic spam detection user', {
        guildId: guild.id,
        userId: member.id,
        eventId: event.id,
        error: safeError(error),
      });
      return { timeoutStatus: 'failed', timeoutUntil: null, timeoutError: safeError(error) };
    }
  }

  async function sendDangerMessage(guild, config, event, userState) {
    const logChannel = await getLogChannel(guild, config);
    if (!logChannel) {
      logger.warn('Automatic Spam Detection danger has no log channel', {
        guildId: guild.id,
        eventId: event.id,
      });
      return null;
    }

    const message = await logChannel.send(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to send Automatic Spam Detection danger card', {
        guildId: guild.id,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
    if (!message) return null;
    return configStore.updateAutomaticSpamDetectionReviewMessage(event.id, logChannel.id, message.id).catch(() => event);
  }

  function buildAiVisionWarningPayload(event, config = {}) {
    const t = createTranslator(config.language);
    const messageUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}/${event.sourceMessageId}`;
    const container = new ContainerBuilder()
      .setAccentColor(0xf59e0b)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('automatic.aiVisionWarningTitle')}`,
          `-# ${t('automatic.eventId')}: \`${event.id}\``,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
         `### ${t('automatic.incident')}`,
         `**${t('automatic.user')}:** <@${event.userId}> (\`${event.userId}\`)`,
         `**${t('automatic.triggerMessage')}:** ${messageUrl}`,
         ...aggregateEvidenceLines(event, t),
       ].join('\n'), t('automatic.openMessage'), messageUrl));

    const lines = aiVisionLines(event, t);
    if (lines) {
      container
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }

    container
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${t('automatic.aiVisionNoTimeout')}`)
      );

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { parse: [] },
    };
  }

  async function sendAiVisionWarningMessage(guild, config, event) {
    const logChannel = await getLogChannel(guild, config);
    if (!logChannel) {
      logger.warn('AI Verdict warning has no log channel', {
        guildId: guild.id,
        eventId: event.id,
      });
      return null;
    }
    const message = await logChannel.send(buildAiVisionWarningPayload(event, config)).catch((error) => {
      logger.error('Failed to send AI Verdict warning card', {
        guildId: guild.id,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
    if (!message) return null;
    return configStore.updateAutomaticSpamDetectionReviewMessage(event.id, logChannel.id, message.id).catch(() => event);
  }

  async function sendAiVisionDailyLimitResetMessage(guild, config, usageDate) {
    const logChannel = await getLogChannel(guild, config);
    if (!logChannel) return null;
    const t = createTranslator(config.language);
    return logChannel.send({
      content: [
        `### ${t('automatic.aiVisionDailyLimitResetTitle')}`,
        t('automatic.aiVisionDailyLimitResetBody', {
          date: usageDate,
          timezone: config.timezone,
          limit: `${config.aiVisionDailyLimit}/day`,
        }),
      ].join('\n'),
      allowedMentions: { parse: [] },
    }).catch((error) => {
      logger.warn('Failed to send AI Verdict daily limit reset notice', {
        guildId: guild.id,
        usageDate,
        error: safeError(error),
      });
      return null;
    });
  }

  async function updateStoredDangerMessage(event) {
    if (!event?.reviewChannelId || !event.reviewMessageId) return null;
    const guild = client.guilds.cache.get(event.guildId) || await client.guilds.fetch(event.guildId).catch(() => null);
    if (!guild) return null;
    const channel = guild.channels.cache.get(event.reviewChannelId)
      || await guild.channels.fetch(event.reviewChannelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const message = channel.messages.cache.get(event.reviewMessageId)
      || await channel.messages.fetch(event.reviewMessageId).catch(() => null);
    if (!message) return null;
    const userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => null);
    const config = await getConfig(event.guildId).catch(() => ({}));
    return message.edit(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to update Automatic Spam Detection danger card', {
        guildId: event.guildId,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
  }

  async function updateStoredAiVisionWarningMessage(event) {
    if (!event?.reviewChannelId || !event.reviewMessageId) return null;
    const guild = client.guilds.cache.get(event.guildId) || await client.guilds.fetch(event.guildId).catch(() => null);
    if (!guild) return null;
    const channel = guild.channels.cache.get(event.reviewChannelId)
      || await guild.channels.fetch(event.reviewChannelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const message = channel.messages.cache.get(event.reviewMessageId)
      || await channel.messages.fetch(event.reviewMessageId).catch(() => null);
    if (!message) return null;
    const config = await getConfig(event.guildId).catch(() => ({}));
    return message.edit(buildAiVisionWarningPayload(event, config)).catch((error) => {
      logger.error('Failed to update AI Verdict warning card', {
        guildId: event.guildId,
        eventId: event.id,
        error: safeError(error),
      });
      return null;
    });
  }

  async function sendOrUpdateEventMessage(event) {
    const eventId = Number(event?.id);
    if (!Number.isFinite(eventId)) return null;

    const previous = eventMessageQueueByEvent.get(eventId) || Promise.resolve();
    const current = previous
      .catch(() => null)
      .then(async () => {
        const latestEvent = await configStore.getAutomaticSpamDetectionEventById(eventId).catch((error) => {
          logger.error('Failed to load Automatic Spam Detection event for card update', {
            eventId,
            error: safeError(error),
          });
          return null;
        });
        if (!latestEvent) return null;
        return latestEvent.dangerConfirmedAt
          ? updateStoredDangerMessage(latestEvent)
          : updateStoredAiVisionWarningMessage(latestEvent);
      });
    eventMessageQueueByEvent.set(eventId, current);
    try {
      return await current;
    } finally {
      if (eventMessageQueueByEvent.get(eventId) === current) {
        eventMessageQueueByEvent.delete(eventId);
      }
    }
  }

  function scheduleEventMessageUpdate(event, retryAttempt = 0) {
    const eventId = Number(event?.id);
    if (!Number.isFinite(eventId)) return;
    const delay = retryAttempt === 0
      ? EVENT_MESSAGE_UPDATE_DEBOUNCE_MS
      : EVENT_MESSAGE_UPDATE_RETRY_DELAYS_MS[retryAttempt - 1];
    if (!Number.isFinite(delay)) return;

    const existingTimer = eventMessageUpdateTimerByEvent.get(eventId);
    if (retryAttempt > 0 && existingTimer) return;
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
      eventMessageUpdateTimerByEvent.delete(eventId);
      const updatedMessage = await sendOrUpdateEventMessage(event).catch((error) => {
        logger.error('Failed to run deferred Automatic Spam Detection card update', {
          eventId,
          error: safeError(error),
        });
        return null;
      });
      if (!updatedMessage && !eventMessageUpdateTimerByEvent.has(eventId)) {
        scheduleEventMessageUpdate(event, retryAttempt + 1);
      }
    }, delay);
    timer.unref?.();
    eventMessageUpdateTimerByEvent.set(eventId, timer);
  }

  const moderationWorkflow = createModerationWorkflow({
    client,
    source: 'autospam',
    getConfig,
    isGuildAllowed,
    loadEvent: (eventId) => configStore.getAutomaticSpamDetectionEventById(eventId),
    saveAppeal: (eventId, message) => configStore.markAutomaticSpamDetectionAppealed(eventId, message),
    updateReviewMessage: sendOrUpdateEventMessage,
  });

  async function recordAlert(message, config, messageAt, windowExpiresAt, protectedEvidence) {
    await configStore.recordAutomaticSpamDetectionAlert({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      alertAt: messageAt,
      windowExpiresAt,
      protectedEvidence,
    });
    logger.info('Attachment spam alert recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      threshold: config.attachmentSpamThreshold,
      windowSeconds: config.attachmentSpamWindowSeconds,
    });
  }

  async function claimDetectionEvent({ message, danger, evidenceMessages }) {
    return configStore.claimAutomaticSpamDetectionWindowEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      sourceChannelId: message.channelId,
      sourceMessageId: message.id,
      attachmentCount: message.attachments.size,
      reason: danger.reason,
      channels: danger.channels,
      windowStartedAt: danger.windowStartedAt,
      windowExpiresAt: danger.windowExpiresAt,
      evidenceMessages,
    });
  }

  async function handleConfirmedDanger({ message, member, config, event, aiVision = {} }) {
    const dangerConfirmedAt = message.createdAt || new Date();
    const confirmed = await configStore.confirmAutomaticSpamDetectionDanger({
      eventId: event.id,
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      dangerAt: dangerConfirmedAt,
      aiVisionStatus: aiVision.aiVisionStatus,
      aiVisionModel: aiVision.aiVisionModel,
    });
    if (!confirmed?.event) throw new Error(`Automatic Spam Detection window event ${event.id} could not be confirmed.`);
    let updatedEvent = confirmed.event;
    let userState = confirmed.user;

    const timeoutResult = await timeoutUser(message.guild, member, updatedEvent, config);
    updatedEvent = await configStore.updateAutomaticSpamDetectionTimeout(updatedEvent.id, timeoutResult).catch(() => ({
      ...updatedEvent,
      ...timeoutResult,
    }));
    userState = await configStore.getAutomaticSpamDetectionUser(updatedEvent.guildId, updatedEvent.userId).catch(() => userState);

    await moderationWorkflow.sendTimeoutDm({ userId: message.author.id, guildName: message.guild.name, eventId: updatedEvent.id, config });

    const storedEvent = await sendDangerMessage(message.guild, config, updatedEvent, userState);
    logger.warn('Attachment spam danger recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: updatedEvent.id,
      timeoutStatus: updatedEvent.timeoutStatus,
    });
    return storedEvent || updatedEvent;
  }

  async function recordWindowFollowup(message, eventId, messageAt, config, protectedEvidence) {
    let updatedEvent = await configStore.withGuildConfigLock(
      message.guild.id,
      (_currentConfig, dbClient) => configStore.appendAutomaticSpamDetectionWindowFollowup({
        eventId,
        guildId: message.guild.id,
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
        attachmentCount: message.attachments?.size || 0,
        messageAt,
        protectedEvidence,
      }, dbClient)
    );
    if (!updatedEvent) return null;

    if (
      updatedEvent.dangerConfirmedAt
      && updatedEvent.timeoutStatus === 'failed'
      && String(updatedEvent.timeoutError || '').includes('INVALID_COMMUNICATION_DISABLED_TIMESTAMP')
    ) {
      const member = await getModeratableMember(message);
      if (member) {
        const timeoutResult = await timeoutUser(message.guild, member, updatedEvent, config);
        updatedEvent = await configStore.updateAutomaticSpamDetectionTimeout(updatedEvent.id, timeoutResult)
          .catch(() => ({ ...updatedEvent, ...timeoutResult }));
      }
    }

    scheduleEventMessageUpdate(updatedEvent);
    logger.info('Attachment spam follow-up added to existing detection event', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: updatedEvent.id,
      followupMessageCount: updatedEvent.followupMessageCount,
      followupAttachmentCount: updatedEvent.followupAttachmentCount,
    });
    return updatedEvent;
  }

  async function eventWindowContainsMessage(eventId, messageAtMs) {
    const event = await configStore.getAutomaticSpamDetectionEventById(eventId);
    if (!event?.windowStartedAt || !event.windowExpiresAt) return false;
    return messageAtMs >= event.windowStartedAt.getTime()
      && messageAtMs <= event.windowExpiresAt.getTime();
  }

  async function saveAiVisionResult(event, aiVision) {
    const updatedEvent = await configStore.updateAutomaticSpamDetectionAiVisionResult(event.id, aiVision);
    if (!updatedEvent) throw new Error(`Automatic Spam Detection event ${event.id} AI result could not be saved.`);
    await sendOrUpdateEventMessage(updatedEvent);
    return updatedEvent;
  }

  async function handleAiVisionEvidence({ message, config, event }) {
    const checkedAt = new Date();
    const image = firstSupportedImageAttachment(message.attachments);
    const model = visionChecker?.model || OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    let quotaUsageDate = null;
    let shouldSendResetNotice = false;

    if (!visionChecker) {
      return saveAiVisionResult(event, {
        aiVisionStatus: 'failed',
        aiVisionModel: model,
        aiVisionError: 'OPENROUTER_API_KEY or GEMINI_API_KEY is not configured.',
        aiVisionCheckedAt: checkedAt,
      });
    }

    if (!image) {
      return saveAiVisionResult(event, {
        aiVisionStatus: 'failed',
        aiVisionModel: model,
        aiVisionError: 'No supported image attachment found on trigger message.',
        aiVisionCheckedAt: checkedAt,
      });
    }

    if (!await isAiVisionDailyLimitBypassed(message.guild.id)) {
      const usageDate = localDateString(checkedAt, config.timezone);
      const usage = await configStore.reserveAiVisionDailyUsageForEvent(
        event.id,
        message.guild.id,
        usageDate,
        config.aiVisionDailyLimit
      ).catch((error) => {
        logger.error('Failed to reserve AI Verdict daily usage', {
          guildId: message.guild.id,
          usageDate,
          error: safeError(error),
        });
        return null;
      });

      const reservedUsageDate = usage?.usageDate || usageDate;
      if (!usage?.allowed) {
        const updatedEvent = await saveAiVisionResult(event, {
          aiVisionStatus: 'daily_limit_reached',
          aiVisionModel: model,
          aiVisionImageUrl: image.url,
          aiVisionError: `Daily AI Verdict limit reached for ${reservedUsageDate} (${usage?.usedCount || config.aiVisionDailyLimit}/${usage?.limit || config.aiVisionDailyLimit}) in ${config.timezone}.`,
          aiVisionCheckedAt: checkedAt,
        });
        logger.warn('AI Verdict daily limit reached', {
          guildId: message.guild.id,
          usageDate: reservedUsageDate,
          timezone: config.timezone,
          limit: usage?.limit || config.aiVisionDailyLimit,
        });
        return updatedEvent;
      }

      quotaUsageDate = reservedUsageDate;
      shouldSendResetNotice = usage.usedCount === 1;
    } else {
      logger.info('AI Verdict daily limit bypassed for allowlisted guild', {
        guildId: message.guild.id,
      });
    }

    let vision;
    try {
      vision = await visionChecker.analyzeAttachment(image, {
        triggerWords: config.aiVisionTriggerWords,
      });
    } catch (error) {
      let quotaRefunded = false;
      if (quotaUsageDate && error?.unbilledAiVision) {
        const refund = await configStore.refundAiVisionDailyUsageForEvent(
          event.id,
          message.guild.id,
          quotaUsageDate
        ).catch((refundError) => {
          logger.error('Failed to refund unbilled AI Verdict daily usage', {
            guildId: message.guild.id,
            userId: message.author.id,
            eventId: event.id,
            usageDate: quotaUsageDate,
            error: safeError(refundError),
          });
          return null;
        });
        quotaRefunded = refund?.refunded === true;
        if (quotaRefunded) {
          logger.info('Refunded AI Verdict daily usage after unbilled provider rejection', {
            guildId: message.guild.id,
            userId: message.author.id,
            eventId: event.id,
            usageDate: quotaUsageDate,
            usedCount: refund.usedCount,
          });
        }
      }
      if (shouldSendResetNotice && !quotaRefunded) {
        await sendAiVisionDailyLimitResetMessage(message.guild, config, quotaUsageDate);
      }
      logger.warn('AI Verdict image analysis failed', {
        guildId: message.guild.id,
        channelId: message.channelId,
        userId: message.author.id,
        messageId: message.id,
        imageUrl: image.url,
        model,
        error: safeError(error),
        rawAiResponse: error?.rawAiResponse || null,
        cleanedAiResponse: error?.cleanedAiResponse || null,
        firstRawAiResponse: error?.firstRawAiResponse || null,
        firstCleanedAiResponse: error?.firstCleanedAiResponse || null,
      });
      return saveAiVisionResult(event, {
        aiVisionStatus: 'failed',
        aiVisionModel: model,
        aiVisionImageUrl: image.url,
        aiVisionError: safeError(error),
        aiVisionCheckedAt: checkedAt,
      });
    }

    if (shouldSendResetNotice) {
      await sendAiVisionDailyLimitResetMessage(message.guild, config, quotaUsageDate);
    }

    const decision = decideScamFromVision(
      vision,
      config.aiVisionTriggerWords,
      config.aiVisionConfidenceThreshold
    );
    const baseAiVision = {
      aiVisionModel: vision.model || model,
      aiVisionImageUrl: vision.imageUrl || image.url,
      aiVisionConfidence: decision.confidence,
      aiVisionCaption: vision.caption,
      aiVisionOcrText: vision.ocrText,
      aiVisionMatchedWords: decision.matchedWords,
      aiVisionCheckedAt: checkedAt,
    };

    const aiVisionStatus = decision.hasEnoughConfidence ? 'no_match' : 'low_confidence';
    const updatedEvent = await saveAiVisionResult(event, {
      ...baseAiVision,
      aiVisionStatus: decision.isScam ? 'matched' : aiVisionStatus,
    });

    logger.info('AI Verdict evidence added to Automatic Spam Detection event', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: updatedEvent.id,
      verdict: updatedEvent.aiVisionStatus,
      confidence: decision.confidence,
    });
    return updatedEvent;
  }

  async function handleQueuedAiVisionEvidence({ message, eventId }) {
    if (cancelledAiVisionEventIds.has(eventId)) return null;
    const event = await configStore.getAutomaticSpamDetectionEventById(eventId);
    if (!event || event.aiVisionStatus !== 'pending') return event;
    const config = await configStore.getSpamCatcherConfig(message.guild.id);
    if (
      event.status === 'admin_reset'
      || !config.automaticSpamDetectionEnabled
      || !config.aiVisionSpamCheckEnabled
    ) {
      return saveAiVisionResult(event, {
        aiVisionStatus: 'failed',
        aiVisionModel: event.aiVisionModel || visionChecker?.model || OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        aiVisionError: 'AI Verdict cancelled because the feature or incident is no longer active.',
        aiVisionCheckedAt: new Date(),
      });
    }
    return handleAiVisionEvidence({ message, config, event });
  }

  async function handleDanger({ message, member, config, event }) {
    const model = visionChecker?.model || OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    const dangerEvent = await handleConfirmedDanger({
      message,
      member,
      config,
      event,
      aiVision: config.aiVisionSpamCheckEnabled
        ? { aiVisionStatus: 'pending', aiVisionModel: model }
        : {},
    });
    if (dangerEvent.aiVisionStatus === 'pending') {
      const task = runQueuedAiVision(
        message.guild.id,
        dangerEvent.id,
        () => handleQueuedAiVisionEvidence({ message, eventId: dangerEvent.id })
      );
      aiVisionTaskByEvent.set(dangerEvent.id, {
        authorKey: authorKey(message.guild.id, message.author.id),
        guildId: message.guild.id,
        task,
      });
      task.catch((error) => {
        logger.error('Background AI Verdict processing failed', {
          guildId: message.guild.id,
          channelId: message.channelId,
          userId: message.author.id,
          eventId: dangerEvent.id,
          error: safeError(error),
        });
      }).finally(() => {
        aiVisionTaskByEvent.delete(dangerEvent.id);
      });
    }
    return dangerEvent;
  }

  async function handleQueuedMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    if (!isGuildAllowed(message.guild.id)) return;

    let config = await getConfig(message.guild.id).catch((error) => {
      logger.error('Failed to load Automatic Spam Detection config', {
        guildId: message.guild.id,
        error: safeError(error),
      });
      return null;
    });
    if (!config?.automaticSpamDetectionEnabled) return;
    if (config.enabled && config.channelIds.includes(message.channelId)) return;
    const configGeneration = configGenerationByGuild.get(message.guild.id) || 0;
    const configChanged = () => (configGenerationByGuild.get(message.guild.id) || 0) !== configGeneration;

    const attachmentCount = message.attachments?.size || 0;
    if (attachmentCount < config.attachmentSpamThreshold) return;
    config = await configStore.withGuildConfigLock(
      message.guild.id,
      async (currentConfig) => currentConfig
    );
    if (!config.automaticSpamDetectionEnabled) return;
    const protectedEvidence = config.channelIds.includes(message.channelId);
    if (config.enabled && protectedEvidence) return;
    if (attachmentCount < config.attachmentSpamThreshold) return;

    const messageAt = message.createdAt || new Date();
    const messageAtMs = messageAt.getTime();
    const windowMs = config.attachmentSpamWindowSeconds * 1000;
    const key = authorKey(message.guild.id, message.author.id);
    let session = attachmentSessionByAuthor.get(key);
    if (!session) {
      session = await loadSessionFromDb(message.guild.id, message.author.id, config, messageAtMs);
    }

    const currentEvent = {
      messageId: message.id,
      channelId: message.channelId,
      attachmentCount,
      timestampMs: messageAtMs,
      protected: protectedEvidence,
    };

    const windowExpiresAtMs = session?.windowExpiresAtMs || (session ? session.startedAtMs + windowMs : 0);
    let hasActiveSession = Boolean(
      session
      && messageAtMs >= session.startedAtMs
      && messageAtMs <= windowExpiresAtMs
    );
    if (hasActiveSession && session.windowEventId) {
      if (configChanged()) return;
      const updatedEvent = await recordWindowFollowup(
        message,
        session.windowEventId,
        messageAt,
        config,
        protectedEvidence
      );
      if (updatedEvent) return;
      if (await eventWindowContainsMessage(session.windowEventId, messageAtMs)) return;
      attachmentSessionByAuthor.delete(key);
      session = null;
      hasActiveSession = false;
    }

    const member = await getModeratableMember(message);
    if (!member) return;

    if (hasActiveSession) {
      if (configChanged()) return;
      const channels = [...new Set([...session.events.map((item) => item.channelId), message.channelId].filter(Boolean))];
      session.events.push(currentEvent);
      attachmentSessionByAuthor.set(key, session);
      const danger = {
        reason: channels.length >= 2
          ? 'same_author_2plus_attachments_in_2plus_channels'
          : 'same_author_repeated_2plus_attachments_in_window',
        channels,
        windowStartedAt: new Date(session.startedAtMs),
        windowExpiresAt: new Date(windowExpiresAtMs),
      };
      const claim = await claimDetectionEvent({
        message,
        danger,
        evidenceMessages: [...session.events],
      });
      if (!claim.event) throw new Error('Automatic Spam Detection window event could not be claimed.');
      if (configChanged()) {
        if (claim.claimed) {
          await configStore.updateAutomaticSpamDetectionDecision(
            claim.event.id,
            'admin_reset',
            null,
            'Guild configuration changed before Danger processing began.'
          );
        }
        return;
      }
      session.windowEventId = claim.event.id;
      if (!claim.claimed) {
        const updatedEvent = await recordWindowFollowup(
          message,
          claim.event.id,
          messageAt,
          config,
          protectedEvidence
        );
        if (updatedEvent || await eventWindowContainsMessage(claim.event.id, messageAtMs)) return;
        attachmentSessionByAuthor.delete(key);
        attachmentSessionByAuthor.set(key, {
          startedAtMs: messageAtMs,
          windowExpiresAtMs: messageAtMs + windowMs,
          windowEventId: null,
          events: [currentEvent],
        });
        await recordAlert(message, config, messageAt, new Date(messageAtMs + windowMs), protectedEvidence);
        return;
      }

      await handleDanger({
        message,
        member,
        config,
        event: claim.event,
      });
      return;
    }

    attachmentSessionByAuthor.set(key, {
      startedAtMs: messageAtMs,
      windowExpiresAtMs: messageAtMs + windowMs,
      windowEventId: null,
      events: [currentEvent],
    });
    if (configChanged()) {
      attachmentSessionByAuthor.delete(key);
      return;
    }
    await recordAlert(message, config, messageAt, new Date(messageAtMs + windowMs), protectedEvidence);
  }

  async function handleMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    const key = authorKey(message.guild.id, message.author.id);
    const previous = messageQueueByAuthor.get(key) || Promise.resolve();
    const current = previous
      .catch(() => null)
      .then(() => handleQueuedMessage(message));
    messageQueueByAuthor.set(key, current);
    try {
      await current;
    } finally {
      if (messageQueueByAuthor.get(key) === current) {
        messageQueueByAuthor.delete(key);
      }
    }
  }

  async function requireAdmin(interaction) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    const config = await getConfig(interaction.guildId).catch(() => ({}));
    const t = createTranslator(config.language);
    await interaction.reply({
      content: t('automatic.adminOnlyAction'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    }).catch(() => null);
    return false;
  }

  async function getInteractionEvent(interaction) {
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    if (!Number.isFinite(eventId)) return null;
    const event = await configStore.getAutomaticSpamDetectionEventById(eventId).catch(() => null);
    if (!event || event.guildId !== interaction.guildId || !isGuildAllowed(event.guildId)) return null;
    return event;
  }

  async function requireLatestOpenDanger(interaction, event) {
    const latest = await configStore.getLatestOpenAutomaticSpamDetectionDangerEvent(
      event.guildId,
      event.userId
    ).catch((error) => {
      logger.error('Failed to check latest Automatic Spam Detection danger event', {
        guildId: event.guildId,
        userId: event.userId,
        eventId: event.id,
        error: safeError(error),
      });
      return undefined;
    });
    if (latest === undefined) {
      const config = await getConfig(event.guildId).catch(() => ({}));
      const t = createTranslator(config.language);
      await interaction.reply({
        content: t('automatic.latestEventVerificationFailed'),
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }
    if (!latest) {
      const config = await getConfig(event.guildId).catch(() => ({}));
      const t = createTranslator(config.language);
      await interaction.reply({
        content: t('automatic.eventAlreadyResolved'),
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }
    if (latest.id !== event.id) {
      const config = await getConfig(event.guildId).catch(() => ({}));
      const t = createTranslator(config.language);
      await interaction.reply({
        content: t('automatic.newerEventActive', { eventId: latest.id }),
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
      return false;
    }
    return true;
  }

  async function getLockedDangerActionEvent(event, dbClient) {
    const current = await configStore.getAutomaticSpamDetectionEventById(event.id, dbClient);
    if (
      !current
      || current.guildId !== event.guildId
      || current.userId !== event.userId
      || current.status !== 'danger'
    ) {
      return { current, actionable: false };
    }
    const latest = await configStore.getLatestOpenAutomaticSpamDetectionDangerEvent(
      current.guildId,
      current.userId,
      dbClient
    );
    return { current, actionable: latest?.id === current.id };
  }

  async function handleDeleteEvidence(interaction) {
    if (!await requireAdmin(interaction)) return;
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    if (!Number.isFinite(eventId) || !isGuildAllowed(interaction.guildId)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let result;
    try {
      result = await runGuildConfigOperation(interaction.guildId, async () => {
        let event = await configStore.getAutomaticSpamDetectionEventById(eventId);
        if (event && event.guildId !== interaction.guildId) throw new Error('Evidence belongs to another guild.');
        if (event?.aiVisionStatus === 'pending') {
          if (aiVisionTaskByEvent.has(event.id)) return { aiPending: true };
          event = await configStore.updateAutomaticSpamDetectionAiVisionResult(event.id, {
            aiVisionStatus: 'failed',
            aiVisionModel: event.aiVisionModel,
            aiVisionError: 'AI Verdict was interrupted before evidence deletion.',
            aiVisionCheckedAt: new Date(),
          });
          if (!event) throw new Error('Interrupted AI Verdict state could not be closed.');
        }

        const deletionResult = await configStore.withGuildConfigLock(
          interaction.guildId,
          async (config, dbClient) => {
            const references = await configStore.getAutomaticSpamDetectionEvidenceMessages(eventId, dbClient);
            if (references.some((reference) => reference.guildId !== interaction.guildId)) {
              throw new Error('Evidence belongs to another guild.');
            }
            if (!event && references.length === 0) return { notFound: true };
            const trapChannelIds = new Set(config.channelIds);
            const deletedMessageIds = [];
            let deleted = 0;
            let preserved = 0;
            let alreadyDeleted = 0;
            let failed = 0;

            for (const reference of references) {
              if (reference.deletedAt) {
                alreadyDeleted += 1;
                continue;
              }
              if (reference.protected || trapChannelIds.has(reference.channelId)) {
                preserved += 1;
                continue;
              }
              try {
                const channel = interaction.guild.channels.cache.get(reference.channelId)
                  || await interaction.guild.channels.fetch(reference.channelId);
                if (!channel?.isTextBased() || !channel.messages?.delete) {
                  throw new Error('Evidence channel is not a deletable text channel.');
                }
                await channel.messages.delete(
                  reference.messageId,
                  `Deleted by ${interaction.user.id} from Automatic Spam Detection event ${eventId}`
                );
                deletedMessageIds.push(reference.messageId);
                deleted += 1;
              } catch (error) {
                if (isEvidenceAlreadyGone(error)) {
                  deletedMessageIds.push(reference.messageId);
                  alreadyDeleted += 1;
                  continue;
                }
                failed += 1;
                logger.warn('Failed to delete Automatic Spam Detection evidence from card action', {
                  guildId: interaction.guildId,
                  eventId,
                  channelId: reference.channelId,
                  messageId: reference.messageId,
                  adminId: interaction.user.id,
                  error: safeError(error),
                });
              }
            }
            await Promise.all(deletedMessageIds.map((messageId) => (
              configStore.markAutomaticSpamDetectionEvidenceDeleted(eventId, messageId, dbClient)
            )));
            const completedEvent = references.length > 0 && failed === 0 && event
              ? await configStore.completeAutomaticSpamDetectionEvidenceDeletion(
                eventId,
                interaction.guildId,
                interaction.user.id,
                dbClient
              )
              : null;
            return { deleted, preserved, alreadyDeleted, failed, deletedMessageIds, completedEvent };
          }
        );
        const {
          deletedMessageIds: _deletedMessageIds,
          completedEvent,
          ...summary
        } = deletionResult;
        return { ...summary, completedEvent };
      });
    } catch (error) {
      await interaction.editReply({
        content: `Evidence deletion stopped: \`${safeError(error)}\`. Press **Delete Evidence** again to retry any remaining messages.`,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (result.notFound) {
      await interaction.editReply({ content: 'No stored evidence was found for this incident.' });
      return;
    }
    if (result.aiPending) {
      await interaction.editReply({
        content: 'AI Verdict is still reading the trigger image. Press **Delete Evidence** again after it finishes.',
      });
      return;
    }
    const { completedEvent, ...logResult } = result;
    logger.info('Automatic Spam Detection evidence deletion requested from card', {
      guildId: interaction.guildId,
      eventId,
      adminId: interaction.user.id,
      ...logResult,
    });
    if (completedEvent) {
      const updatedMessage = await sendOrUpdateEventMessage(completedEvent).catch((error) => {
        logger.warn('Failed to disable completed Automatic Spam Detection evidence button', {
          guildId: interaction.guildId,
          eventId,
          error: safeError(error),
        });
        return null;
      });
      if (!updatedMessage) scheduleEventMessageUpdate(completedEvent, 1);
    }
    await interaction.editReply({
      content: [
        'Evidence deletion finished.',
        `Deleted: \`${result.deleted}\``,
        `Already deleted or unavailable: \`${result.alreadyDeleted}\``,
        `Failed: \`${result.failed}\``,
        result.failed > 0 ? 'Grant the bot Manage Messages in the affected channels, then press the button again.' : null,
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] },
    });
  }

  async function handleShowDetails(interaction) {
    if (!await requireAdmin(interaction)) return;
    const config = await getConfig(interaction.guildId);
    const t = createTranslator(config.language);
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({
        content: t('automatic.eventNotFound'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      }).catch(() => null);
      return;
    }
    const userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => null);
    await interaction.reply(buildDangerPayload(event, userState, config, {
      forceDetailed: true,
      includeActions: false,
      ephemeral: true,
    }));
  }

  async function handleRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction)) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!await requireLatestOpenDanger(interaction, event)) return;

    await interaction.deferUpdate().catch(() => null);
    const result = await configStore.withAutomaticSpamDetectionEventLock(event.id, async (dbClient) => {
      const locked = await getLockedDangerActionEvent(event, dbClient);
      if (!locked.actionable) return { stale: true, updated: locked.current };

      let updated = locked.current;
      try {
        const guild = await client.guilds.fetch(updated.guildId);
        const member = await guild.members.fetch(updated.userId).catch((error) => {
          if (isUnknownMemberError(error)) return null;
          throw error;
        });
        if (!member) {
          updated = await configStore.resolveAutomaticSpamDetectionEventAndCloseWindow(
            updated.id,
            {
              guildId: updated.guildId,
              userId: updated.userId,
              status: 'user_unavailable',
              decidedBy: interaction.user.id,
              decisionError: 'User is no longer in this guild.',
            },
            dbClient
          );
        } else {
          await member.timeout(null, `Automatic Spam Detection timeout removed by ${interaction.user.id}`);
          updated = await configStore.resolveAutomaticSpamDetectionEventAndCloseWindow(updated.id, {
            guildId: updated.guildId,
            userId: updated.userId,
            status: 'timeout_removed',
            decidedBy: interaction.user.id,
          }, dbClient);
        }
        if (!updated) return { stale: true, updated: locked.current };
        attachmentSessionByAuthor.delete(authorKey(updated.guildId, updated.userId));
      } catch (error) {
        updated = await configStore.updateAutomaticSpamDetectionDecision(
          locked.current.id,
          'timeout_remove_failed',
          interaction.user.id,
          safeError(error),
          dbClient,
          'danger'
        ).catch(() => null);
        if (!updated) return { stale: true, updated: locked.current };
      }
      return { stale: false, updated };
    });
    if (result.updated) await sendOrUpdateEventMessage(result.updated);
  }

  async function handleBanUser(interaction) {
    if (!await requireAdmin(interaction)) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (!await requireLatestOpenDanger(interaction, event)) return;

    const config = await getConfig(event.guildId);
    const t = createTranslator(config.language);
    await interaction.reply({
      content: t('automatic.banConfirmation', { userId: event.userId }),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${BAN_CONFIRM_PREFIX}:${event.id}:${interaction.user.id}`)
            .setLabel(t('automatic.confirmBan'))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`${BAN_CANCEL_PREFIX}:${event.id}:${interaction.user.id}`)
            .setLabel(t('automatic.cancelBan'))
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  async function handleCancelBanUser(interaction) {
    if (!await requireAdmin(interaction)) return;
    const [, , requesterId] = interaction.customId.split(':');
    const config = await getConfig(interaction.guildId);
    const t = createTranslator(config.language);
    if (requesterId !== interaction.user.id) {
      await interaction.reply({
        content: t('automatic.banConfirmationOwnerMismatch'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      }).catch(() => null);
      return;
    }
    await interaction.update({
      content: t('automatic.banCancelled'),
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  async function handleConfirmBanUser(interaction) {
    if (!await requireAdmin(interaction)) return;
    const [, , requesterId] = interaction.customId.split(':');
    const config = await getConfig(interaction.guildId);
    const t = createTranslator(config.language);
    if (requesterId !== interaction.user.id) {
      await interaction.reply({
        content: t('automatic.banConfirmationOwnerMismatch'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      }).catch(() => null);
      return;
    }

    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.update({ content: t('automatic.eventNotFound'), components: [] }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.update({ content: t('automatic.eventAlreadyResolved'), components: [] }).catch(() => null);
      return;
    }
    if (!await requireLatestOpenDanger(interaction, event)) return;

    await interaction.deferUpdate().catch(() => null);
    const result = await configStore.withAutomaticSpamDetectionEventLock(event.id, async (dbClient) => {
      const locked = await getLockedDangerActionEvent(event, dbClient);
      if (!locked.actionable) return { stale: true, updated: locked.current };

      let updated = locked.current;
      try {
        const guild = await client.guilds.fetch(updated.guildId);
        await guild.members.ban(updated.userId, {
          reason: `Automatic Spam Detection event ${updated.id}`,
          deleteMessageSeconds: 0,
        });
        updated = await configStore.resolveAutomaticSpamDetectionEventAndCloseWindow(updated.id, {
          guildId: updated.guildId,
          userId: updated.userId,
          status: 'banned',
          decidedBy: interaction.user.id,
        }, dbClient);
        if (!updated) return { stale: true, updated: locked.current };
        attachmentSessionByAuthor.delete(authorKey(updated.guildId, updated.userId));
      } catch (error) {
        updated = await configStore.updateAutomaticSpamDetectionDecision(
          locked.current.id,
          'ban_failed',
          interaction.user.id,
          safeError(error),
          dbClient,
          'danger'
        ).catch(() => null);
        if (!updated) return { stale: true, updated: locked.current };
      }
      return { stale: false, updated };
    });
    if (result.updated) await sendOrUpdateEventMessage(result.updated);
    await interaction.editReply({
      content: result.stale
        ? t('automatic.eventAlreadyResolved')
        : result.updated?.status === 'banned'
        ? t('automatic.banCompleted')
        : t('automatic.banFailedConfirmation'),
      components: [],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }

  async function handleInteraction(interaction) {
    if (await moderationWorkflow.handleInteraction(interaction)) {
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_PREFIX}:`)) {
      await handleRemoveTimeout(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_CONFIRM_PREFIX}:`)) {
      await handleConfirmBanUser(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_CANCEL_PREFIX}:`)) {
      await handleCancelBanUser(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_PREFIX}:`)) {
      await handleBanUser(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${DELETE_EVIDENCE_PREFIX}:`)) {
      await handleDeleteEvidence(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${SHOW_DETAILS_PREFIX}:`)) {
      await handleShowDetails(interaction);
      return true;
    }
    return false;
  }

  async function runUserStateReset(guildId, userId, resetTask) {
    const key = authorKey(guildId, userId);
    const previous = messageQueueByAuthor.get(key) || Promise.resolve();
    const current = previous
      .catch(() => null)
      .then(async () => {
        attachmentSessionByAuthor.delete(key);
        const aiTasks = [...aiVisionTaskByEvent.entries()]
          .filter(([, value]) => value.authorKey === key);
        for (const [eventId] of aiTasks) cancelledAiVisionEventIds.add(eventId);
        const cancelledQueuedTasks = [];
        const activeAiTasks = [];
        for (const [eventId, value] of aiTasks) {
          const queueEntry = cancelQueuedAiVision(value.guildId, eventId);
          if (queueEntry) cancelledQueuedTasks.push({
            eventId,
            guildId: value.guildId,
            queueEntry,
            task: value.task,
          });
          else activeAiTasks.push([eventId, value]);
        }
        try {
          await Promise.allSettled(activeAiTasks.map(([, value]) => value.task));
          const result = await resetTask();
          for (const { queueEntry } of cancelledQueuedTasks) queueEntry.resolve(null);
          await Promise.allSettled(cancelledQueuedTasks.map(({ task }) => task));
          return result;
        } catch (error) {
          for (const { guildId: taskGuildId, queueEntry } of cancelledQueuedTasks) {
            restoreQueuedAiVision(taskGuildId, queueEntry);
          }
          throw error;
        } finally {
          for (const [eventId] of aiTasks) cancelledAiVisionEventIds.delete(eventId);
          attachmentSessionByAuthor.delete(key);
        }
      });
    messageQueueByAuthor.set(key, current);
    try {
      return await current;
    } finally {
      if (messageQueueByAuthor.get(key) === current) {
        messageQueueByAuthor.delete(key);
      }
    }
  }

  function invalidateGuildConfig(guildId) {
    configCache.delete(guildId);
    configGenerationByGuild.set(guildId, (configGenerationByGuild.get(guildId) || 0) + 1);
  }

  return {
    handleMessage,
    handleInteraction,
    runUserStateReset,
    invalidateGuildConfig,
  };
}

module.exports = { createAutomaticSpamDetectionManager };
