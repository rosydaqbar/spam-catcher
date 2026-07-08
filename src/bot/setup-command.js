const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { createLogger } = require('../lib/logger');
const { GEMINI_API_KEY, OPENROUTER_API_KEY, parseAllowedGuildIds } = require('./env');
const { createTranslator, languageName, normalizeLanguage } = require('./i18n');
const { buildTrapNoticePayload } = require('./trap-notice-payload');

const COMMAND_NAME = 'spam-catcher';
const SETUP_PREFIX = 'spamsetup';
const AI_VISION_WORDS_MODAL = `${SETUP_PREFIX}:aivision_words_modal`;
const logger = createLogger('spam-catcher-setup');

const TIMEOUT_OPTIONS = [
  { label: '10 Minutes', value: '10' },
  { label: '30 Minutes', value: '30' },
  { label: '1 Hour', value: '60' },
  { label: '6 Hours', value: '360' },
  { label: '12 Hours', value: '720' },
  { label: '1 Day', value: '1440' },
  { label: '3 Days', value: '4320' },
  { label: '7 Days', value: '10080' },
  { label: '14 Days', value: '20160' },
  { label: '28 Days', value: '40320' },
];

const APPEAL_WINDOW_OPTIONS = [
  { label: '10 Minutes', value: '10' },
  { label: '30 Minutes', value: '30' },
  { label: '1 Hour', value: '60' },
  { label: '2 Hours', value: '120' },
  { label: '6 Hours', value: '360' },
  { label: '12 Hours', value: '720' },
  { label: '24 Hours', value: '1440' },
];

function createSetupCommandManager({ client, configStore }) {
  function commandData() {
    return new SlashCommandBuilder()
      .setName(COMMAND_NAME)
      .setDescription('Manage Spam Catcher for this server')
      .addSubcommand((subcommand) => subcommand
        .setName('help')
        .setDescription('Show Spam Catcher commands and features'))
      .addSubcommand((subcommand) => subcommand
        .setName('setup')
        .setDescription('Open the Spam Catcher setup panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator))
      .addSubcommand((subcommand) => subcommand
        .setName('lang')
        .setDescription('Set the Spam Catcher interface language')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option
          .setName('language')
          .setDescription('Language to use for Spam Catcher UI in this server')
          .setRequired(true)
          .addChoices(
            { name: 'English', value: 'en' },
            { name: 'Indonesia', value: 'id' }
          )))
      .addSubcommand((subcommand) => subcommand
        .setName('check')
        .setDescription('Check spam status for a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) => option
          .setName('user')
          .setDescription('User to check')
          .setRequired(true)))
      .toJSON();
  }

  async function registerCommands() {
    if (!client.application) {
      logger.warn('Application command refresh skipped: client application is not ready.');
      return;
    }

    const commands = [commandData()];
    const connectedGuildIds = [...client.guilds.cache.keys()].sort();
    const allowedGuildIds = [...parseAllowedGuildIds()].sort();
    const meta = {
      scope: 'global',
      commandNames: commands.map((command) => command.name),
      guildIds: connectedGuildIds,
      allowedGuildIds,
      note: 'Global refresh; Discord propagates commands to guilds.',
    };

    logger.info('Refreshing application commands on startup', meta);
    const refreshed = await client.application.commands.set(commands);
    logger.info('Application commands refreshed on startup', {
      ...meta,
      refreshedCommandIds: refreshed.map((command) => command.id),
    });
  }

  function buildInfoPayload(title, body, { ephemeral = true } = {}) {
    return {
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [
        new ContainerBuilder()
          .setAccentColor(0xf59e0b)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              `### ${title}`,
              body,
            ].join('\n'))
          ),
      ],
      allowedMentions: { parse: [] },
    };
  }

  function isAdmin(interaction) {
    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
  }

  async function requireAdmin(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply(buildInfoPayload('⚙️ Spam Catcher Setup', '⚠️ Run this command inside a Discord server.')).catch(() => null);
      return false;
    }
    if (!isAdmin(interaction)) {
      await interaction.reply(buildInfoPayload('⚙️ Spam Catcher Setup', '🔒 Only users with Administrator permission can configure Spam Catcher.')).catch(() => null);
      return false;
    }
    return true;
  }

  function mentionChannels(ids) {
    if (!ids?.length) return '`not set`';
    return ids.map((id) => `<#${id}>`).join(', ');
  }

  function mentionChannel(id) {
    return id ? `<#${id}>` : '`not set`';
  }

  function mentionChannelsLocalized(ids, t) {
    if (!ids?.length) return `\`${t('setup.notSet')}\``;
    return ids.map((id) => `<#${id}>`).join(', ');
  }

  function mentionChannelLocalized(id, t) {
    return id ? `<#${id}>` : `\`${t('setup.notSet')}\``;
  }

  function formatMinutes(minutes, language = 'en') {
    const safeMinutes = Math.max(1, Math.floor(Number(minutes) || 1));
    if (safeMinutes % 1440 === 0) {
      const days = safeMinutes / 1440;
      if (normalizeLanguage(language) === 'id') return `${days} hari`;
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (safeMinutes % 60 === 0) {
      const hours = safeMinutes / 60;
      if (normalizeLanguage(language) === 'id') return `${hours} jam`;
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (normalizeLanguage(language) === 'id') return `${safeMinutes} menit`;
    return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
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

  async function getAiVisionQuotaInfo(guildId, config) {
    const usageDate = localDateString(new Date(), config.timezone);
    const usedCount = await configStore.getAiVisionDailyUsage(guildId, usageDate).catch(() => null);
    return {
      usageDate,
      usedCount,
      limit: config.aiVisionDailyLimit,
      timezone: config.timezone,
    };
  }

  function outcomeLabel(config) {
    const t = createTranslator(config.language);
    const timeout = formatMinutes(config.timeoutMinutes, config.language);
    const delay = formatMinutes(config.banDelayMinutes, config.language);
    if (!config.autoBanEnabled) return t('setup.timeoutOnlyOutcome', { timeout });
    if (config.banMode === 'immediate') return t('setup.banImmediateOutcome');
    if (config.banMode === 'after_timeout') return t('setup.banAfterTimeoutOutcome', { timeout });
    return t('setup.banDelayedOutcome', { timeout, delay });
  }

  function setupStatus(config) {
    const t = createTranslator(config.language);
    const missing = [];
    if (!config.channelIds.length) missing.push(t('setup.trapChannel'));
    if (!config.reviewChannelId) missing.push(t('setup.reviewChannel'));
    if (!config.logChannelId) missing.push(t('setup.logChannel'));
    if (!missing.length) return config.enabled ? t('setup.readyEnabled') : t('setup.readyDisabled');
    return t('setup.incomplete', { items: missing.join(', ') });
  }

  function isConfigReady(config) {
    return Boolean(config.channelIds.length > 0 && config.reviewChannelId && config.logChannelId);
  }

  function selectOptions(options, currentValue) {
    const current = Number(currentValue);
    return options.map((option) => ({
      ...option,
      default: Number(option.value) === current,
    }));
  }

  function buttonSection(title, body, button) {
    return new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${title}`,
          body,
        ].filter(Boolean).join('\n'))
      )
      .setButtonAccessory(button);
  }

  function isAutomaticSpamDetectionReady(config) {
    return Boolean(config.logChannelId);
  }

  function buildComponentPayload(components, { ephemeral = false } = {}) {
    return {
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components,
      allowedMentions: { parse: [] },
    };
  }

  function statusSuffix(statusMessage, config) {
    if (!statusMessage) return '';
    const t = createTranslator(config?.language);
    return `\n-# ${t('setup.lastAction')}: ${statusMessage}`;
  }

  function openPanelButton(panel, label, style = ButtonStyle.Primary) {
    return new ButtonBuilder()
      .setCustomId(`${SETUP_PREFIX}:panel:${panel}`)
      .setLabel(label)
      .setStyle(style);
  }

  function spamCatcherToggleButton(config) {
    const t = createTranslator(config.language);
    const isReady = isConfigReady(config);
    return config.enabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:disable`)
        .setLabel(t('setup.disableSpam'))
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:enable`)
        .setLabel(t('setup.enableSpam'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(!isReady);
  }

  function autoBanToggleButton(config) {
    const t = createTranslator(config.language);
    return config.autoBanEnabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autoban:off`)
        .setLabel(t('setup.autoBanOff'))
        .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autoban:on`)
        .setLabel(t('setup.autoBanOn'))
        .setStyle(ButtonStyle.Danger);
  }

  function automaticSpamDetectionToggleButton(config) {
    const t = createTranslator(config.language);
    return config.automaticSpamDetectionEnabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autodetect:off`)
        .setLabel(t('setup.disableDetection'))
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autodetect:on`)
        .setLabel(t('setup.enableDetection'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(!isAutomaticSpamDetectionReady(config));
  }

  function hasAiVisionKey() {
    return Boolean(
      (typeof OPENROUTER_API_KEY === 'string' && OPENROUTER_API_KEY.trim().length > 0)
      || (typeof GEMINI_API_KEY === 'string' && GEMINI_API_KEY.trim().length > 0)
    );
  }

  function aiVisionToggleButton(config) {
    const t = createTranslator(config.language);
    return config.aiVisionSpamCheckEnabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:aivision:off`)
        .setLabel(t('setup.disableAiVision'))
        .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:aivision:on`)
        .setLabel(t('setup.enableAiVision'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(!hasAiVisionKey());
  }

  function aiVisionTriggerWordsText(config) {
    return config.aiVisionTriggerWords.join('\n').slice(0, 4000);
  }

  function buildDashboardPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const isReady = isConfigReady(config);
    const autoReady = isAutomaticSpamDetectionReady(config);
    const statusLabel = config.enabled ? t('setup.enabledStatus') : isReady ? t('setup.offReadyStatus') : t('setup.offNeedsChannelsStatus');
    const statusAccent = config.enabled ? 0x22c55e : isReady ? 0xf59e0b : 0xef4444;
    const automaticStatus = config.automaticSpamDetectionEnabled
      ? t('setup.enabledStatus')
      : autoReady
        ? t('setup.offReadyStatus')
        : t('setup.offNeedsLogStatus');

    const statusContainer = new ContainerBuilder()
      .setAccentColor(statusAccent)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('setup.dashboardTitle')}`,
          `-# ${t('setup.guild')}: \`${guildId}\``,
          `**🛡️ ${t('setup.status')}:** \`${statusLabel}\`${statusSuffix(statusMessage, config)}`,
          `-# ${t('setup.aiVisionQuota')}: ${config.aiVisionDailyLimit}/day, ${t('setup.timezone')}: ${config.timezone}`,
        ].join('\n'))
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        buttonSection(
          t('setup.spamSummary'),
          [
            `**${t('setup.config')}:** \`${setupStatus(config)}\``,
            `**${t('setup.result')}:** \`${outcomeLabel(config)}\``,
          ].join('\n'),
          openPanelButton('spam', t('setup.openSettings'))
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:refresh`)
            .setLabel(t('setup.refresh'))
            .setStyle(ButtonStyle.Secondary)
        )
      );

    const channelsContainer = new ContainerBuilder()
      .setAccentColor(isReady ? 0x22c55e : 0x3b82f6)
      .addSectionComponents(
        buttonSection(
          t('setup.channelsSummary'),
          [
            `**${t('setup.trap')}:** ${mentionChannelsLocalized(config.channelIds, t)}`,
            `**${t('setup.review')}:** ${mentionChannelLocalized(config.reviewChannelId, t)}`,
            `**${t('setup.log')}:** ${mentionChannelLocalized(config.logChannelId, t)}`,
            `**${t('setup.timeout')}:** \`${formatMinutes(config.timeoutMinutes, config.language)}\``,
          ].join('\n'),
          openPanelButton('channels', t('setup.editChannels'))
        )
      );

    const autoBanContainer = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          t('setup.autoBanSummary'),
          [
            `**${t('setup.status')}:** \`${config.autoBanEnabled ? t('setup.enabledStatus') : '⚪ OFF'}\``,
            `**${t('setup.result')}:** \`${outcomeLabel(config)}\``,
            config.autoBanEnabled && config.banMode === 'delayed'
              ? `**Appeal window:** \`${formatMinutes(config.banDelayMinutes, config.language)}\``
              : null,
          ].filter(Boolean).join('\n'),
          openPanelButton('autoban', t('setup.editAutoBan'), config.autoBanEnabled ? ButtonStyle.Danger : ButtonStyle.Primary)
        )
      );

    const automaticContainer = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0xef4444 : autoReady ? 0xf59e0b : 0x6b7280)
      .addSectionComponents(
        buttonSection(
          t('setup.automaticSummary'),
          [
            `**${t('setup.status')}:** \`${automaticStatus}\``,
            `**Trigger:** \`${config.attachmentSpamThreshold}+ attachments twice within ${formatMinutes(config.attachmentSpamWindowSeconds / 60, config.language)}\``,
            `**Action:** \`timeout for ${formatMinutes(config.attachmentSpamTimeoutMinutes, config.language)}, log Danger card\``,
            `**${t('setup.aiVision')}:** \`${config.aiVisionSpamCheckEnabled ? t('setup.enabledStatus') : '⚪ OFF'}\``,
            `**${t('setup.aiVisionDailyLimit')}:** \`${config.aiVisionDailyLimit}/day\``,
            `**${t('setup.timezone')}:** \`${config.timezone}\``,
            `**${t('setup.log')}:** ${mentionChannelLocalized(config.logChannelId, t)}`,
            `-# ${t('setup.independentDetection')}`,
          ].join('\n'),
          openPanelButton('automatic', t('setup.editDetection'), config.automaticSpamDetectionEnabled ? ButtonStyle.Danger : ButtonStyle.Primary)
        )
      );

    const noticesContainer = new ContainerBuilder()
      .setAccentColor(0x8b5cf6)
      .addSectionComponents(
        buttonSection(
          t('setup.noticesSummary'),
          [
            `**${t('setup.trap')}:** \`${config.channelIds.length}\``,
            isReady
              ? t('setup.postNoticesReady')
              : t('setup.postNoticesNotReady'),
          ].join('\n'),
          openPanelButton('notices', t('setup.openNotices'))
        )
      );

    return buildComponentPayload(
      [statusContainer, channelsContainer, autoBanContainer, automaticContainer, noticesContainer],
      { ephemeral }
    );
  }

  function buildSpamCatcherPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const isReady = isConfigReady(config);
    const statusLabel = config.enabled ? t('setup.enabledStatus') : isReady ? t('setup.offReadyStatus') : t('setup.offNeedsChannelsStatus');
    const container = new ContainerBuilder()
      .setAccentColor(config.enabled ? 0x22c55e : isReady ? 0xf59e0b : 0xef4444)
      .addSectionComponents(
        buttonSection(
          t('setup.openSettings'),
          [
            `**${t('setup.status')}:** \`${statusLabel}\``,
            `**${t('setup.config')}:** \`${setupStatus(config)}\``,
            `**${t('setup.result')}:** \`${outcomeLabel(config)}\``,
            config.enabled
              ? '✅ Trap-channel messages are handled using saved settings.'
              : isReady
                ? '🟡 Settings are saved, but trap-channel messages are ignored until enabled.'
                : '⚠️ Set trap, review, and log channels before enabling.',
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          spamCatcherToggleButton(config)
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildChannelsPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const container = new ContainerBuilder()
      .setAccentColor(isConfigReady(config) ? 0x22c55e : 0x3b82f6)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `## ${t('setup.channelsSummary')}`,
          `**${t('setup.trap')}:** ${mentionChannelsLocalized(config.channelIds, t)}`,
          `**${t('setup.review')}:** ${mentionChannelLocalized(config.reviewChannelId, t)}`,
          `**${t('setup.log')}:** ${mentionChannelLocalized(config.logChannelId, t)}`,
          `**${t('setup.timeout')}:** \`${formatMinutes(config.timeoutMinutes, config.language)}\``,
          `-# ${t('setup.settingsSavedImmediately')}`,
          statusSuffix(statusMessage, config).trim(),
        ].filter(Boolean).join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:trap`)
            .setPlaceholder('Select one or more trap text channels')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(25)
            .setDefaultChannels(config.channelIds)
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:review`)
            .setPlaceholder('Select admin review text channel')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)
            .setDefaultChannels(config.reviewChannelId ? [config.reviewChannelId] : [])
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:log`)
            .setPlaceholder('Select admin log text channel')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)
            .setDefaultChannels(config.logChannelId ? [config.logChannelId] : [])
        )
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `## ${t('setup.timeout')}`,
          `**Current timeout:** \`${formatMinutes(config.timeoutMinutes, config.language)}\``,
          '-# Used by Timeout Only, Ban After Appeal Window, and Ban After Timeout Ends. Ban Immediately skips timeout.',
        ].join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:timeout`)
            .setPlaceholder(`${t('setup.timeout')}: ${formatMinutes(config.timeoutMinutes, config.language)}`)
            .addOptions(selectOptions(TIMEOUT_OPTIONS, config.timeoutMinutes))
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildAutoBanPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const container = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          config.autoBanEnabled ? t('setup.autoBanSummary') : t('setup.autoBanSummary'),
          [
            config.autoBanEnabled
              ? '🔨 Caught users are banned using ban timing below.'
              : '🛡️ Caught users receive timeout only. No automatic ban is scheduled.',
            `**${t('setup.result')}:** \`${outcomeLabel(config)}\``,
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          autoBanToggleButton(config)
        )
      );

    if (config.autoBanEnabled) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            '## 🔨 Ban Timing',
            'Choose when Auto Ban happens.',
          ].join('\n'))
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:delayed`)
              .setLabel('📝 Ban After Appeal Window')
              .setStyle(config.banMode === 'delayed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:immediate`)
              .setLabel('🔨 Ban Immediately')
              .setStyle(config.banMode === 'immediate' ? ButtonStyle.Danger : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:after_timeout`)
              .setLabel('⏳ Ban After Timeout Ends')
              .setStyle(config.banMode === 'after_timeout' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          )
        );
    }

    if (config.autoBanEnabled && config.banMode === 'delayed') {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            '## 📝 Appeal Window',
            `**Current appeal window:** \`${formatMinutes(config.banDelayMinutes, config.language)}\``,
            '-# Shown only for Ban After Appeal Window.',
          ].join('\n'))
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${SETUP_PREFIX}:delay`)
              .setPlaceholder(`Appeal window: ${formatMinutes(config.banDelayMinutes, config.language)}`)
              .addOptions(selectOptions(APPEAL_WINDOW_OPTIONS, config.banDelayMinutes))
          )
        );
    }

    return buildComponentPayload([container], { ephemeral });
  }

  function buildAutomaticSpamDetectionPanelPayload(guildId, config, statusMessage, { ephemeral = false, quotaInfo = null } = {}) {
    const t = createTranslator(config.language);
    const isReady = isAutomaticSpamDetectionReady(config);
    const statusLabel = config.automaticSpamDetectionEnabled ? t('setup.enabledStatus') : isReady ? t('setup.offReadyStatus') : t('setup.offNeedsLogStatus');
    const quotaLine = quotaInfo?.usedCount === null
      ? `**${t('setup.aiVisionQuota')}:** \`${t('setup.notAvailable')}\``
      : `**${t('setup.aiVisionQuota')}:** \`${t('setup.aiVisionQuotaUsed', {
        used: quotaInfo?.usedCount || 0,
        limit: config.aiVisionDailyLimit,
        date: quotaInfo?.usageDate || 'today',
      })}\``;
    const container = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0xef4444 : isReady ? 0xf59e0b : 0x6b7280)
      .addSectionComponents(
        buttonSection(
          t('setup.automaticSummary'),
          [
            `**${t('setup.status')}:** \`${statusLabel}\``,
            `**Trigger:** \`first ${config.attachmentSpamThreshold}+ attachment message starts fixed ${formatMinutes(config.attachmentSpamWindowSeconds / 60, config.language)} window.\``,
            `**Danger:** \`next ${config.attachmentSpamThreshold}+ attachment message by same user inside window.\``,
            `**Action:** \`set spammer=1, increment spammer_count, timeout for ${formatMinutes(config.attachmentSpamTimeoutMinutes, config.language)}, post Danger card to log channel.\``,
            `**${t('setup.log')}:** ${mentionChannelLocalized(config.logChannelId, t)}`,
            '-# Watches all guild channels when enabled. Ignores bots, webhooks, and users bot cannot moderate.',
            `-# ${t('setup.independentDetection')}`,
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          automaticSpamDetectionToggleButton(config)
        )
      );

    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        buttonSection(
          t('setup.aiVision'),
          [
            `**${t('setup.status')}:** \`${config.aiVisionSpamCheckEnabled ? t('setup.enabledStatus') : '⚪ OFF'}\``,
            `**${t('setup.aiVisionConfidence')}:** \`${Math.round(config.aiVisionConfidenceThreshold * 100)}%\``,
            `**${t('setup.aiVisionDailyLimit')}:** \`${config.aiVisionDailyLimit}/day\``,
            quotaLine,
            `**${t('setup.timezone')}:** \`${config.timezone}\``,
            `**${t('setup.aiVisionTriggerWords')}:** \`${config.aiVisionTriggerWords.length}\``,
            `-# ${t('setup.aiVisionFirstImageOnly')}`,
          ].join('\n'),
          aiVisionToggleButton(config)
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:aivision_words`)
            .setLabel(t('setup.editAiVisionTriggerWords'))
            .setStyle(ButtonStyle.Primary)
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  async function buildAutomaticSpamDetectionPanelPayloadWithQuota(guildId, config, statusMessage, options = {}) {
    const quotaInfo = await getAiVisionQuotaInfo(guildId, config);
    return buildAutomaticSpamDetectionPanelPayload(guildId, config, statusMessage, { ...options, quotaInfo });
  }

  function buildNoticesPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const isReady = isConfigReady(config);
    const container = new ContainerBuilder()
      .setAccentColor(0x8b5cf6)
      .addSectionComponents(
        buttonSection(
          t('setup.noticesSummary'),
          [
            'Post or refresh warning message in each trap channel using current timeout and Auto Ban settings.',
            `**${t('setup.trap')}:** ${mentionChannelsLocalized(config.channelIds, t)}`,
            `**${t('setup.language')}:** \`${languageName(config.language)}\``,
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:post_notices`)
            .setLabel(t('setup.postNotices'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isReady)
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildPanelPayload(panel, guildId, config, statusMessage, options = {}) {
    if (panel === 'spam') return buildSpamCatcherPanelPayload(guildId, config, statusMessage, options);
    if (panel === 'channels') return buildChannelsPanelPayload(guildId, config, statusMessage, options);
    if (panel === 'autoban') return buildAutoBanPanelPayload(guildId, config, statusMessage, options);
    if (panel === 'automatic') return buildAutomaticSpamDetectionPanelPayloadWithQuota(guildId, config, statusMessage, options);
    if (panel === 'notices') return buildNoticesPanelPayload(guildId, config, statusMessage, options);
    return buildDashboardPayload(guildId, config, statusMessage, options);
  }

  function webhookPostUrl(webhookUrl) {
    const url = new URL(webhookUrl);
    url.searchParams.set('with_components', 'true');
    url.searchParams.set('wait', 'true');
    return url.toString();
  }

  function webhookEditUrl(webhookUrl, messageId) {
    const url = new URL(webhookUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/messages/${messageId}`;
    url.searchParams.set('with_components', 'true');
    return url.toString();
  }

  function errorMeta(error) {
    return {
      name: error?.name,
      message: error?.message || String(error),
      code: error?.code,
      stack: error?.stack,
    };
  }

  async function responseMeta(response) {
    if (!response) return { status: 'no_response' };
    const body = await response.text().catch(() => '');
    return {
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 1000),
    };
  }

  async function postTrapNotices(guild, config) {
    const notices = [];
    const failures = [];
    const webhookByChannel = new Map(
      config.webhookEnabled ? config.webhookUrls.map((item) => [item.channelId, item.webhookUrl]) : []
    );

    logger.info('Post/update trap notices started', {
      guildId: guild.id,
      channelIds: config.channelIds,
      webhookEnabled: config.webhookEnabled,
      webhookChannelCount: webhookByChannel.size,
    });

    function fail(channelId, stage, details) {
      failures.push({ channelId, stage });
      logger.warn('Post/update trap notice failed', {
        guildId: guild.id,
        channelId,
        stage,
        ...details,
      });
    }

    function warn(channelId, stage, details) {
      logger.warn('Post/update trap notice warning', {
        guildId: guild.id,
        channelId,
        stage,
        ...details,
      });
    }

    for (const channelId of config.channelIds) {
      let count = 0;
      try {
        count = await configStore.getSpamCatcherCaughtCount(guild.id, channelId);
      } catch (error) {
        logger.warn('Failed to load Spam Catcher caught count for trap notice', {
          guildId: guild.id,
          channelId,
          error: errorMeta(error),
        });
      }

      const payload = buildTrapNoticePayload(count, config);
      const webhookUrl = webhookByChannel.get(channelId);
      let existing = null;
      try {
        existing = await configStore.getSpamCatcherNoticeMessage(guild.id, channelId);
      } catch (error) {
        logger.warn('Failed to load existing Spam Catcher notice message', {
          guildId: guild.id,
          channelId,
          error: errorMeta(error),
        });
      }

      logger.info('Post/update trap notice channel started', {
        guildId: guild.id,
        channelId,
        deliveryMethod: webhookUrl ? 'webhook' : 'bot',
        existingMessageId: existing?.messageId || null,
        existingDeliveryMethod: existing?.deliveryMethod || null,
      });

      if (webhookUrl) {
        if (existing?.messageId && existing.deliveryMethod === 'webhook' && existing.webhookUrl) {
          try {
            const edited = await fetch(webhookEditUrl(existing.webhookUrl, existing.messageId), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (edited.ok) {
              notices.push({ channelId, messageId: existing.messageId, deliveryMethod: 'webhook', webhookUrl: existing.webhookUrl });
              logger.info('Updated Spam Catcher trap notice via webhook', {
                guildId: guild.id,
                channelId,
                messageId: existing.messageId,
              });
              continue;
            }
            warn(channelId, 'webhook_edit_response', await responseMeta(edited));
          } catch (error) {
            warn(channelId, 'webhook_edit_request', { error: errorMeta(error) });
          }
        }

        try {
          const response = await fetch(webhookPostUrl(webhookUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            fail(channelId, 'webhook_post_response', await responseMeta(response));
            continue;
          }

          let parseFailed = false;
          const message = await response.json().catch((error) => {
            parseFailed = true;
            fail(channelId, 'webhook_post_parse', { error: errorMeta(error) });
            return null;
          });
          if (message?.id) {
            notices.push({ channelId, messageId: message.id, deliveryMethod: 'webhook', webhookUrl });
            logger.info('Posted Spam Catcher trap notice via webhook', {
              guildId: guild.id,
              channelId,
              messageId: message.id,
            });
          } else if (!parseFailed) {
            fail(channelId, 'webhook_post_missing_message_id', { responseMessage: message });
          }
        } catch (error) {
          fail(channelId, 'webhook_post_request', { error: errorMeta(error) });
        }
        continue;
      }

      const channel = await guild.channels.fetch(channelId).catch((error) => {
        fail(channelId, 'channel_fetch', { error: errorMeta(error) });
        return null;
      });
      if (!channel) continue;
      if (!channel.isTextBased()) {
        fail(channelId, 'channel_not_text_based', { channelType: channel.type });
        continue;
      }
      if (existing?.messageId && existing.deliveryMethod === 'bot') {
        const existingMessage = await channel.messages.fetch(existing.messageId).catch((error) => {
          logger.warn('Failed to fetch existing Spam Catcher trap notice message', {
            guildId: guild.id,
            channelId,
            messageId: existing.messageId,
            error: errorMeta(error),
          });
          return null;
        });
        const edited = existingMessage ? await existingMessage.edit(payload).catch((error) => {
          warn(channelId, 'bot_message_edit', { messageId: existing.messageId, error: errorMeta(error) });
          return null;
        }) : null;
        if (edited?.id) {
          notices.push({ channelId, messageId: edited.id, deliveryMethod: 'bot' });
          logger.info('Updated Spam Catcher trap notice via bot message', {
            guildId: guild.id,
            channelId,
            messageId: edited.id,
          });
          continue;
        }
      }

      const message = await channel.send(payload).catch((error) => {
        fail(channelId, 'bot_message_send', { error: errorMeta(error) });
        return null;
      });
      if (message?.id) {
        notices.push({ channelId, messageId: message.id, deliveryMethod: 'bot' });
        logger.info('Posted Spam Catcher trap notice via bot message', {
          guildId: guild.id,
          channelId,
          messageId: message.id,
        });
      } else if (message === null) {
        // send failure already logged above
      } else {
        fail(channelId, 'bot_message_missing_id', { message });
      }
    }

    try {
      await configStore.saveSpamCatcherNoticeMessages(guild.id, notices);
    } catch (error) {
      failures.push({ channelId: null, stage: 'save_notice_messages' });
      logger.error('Failed to save Spam Catcher trap notice message records', {
        guildId: guild.id,
        noticeCount: notices.length,
        error: errorMeta(error),
      });
    }

    logger.info('Post/update trap notices finished', {
      guildId: guild.id,
      requested: config.channelIds.length,
      succeeded: notices.length,
      failed: failures.length,
    });

    return { notices, failures };
  }

  function buildHelpPayload(interaction) {
    const lines = [
      `### /spam-catcher help`,
      `Shows this help overview.`,
      '',
      `### /spam-catcher setup`,
      `Open the interactive setup dashboard. Configure trap channels, automatic detection, AI Verdict, timeout, ban, language, and notices. Restricted to Administrators.`,
      '',
      `### /spam-catcher lang`,
      `Set the server's display language (English or Indonesia). Restricted to Administrators.`,
      '',
      `### /spam-catcher check <user>`,
      `View a user's automatic detection status, spam history, and recent trap channel events. Restricted to Administrators.`,
      '',
      `## Trap Channels`,
      `Designated text channels that catch spam. Anyone who posts there gets timed out or banned based on server settings.`,
      '',
      `## Automatic Spam Detection`,
      `Watches all guild channels for repeated attachment bursts from the same user. Triggers timeout, logs a Danger card, and DMs the user with an appeal button.`,
      '',
      `## AI Verdict Checker`,
      `Optional add-on for Automatic Detection. Analyzes images using computer vision (OpenRouter/Gemini) before applying a timeout. Configurable trigger words, confidence threshold, and daily quota (resets by server timezone).`,
      '',
      `## Appeal System`,
      `Timed-out users receive a DM with an Appeal button. Their explanation appears on the review card for admins to review. Admins can remove timeout or ban directly from the card.`,
    ];

    return {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [
        new ContainerBuilder()
          .setAccentColor(0x3b82f6)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(lines.join('\n'))
          ),
      ],
      allowedMentions: { parse: [] },
    };
  }

  async function handleHelpCommand(interaction) {
    await interaction.reply(buildHelpPayload(interaction));
    return true;
  }

  async function handleSetupCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    await interaction.reply(buildDashboardPayload(interaction.guildId, config, null, { ephemeral: true }));
    return true;
  }

  async function handleLangCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const language = normalizeLanguage(interaction.options.getString('language', true));
    const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, { ...config, language });
    const t = createTranslator(saved.language);
    await interaction.reply(buildDashboardPayload(
      interaction.guildId,
      saved,
      t('setup.languageSaved', { language: languageName(saved.language) }),
      { ephemeral: true }
    ));
    return true;
  }

  async function handleCheckCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const userId = interaction.options.getUser('user', true).id;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const t = createTranslator(config.language);

    const [autoUser, autoEvents, trapEvents] = await Promise.all([
      configStore.getAutomaticSpamDetectionUser(interaction.guildId, userId).catch(() => null),
      configStore.getAutomaticSpamDetectionEventsByUser(interaction.guildId, userId).catch(() => []),
      configStore.getSpamCatcherEventsByUser(interaction.guildId, userId).catch(() => []),
    ]);

    function truncate(str, max) {
      if (!str) return '';
      return str.length > max ? str.slice(0, max) + '…' : str;
    }

    function ts(date) {
      if (!date) return null;
      return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
    }

    const autoState = autoUser
      ? (autoUser.spammer ? `\`${t('automatic.spammerStateActive')}\`` : `\`${t('automatic.spammerStateCleared')}\``)
      : `\`${t('check.neverFlagged')}\``;

    const autoEventsBlock = autoEvents.length
      ? autoEvents.map((e, i) =>
        `${i + 1}. \`${e.status}\` — ${truncate(e.reason, 50)}, ${ts(e.createdAt)}`
      ).join('\n')
      : `-# ${t('check.noEvents')}`;

    const trapEventsBlock = trapEvents.length
      ? trapEvents.map((e, i) =>
        `${i + 1}. \`${e.status}\` — <#${e.channelId}>, ${ts(e.createdAt)}`
      ).join('\n')
      : `-# ${t('check.noEvents')}`;

    const lines = [
      `### 🔍 ${t('check.title')}`,
      `**${t('automatic.user')}:** <@${userId}> (\`${userId}\`)`,
      '',
      `### 📎 ${t('check.autoDetection')}`,
      `**${t('check.state')}:** ${autoState}`,
      autoUser ? `**${t('automatic.spammerCount')}:** \`${autoUser.spammerCount}\`` : null,
      autoUser?.lastAlertAt ? `**${t('check.lastAlert')}:** ${ts(autoUser.lastAlertAt)}` : null,
      autoUser?.lastDangerAt ? `**${t('check.lastDanger')}:** ${ts(autoUser.lastDangerAt)}` : null,
      '',
      `**${t('check.recentEvents')}**`,
      autoEventsBlock,
      '',
      `### 🧲 ${t('check.trapEvents')}`,
      trapEventsBlock,
    ];

    const body = lines.filter(Boolean).join('\n');

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [
        new ContainerBuilder()
          .setAccentColor(0x3b82f6)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(body)),
      ],
      allowedMentions: { parse: [] },
    });
    return true;
  }

  async function saveAndUpdate(interaction, nextConfig, statusMessage, buildPayload = buildDashboardPayload) {
    const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, nextConfig);
    const payload = await buildPayload(interaction.guildId, saved, statusMessage);
    await interaction.update(payload).catch(async () => {
      await interaction.editReply(await buildPayload(interaction.guildId, saved, statusMessage)).catch(() => null);
    });
  }

  async function handleSelect(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const t = createTranslator(config.language);
    const [, type] = interaction.customId.split(':');

    if (type === 'trap') {
      await saveAndUpdate(interaction, { ...config, channelIds: interaction.values }, t('setup.trapSaved'), buildChannelsPanelPayload);
      return true;
    }
    if (type === 'review') {
      await saveAndUpdate(interaction, { ...config, reviewChannelId: interaction.values[0] }, t('setup.reviewSaved'), buildChannelsPanelPayload);
      return true;
    }
    if (type === 'log') {
      await saveAndUpdate(interaction, { ...config, logChannelId: interaction.values[0] }, t('setup.logSaved'), buildChannelsPanelPayload);
      return true;
    }
    if (type === 'timeout') {
      await saveAndUpdate(interaction, { ...config, timeoutMinutes: Number(interaction.values[0]) }, t('setup.timeoutSaved'), buildChannelsPanelPayload);
      return true;
    }
    if (type === 'delay') {
      await saveAndUpdate(interaction, { ...config, banDelayMinutes: Number(interaction.values[0]) }, t('setup.delaySaved'), buildAutoBanPanelPayload);
      return true;
    }
    return false;
  }

  async function handleButton(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const t = createTranslator(config.language);
    const [, action, value] = interaction.customId.split(':');

    if (action === 'panel') {
      await interaction.reply(await buildPanelPayload(value, interaction.guildId, config, null, { ephemeral: true }));
      return true;
    }

    if (action === 'refresh') {
      await interaction.update(buildDashboardPayload(interaction.guildId, config, t('setup.panelRefreshed')));
      return true;
    }

    if (action === 'enable') {
      if (!isConfigReady(config)) {
        await interaction.update(buildSpamCatcherPanelPayload(
          interaction.guildId,
          config,
          t('setup.cannotEnableSpam')
        ));
        return true;
      }
      await saveAndUpdate(interaction, { ...config, enabled: true }, t('setup.spamEnabled'), buildSpamCatcherPanelPayload);
      return true;
    }

    if (action === 'disable') {
      await saveAndUpdate(interaction, { ...config, enabled: false }, t('setup.spamDisabled'), buildSpamCatcherPanelPayload);
      return true;
    }

    if (action === 'autoban') {
      const nextConfig = value === 'on'
        ? { ...config, autoBanEnabled: true }
        : { ...config, autoBanEnabled: false };
      await saveAndUpdate(
        interaction,
        nextConfig,
        value === 'on' ? t('setup.autoBanEnabled') : t('setup.autoBanDisabled'),
        buildAutoBanPanelPayload
      );
      return true;
    }

    if (action === 'mode') {
      await saveAndUpdate(interaction, { ...config, autoBanEnabled: true, banMode: value }, t('setup.banTimingSaved'), buildAutoBanPanelPayload);
      return true;
    }

    if (action === 'timeout') {
      await saveAndUpdate(interaction, { ...config, timeoutMinutes: Number(value) }, t('setup.timeoutSaved'), buildChannelsPanelPayload);
      return true;
    }

    if (action === 'delay') {
      await saveAndUpdate(interaction, { ...config, banDelayMinutes: Number(value) }, t('setup.delaySaved'), buildAutoBanPanelPayload);
      return true;
    }

    if (action === 'autodetect') {
      if (value === 'on' && !isAutomaticSpamDetectionReady(config)) {
        await interaction.update(await buildAutomaticSpamDetectionPanelPayloadWithQuota(
          interaction.guildId,
          config,
          t('setup.cannotEnableDetection')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        { ...config, automaticSpamDetectionEnabled: value === 'on' },
        value === 'on' ? t('setup.detectionEnabled') : t('setup.detectionDisabled'),
        buildAutomaticSpamDetectionPanelPayloadWithQuota
      );
      return true;
    }

    if (action === 'aivision') {
      if (value === 'on' && !hasAiVisionKey()) {
        await interaction.update(await buildAutomaticSpamDetectionPanelPayloadWithQuota(
          interaction.guildId,
          config,
          t('setup.cannotEnableAiVision')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        { ...config, aiVisionSpamCheckEnabled: value === 'on' },
        value === 'on' ? t('setup.aiVisionEnabled') : t('setup.aiVisionDisabled'),
        buildAutomaticSpamDetectionPanelPayloadWithQuota
      );
      return true;
    }

    if (action === 'aivision_words') {
      const modal = new ModalBuilder()
        .setCustomId(AI_VISION_WORDS_MODAL)
        .setTitle(t('setup.editAiVisionTriggerWords'))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('words')
              .setLabel(t('setup.aiVisionTriggerWords'))
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(4000)
              .setValue(aiVisionTriggerWordsText(config))
          )
        );
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'post_notices') {
      await interaction.deferUpdate().catch(() => null);
      const saved = await configStore.getSpamCatcherConfig(interaction.guildId);
      let result;
      try {
        result = await postTrapNotices(interaction.guild, saved);
      } catch (error) {
        logger.error('Post/update trap notices crashed', {
          guildId: interaction.guildId,
          error: errorMeta(error),
        });
        await interaction.editReply(buildNoticesPanelPayload(
          interaction.guildId,
          saved,
          t('setup.noticesFailed')
        )).catch(() => null);
        return true;
      }
      const notices = result.notices || [];
      const failures = result.failures || [];
      const statusMessage = failures.length > 0
        ? t('setup.noticesFinishedWithFailures', { success: notices.length, total: saved.channelIds.length, failed: failures.length })
        : t('setup.noticesFinished', { success: notices.length, total: saved.channelIds.length });
      await interaction.editReply(buildNoticesPanelPayload(
        interaction.guildId,
        saved,
        statusMessage
      )).catch(() => null);
      return true;
    }

    return false;
  }

  async function handleModal(interaction) {
    if (interaction.customId !== AI_VISION_WORDS_MODAL) return false;
    if (!await requireAdmin(interaction)) return true;

    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const t = createTranslator(config.language);
    const words = interaction.fields.getTextInputValue('words');
    const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, {
      ...config,
      aiVisionTriggerWords: words,
    });
    await interaction.reply(await buildAutomaticSpamDetectionPanelPayloadWithQuota(
      interaction.guildId,
      saved,
      t('setup.aiVisionTriggerWordsSaved'),
      { ephemeral: true }
    ));
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'help') {
      return handleHelpCommand(interaction);
    }
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'setup') {
      return handleSetupCommand(interaction);
    }
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'lang') {
      return handleLangCommand(interaction);
    }
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'check') {
      return handleCheckCommand(interaction);
    }
    if ((interaction.isChannelSelectMenu?.() || interaction.isStringSelectMenu?.())
      && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleSelect(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleButton(interaction);
    }
    if (interaction.isModalSubmit?.() && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleModal(interaction);
    }
    return false;
  }

  return {
    registerCommands,
    handleInteraction,
  };
}

module.exports = { createSetupCommandManager };
