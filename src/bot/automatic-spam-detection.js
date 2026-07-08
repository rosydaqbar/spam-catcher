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
const REMOVE_TIMEOUT_PREFIX = 'autospam_remove_timeout';
const CONFIG_CACHE_TTL_MS = 5000;
const DISCORD_TIMEOUT_MAX_MS = 28 * 24 * 60 * 60 * 1000;
const AI_VISION_CAPTION_MAX_LENGTH = 220;
const AI_VISION_OCR_MAX_LENGTH = 350;
const AI_VISION_GUILD_CONCURRENCY = 2;

function createAutomaticSpamDetectionManager({ client, configStore }) {
  const allowedGuildIds = parseAllowedGuildIds();
  const aiVisionDailyLimitBypassGuildIds = parseAiVisionDailyLimitBypassGuildIds();
  const configCache = new Map();
  const attachmentSessionByAuthor = new Map();
  const messageQueueByAuthor = new Map();
  const aiVisionQueueByGuild = new Map();
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

  function authorKey(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function safeError(error) {
    return String(error?.message || error || 'Unknown error').slice(0, 500);
  }

  function isUnknownMemberError(error) {
    return error?.code === 10007 || safeError(error).toLowerCase().includes('unknown member');
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

  function runQueuedAiVision(guildId, task) {
    let state = aiVisionQueueByGuild.get(guildId);
    if (!state) {
      state = { active: 0, queue: [] };
      aiVisionQueueByGuild.set(guildId, state);
    }

    return new Promise((resolve, reject) => {
      const runNext = () => {
        if (state.active >= AI_VISION_GUILD_CONCURRENCY || state.queue.length === 0) return;
        const next = state.queue.shift();
        state.active += 1;
        Promise.resolve()
          .then(next.task)
          .then(next.resolve, next.reject)
          .finally(() => {
            state.active -= 1;
            if (state.active === 0 && state.queue.length === 0) aiVisionQueueByGuild.delete(guildId);
            runNext();
          });
      };

      state.queue.push({ task, resolve, reject });
      runNext();
    });
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
    if (event.status === 'ai_analysis_failed') return t('automatic.statusAiAnalysisFailed');
    if (event.status === 'ai_daily_limit_reached') return t('automatic.statusAiDailyLimitReached');
    if (event.status === 'ai_low_confidence') return t('automatic.statusAiLowConfidence');
    if (event.status === 'ai_no_match') return t('automatic.statusAiNoMatch');
    return t('automatic.statusWaiting');
  }

  function aiVisionStatusText(event, t) {
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

  function buildDangerPayload(event, userState, config = {}) {
    const t = createTranslator(config.language);
    const messageUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}/${event.sourceMessageId}`;
    const channelUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}`;
    const channelList = event.channels.length > 0
      ? event.channels.map((channelId) => `<#${channelId}>`).join(', ')
      : `<#${event.sourceChannelId}>`;
      const timeoutLine = event.timeoutStatus === 'applied'
      ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutApplied')}\` ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'already_active'
        ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutAlreadyActive')}\` ${t('automatic.until')} ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'failed'
        ? `**${t('automatic.timeout')}:** \`${t('automatic.timeoutFailed')}\` (\`${event.timeoutError || 'unknown error'}\`)`
        : `**${t('automatic.timeout')}:** \`${t('automatic.timeoutPending')}\``;

    const container = new ContainerBuilder()
      .setAccentColor(eventAccentColor(event))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('automatic.dangerTitle')}`,
          `-# ${t('automatic.eventId')}: \`${event.id}\``,
        ].join('\n'))
      )
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
        `### ${t('automatic.incident')}`,
        `**${t('automatic.user')}:** <@${event.userId}> (\`${event.userId}\`)`,
        `**${t('automatic.reason')}:** \`${reasonText(event.reason, t)}\``,
      ].join('\n'), t('automatic.openMessage'), messageUrl))
      .addSeparatorComponents(divider())
      .addSectionComponents(sectionWithLink([
        `### ${t('automatic.evidence')}`,
        `**${t('automatic.sourceChannel')}:** <#${event.sourceChannelId}>`,
        `**${t('automatic.attachmentsOnTrigger')}:** \`${event.attachmentCount}\``,
        `**${t('automatic.channelsInWindow')}:** ${channelList}`,
      ].join('\n'), t('automatic.openChannel'), channelUrl))
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
        new TextDisplayBuilder().setContent([
          `### ${t('automatic.moderationState')}`,
          `**${t('automatic.spammerState')}:** \`${spammerStateText(userState, t)}\``,
          `**${t('automatic.spammerCount')}:** \`${userState?.spammerCount || 0}\``,
          timeoutLine,
          `**${t('automatic.status')}:** ${statusText(event, t)}`,
        ].filter(Boolean).join('\n'))
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

    if (event.status === 'danger') {
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
              .setStyle(ButtonStyle.Danger)
          )
        );
    }

    return {
      flags: MessageFlags.IsComponentsV2,
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
    const row = await configStore.getAutomaticSpamDetectionUser(guildId, userId).catch(() => null);
    if (!row?.lastAlertAt) return null;

    const startedAtMs = row.lastAlertAt.getTime();
    const windowMs = config.attachmentSpamWindowSeconds * 1000;
    if (!Number.isFinite(startedAtMs) || messageAtMs - startedAtMs > windowMs) return null;

    return {
      startedAtMs,
      events: [
        {
          messageId: row.lastMessageId,
          channelId: row.lastChannelId,
          attachmentCount: config.attachmentSpamThreshold,
          timestampMs: startedAtMs,
        },
      ].filter((event) => event.channelId),
    };
  }

  async function timeoutUser(guild, member, event, config) {
    const timeoutMs = Math.min(config.attachmentSpamTimeoutMinutes * 60 * 1000, DISCORD_TIMEOUT_MAX_MS);
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
        `**${t('automatic.attachmentsOnTrigger')}:** \`${event.attachmentCount}\``,
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

  async function sendOrUpdateDangerMessage(event) {
    if (!event?.reviewChannelId || !event.reviewMessageId) return null;
    const guild = client.guilds.cache.get(event.guildId) || await client.guilds.fetch(event.guildId).catch(() => null);
    if (!guild) return null;
    const channel = await guild.channels.fetch(event.reviewChannelId).catch(() => null);
    if (!channel?.isTextBased()) return null;
    const message = await channel.messages.fetch(event.reviewMessageId).catch(() => null);
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

  const moderationWorkflow = createModerationWorkflow({
    client,
    source: 'autospam',
    getConfig,
    isGuildAllowed,
    loadEvent: (eventId) => configStore.getAutomaticSpamDetectionEventById(eventId),
    saveAppeal: (eventId, message) => configStore.markAutomaticSpamDetectionAppealed(eventId, message),
    updateReviewMessage: sendOrUpdateDangerMessage,
  });

  async function recordAlert(message, config, messageAt) {
    await configStore.recordAutomaticSpamDetectionAlert({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      alertAt: messageAt,
    });
    logger.info('Attachment spam alert recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      threshold: config.attachmentSpamThreshold,
      windowSeconds: config.attachmentSpamWindowSeconds,
    });
  }

  async function createDetectionEvent({ message, danger, status = 'danger', aiVision = {} }) {
    return configStore.createAutomaticSpamDetectionEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      sourceChannelId: message.channelId,
      sourceMessageId: message.id,
      attachmentCount: message.attachments.size,
      reason: danger.reason,
      channels: danger.channels,
      windowStartedAt: danger.windowStartedAt,
      windowExpiresAt: danger.windowExpiresAt,
      status,
      ...aiVision,
    });
  }

  async function handleConfirmedDanger({ message, member, config, danger, aiVision = {} }) {
    let userState = await configStore.markAutomaticSpamDetectionDangerUser({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      dangerAt: message.createdAt || new Date(),
    });

    let event = await createDetectionEvent({ message, danger, status: 'danger', aiVision });

    const timeoutResult = await timeoutUser(message.guild, member, event, config);
    event = await configStore.updateAutomaticSpamDetectionTimeout(event.id, timeoutResult).catch(() => ({
      ...event,
      ...timeoutResult,
    }));
    userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => userState);

    await moderationWorkflow.sendTimeoutDm({ userId: message.author.id, guildName: message.guild.name, eventId: event.id, config });

    await sendDangerMessage(message.guild, config, event, userState);
    logger.warn('Attachment spam danger recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: event.id,
      timeoutStatus: event.timeoutStatus,
    });
  }

  async function handleAiVisionDanger({ message, member, config, danger }) {
    const checkedAt = new Date();
    const image = firstSupportedImageAttachment(message.attachments);
    const model = visionChecker?.model || OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

    if (!visionChecker) {
      const event = await createDetectionEvent({
        message,
        danger,
        status: 'ai_analysis_failed',
        aiVision: {
          aiVisionStatus: 'failed',
          aiVisionModel: model,
          aiVisionError: 'OPENROUTER_API_KEY or GEMINI_API_KEY is not configured.',
          aiVisionCheckedAt: checkedAt,
        },
      });
      await sendAiVisionWarningMessage(message.guild, config, event);
      return;
    }

    if (!image) {
      const event = await createDetectionEvent({
        message,
        danger,
        status: 'ai_analysis_failed',
        aiVision: {
          aiVisionStatus: 'failed',
          aiVisionModel: model,
          aiVisionError: 'No supported image attachment found on trigger message.',
          aiVisionCheckedAt: checkedAt,
        },
      });
      await sendAiVisionWarningMessage(message.guild, config, event);
      return;
    }

    if (!aiVisionDailyLimitBypassGuildIds.has(message.guild.id)) {
      const usageDate = localDateString(checkedAt, config.timezone);
      const usage = await configStore.tryConsumeAiVisionDailyUsage(
        message.guild.id,
        usageDate,
        config.aiVisionDailyLimit
      ).catch((error) => {
        logger.error('Failed to consume AI Verdict daily usage', {
          guildId: message.guild.id,
          usageDate,
          error: safeError(error),
        });
        return null;
      });

      if (!usage?.allowed) {
        const event = await createDetectionEvent({
          message,
          danger,
          status: 'ai_daily_limit_reached',
          aiVision: {
            aiVisionStatus: 'daily_limit_reached',
            aiVisionModel: model,
            aiVisionImageUrl: image.url,
            aiVisionError: `Daily AI Verdict limit reached for ${usageDate} (${usage?.usedCount || config.aiVisionDailyLimit}/${usage?.limit || config.aiVisionDailyLimit}) in ${config.timezone}.`,
            aiVisionCheckedAt: checkedAt,
          },
        });
        await sendAiVisionWarningMessage(message.guild, config, event);
        logger.warn('AI Verdict daily limit reached', {
          guildId: message.guild.id,
          usageDate,
          timezone: config.timezone,
          limit: usage?.limit || config.aiVisionDailyLimit,
        });
        return;
      }

      if (usage.usedCount === 1) {
        await sendAiVisionDailyLimitResetMessage(message.guild, config, usageDate);
      }
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
      const event = await createDetectionEvent({
        message,
        danger,
        status: 'ai_analysis_failed',
        aiVision: {
          aiVisionStatus: 'failed',
          aiVisionModel: model,
          aiVisionImageUrl: image.url,
          aiVisionError: safeError(error),
          aiVisionCheckedAt: checkedAt,
        },
      });
      await sendAiVisionWarningMessage(message.guild, config, event);
      return;
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

    if (decision.isScam) {
      await handleConfirmedDanger({
        message,
        member,
        config,
        danger,
        aiVision: {
          ...baseAiVision,
          aiVisionStatus: 'matched',
        },
      });
      return;
    }

    const status = decision.hasEnoughConfidence ? 'ai_no_match' : 'ai_low_confidence';
    const aiVisionStatus = decision.hasEnoughConfidence ? 'no_match' : 'low_confidence';
    const event = await createDetectionEvent({
      message,
      danger,
      status,
      aiVision: {
        ...baseAiVision,
        aiVisionStatus,
      },
    });

    if (!decision.hasEnoughConfidence) {
      await sendAiVisionWarningMessage(message.guild, config, event);
      return;
    }

    logger.info('AI Verdict checked trigger message and found no scam keywords', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: event.id,
      confidence: decision.confidence,
    });
  }

  async function handleDanger({ message, member, config, danger }) {
    if (config.aiVisionSpamCheckEnabled) {
      await runQueuedAiVision(message.guild.id, () => handleAiVisionDanger({ message, member, config, danger }));
      return;
    }
    await handleConfirmedDanger({ message, member, config, danger });
  }

  async function handleQueuedMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return;
    if (!isGuildAllowed(message.guild.id)) return;

    const config = await getConfig(message.guild.id).catch((error) => {
      logger.error('Failed to load Automatic Spam Detection config', {
        guildId: message.guild.id,
        error: safeError(error),
      });
      return null;
    });
    if (!config?.automaticSpamDetectionEnabled) return;

    const attachmentCount = message.attachments?.size || 0;
    if (attachmentCount < config.attachmentSpamThreshold) return;

    const member = await getModeratableMember(message);
    if (!member) return;

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
    };

    if (session && messageAtMs - session.startedAtMs <= windowMs) {
      const channels = [...new Set([...session.events.map((item) => item.channelId), message.channelId].filter(Boolean))];
      session.events.push(currentEvent);
      attachmentSessionByAuthor.set(key, session);
      await handleDanger({
        message,
        member,
        config,
        danger: {
          reason: channels.length >= 2
            ? 'same_author_2plus_attachments_in_2plus_channels'
            : 'same_author_repeated_2plus_attachments_in_window',
          channels,
          windowStartedAt: new Date(session.startedAtMs),
          windowExpiresAt: new Date(session.startedAtMs + windowMs),
        },
      });
      return;
    }

    attachmentSessionByAuthor.set(key, {
      startedAtMs: messageAtMs,
      events: [currentEvent],
    });
    await recordAlert(message, config, messageAt);
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

  async function requireAdmin(interaction, action) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    await interaction.reply({
      content: `Only users with Administrator permission can ${action}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
    return false;
  }

  async function getInteractionEvent(interaction) {
    const [, eventIdRaw] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    if (!Number.isFinite(eventId)) return null;
    const event = await configStore.getAutomaticSpamDetectionEventById(eventId).catch(() => null);
    if (!event || !isGuildAllowed(event.guildId)) return null;
    return event;
  }

  async function editDangerMessage(interaction, event) {
    const userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => null);
    const config = await getConfig(event.guildId).catch(() => ({}));
    await interaction.editReply(buildDangerPayload(event, userState, config)).catch((error) => {
      logger.error('Failed to edit Automatic Spam Detection danger card', {
        guildId: event.guildId,
        eventId: event.id,
        error: safeError(error),
      });
    });
  }

  async function handleRemoveTimeout(interaction) {
    if (!await requireAdmin(interaction, 'remove Automatic Spam Detection timeouts')) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.deferUpdate().catch(() => null);
    let updated = event;
    try {
      const guild = await client.guilds.fetch(event.guildId);
      const member = await guild.members.fetch(event.userId).catch((error) => {
        if (isUnknownMemberError(error)) return null;
        throw error;
      });
      if (!member) {
        await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
        updated = await configStore.updateAutomaticSpamDetectionDecision(
          event.id,
          'user_unavailable',
          interaction.user.id,
          'User is no longer in this guild.'
        );
        await editDangerMessage(interaction, updated || event);
        return;
      }
      await member.timeout(null, `Automatic Spam Detection timeout removed by ${interaction.user.id}`);
      await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
      updated = await configStore.updateAutomaticSpamDetectionDecision(event.id, 'timeout_removed', interaction.user.id);
    } catch (error) {
      updated = await configStore.updateAutomaticSpamDetectionDecision(
        event.id,
        'timeout_remove_failed',
        interaction.user.id,
        safeError(error)
      ).catch(() => ({ ...event, status: 'timeout_remove_failed', decidedBy: interaction.user.id, decisionError: safeError(error) }));
    }
    await editDangerMessage(interaction, updated || event);
  }

  async function handleBanUser(interaction) {
    if (!await requireAdmin(interaction, 'ban Automatic Spam Detection users')) return;
    const event = await getInteractionEvent(interaction);
    if (!event) {
      await interaction.reply({ content: 'Automatic Spam Detection event not found.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    if (event.status !== 'danger') {
      await interaction.reply({ content: 'This Automatic Spam Detection event is already resolved.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await interaction.deferUpdate().catch(() => null);
    let updated = event;
    try {
      const guild = await client.guilds.fetch(event.guildId);
      await guild.members.ban(event.userId, {
        reason: `Automatic Spam Detection event ${event.id}`,
        deleteMessageSeconds: 0,
      });
      await configStore.resetAutomaticSpamDetectionSpammer(event.guildId, event.userId);
      updated = await configStore.updateAutomaticSpamDetectionDecision(event.id, 'banned', interaction.user.id);
    } catch (error) {
      updated = await configStore.updateAutomaticSpamDetectionDecision(
        event.id,
        'ban_failed',
        interaction.user.id,
        safeError(error)
      ).catch(() => ({ ...event, status: 'ban_failed', decidedBy: interaction.user.id, decisionError: safeError(error) }));
    }
    await editDangerMessage(interaction, updated || event);
  }

  async function handleInteraction(interaction) {
    if (await moderationWorkflow.handleInteraction(interaction)) {
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${REMOVE_TIMEOUT_PREFIX}:`)) {
      await handleRemoveTimeout(interaction);
      return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${BAN_PREFIX}:`)) {
      await handleBanUser(interaction);
      return true;
    }
    return false;
  }

  return {
    handleMessage,
    handleInteraction,
  };
}

module.exports = { createAutomaticSpamDetectionManager };
