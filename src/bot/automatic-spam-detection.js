const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { parseAllowedGuildIds } = require('./env');
const { createLogger } = require('../lib/logger');

const BAN_PREFIX = 'autospam_ban';
const REMOVE_TIMEOUT_PREFIX = 'autospam_remove_timeout';
const CONFIG_CACHE_TTL_MS = 5000;
const DISCORD_TIMEOUT_MAX_MS = 28 * 24 * 60 * 60 * 1000;

function createAutomaticSpamDetectionManager({ client, configStore }) {
  const allowedGuildIds = parseAllowedGuildIds();
  const configCache = new Map();
  const attachmentSessionByAuthor = new Map();
  const messageQueueByAuthor = new Map();
  const logger = createLogger('automatic-spam-detection');

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

  function timestamp(date, style = 'R') {
    if (!date) return null;
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
  }

  function formatMinutes(minutes) {
    const safeMinutes = Math.max(1, Math.floor(Number(minutes) || 1));
    if (safeMinutes % 1440 === 0) {
      const days = safeMinutes / 1440;
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (safeMinutes % 60 === 0) {
      const hours = safeMinutes / 60;
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
  }

  function reasonText(reason) {
    if (reason === 'same_author_2plus_attachments_in_2plus_channels') {
      return 'Same user sent 2 or more attachments in multiple channels within the active 10-minute window.';
    }
    return 'Same user sent 2 or more attachments more than once within the active 10-minute window.';
  }

  function statusText(event) {
    if (event.status === 'banned') return `Banned by <@${event.decidedBy}>.`;
    if (event.status === 'timeout_removed') return `Timeout removed by <@${event.decidedBy}>.`;
    if (event.status === 'ban_failed') return `Ban failed: ${event.decisionError || 'unknown error'}`;
    if (event.status === 'timeout_remove_failed') return `Timeout removal failed: ${event.decisionError || 'unknown error'}`;
    return 'Waiting for admin action.';
  }

  function eventAccentColor(event) {
    if (event.status === 'danger') return 0xef4444;
    if (event.status === 'banned' || event.status === 'ban_failed') return 0x7f1d1d;
    if (event.status === 'timeout_remove_failed') return 0xf59e0b;
    return 0x22c55e;
  }

  function buildDangerPayload(event, userState) {
    const messageUrl = `https://discord.com/channels/${event.guildId}/${event.sourceChannelId}/${event.sourceMessageId}`;
    const channelList = event.channels.length > 0
      ? event.channels.map((channelId) => `<#${channelId}>`).join(', ')
      : `<#${event.sourceChannelId}>`;
    const timeoutLine = event.timeoutStatus === 'applied'
      ? `Timeout: **applied** until ${timestamp(event.timeoutUntil)}`
      : event.timeoutStatus === 'failed'
        ? `Timeout: **failed** (${event.timeoutError || 'unknown error'})`
        : 'Timeout: **pending**';

    const container = new ContainerBuilder()
      .setAccentColor(eventAccentColor(event))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          '# Danger: Attachment Spam',
          `User: <@${event.userId}> (\`${event.userId}\`)`,
          `Reason: **${reasonText(event.reason)}**`,
          '',
          `Source channel: <#${event.sourceChannelId}>`,
          `Trigger message: ${messageUrl}`,
          `Attachments on trigger message: \`${event.attachmentCount}\``,
          `Channels in window: ${channelList}`,
          `Window: ${timestamp(event.windowStartedAt, 'T')} - ${timestamp(event.windowExpiresAt, 'T')}`,
        ].join('\n'))
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `Spammer state: \`${userState?.spammer ? '1' : '0'}\``,
          `Spammer count: \`${userState?.spammerCount || 0}\``,
          timeoutLine,
          `Status: **${statusText(event)}**`,
          `Event ID: \`${event.id}\``,
        ].join('\n'))
      );

    if (event.status === 'danger') {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${REMOVE_TIMEOUT_PREFIX}:${event.id}`)
              .setLabel('Remove Timeout')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`${BAN_PREFIX}:${event.id}`)
              .setLabel('Ban User')
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
    try {
      await member.timeout(timeoutMs, `Automatic Spam Detection event ${event.id}`);
      return { timeoutStatus: 'applied', timeoutUntil, timeoutError: null };
    } catch (error) {
      logger.warn('Failed to timeout automatic spam detection user', {
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

    const message = await logChannel.send(buildDangerPayload(event, userState)).catch((error) => {
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

  async function handleDanger({ message, member, config, danger }) {
    let userState = await configStore.markAutomaticSpamDetectionDangerUser({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      dangerAt: message.createdAt || new Date(),
    });

    let event = await configStore.createAutomaticSpamDetectionEvent({
      guildId: message.guild.id,
      userId: message.author.id,
      sourceChannelId: message.channelId,
      sourceMessageId: message.id,
      attachmentCount: message.attachments.size,
      reason: danger.reason,
      channels: danger.channels,
      windowStartedAt: danger.windowStartedAt,
      windowExpiresAt: danger.windowExpiresAt,
    });

    const timeoutResult = await timeoutUser(message.guild, member, event, config);
    event = await configStore.updateAutomaticSpamDetectionTimeout(event.id, timeoutResult).catch(() => ({
      ...event,
      ...timeoutResult,
    }));
    userState = await configStore.getAutomaticSpamDetectionUser(event.guildId, event.userId).catch(() => userState);

    await sendDangerMessage(message.guild, config, event, userState);
    logger.warn('Attachment spam danger recorded', {
      guildId: message.guild.id,
      channelId: message.channelId,
      userId: message.author.id,
      eventId: event.id,
      timeoutStatus: event.timeoutStatus,
    });
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
    await interaction.editReply(buildDangerPayload(event, userState)).catch((error) => {
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
      const member = await guild.members.fetch(event.userId);
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
