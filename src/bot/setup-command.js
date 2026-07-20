const {
  ActionRowBuilder,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
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

const SETTINGS_AUDIT_FIELDS = [
  ['enabled', 'auditTrapProtection', 'boolean'],
  ['channelIds', 'auditTrapChannels', 'channels'],
  ['logChannelId', 'auditLogChannel', 'channel'],
  ['reviewChannelId', 'auditReviewChannel', 'channel'],
  ['timeoutMinutes', 'auditTrapTimeout', 'minutes'],
  ['autoBanEnabled', 'auditAutoBan', 'boolean'],
  ['banMode', 'auditBanMethod', 'banMode'],
  ['banDelayMinutes', 'auditAppealWindow', 'minutes'],
  ['automaticSpamDetectionEnabled', 'auditAutomaticDetection', 'boolean'],
  ['attachmentSpamThreshold', 'auditAttachmentThreshold', 'number'],
  ['attachmentSpamWindowSeconds', 'auditDetectionWindow', 'seconds'],
  ['attachmentSpamTimeoutMinutes', 'auditAutomaticTimeout', 'minutes'],
  ['aiVisionSpamCheckEnabled', 'auditAiVerdict', 'boolean'],
  ['aiVisionConfidenceThreshold', 'auditConfidenceThreshold', 'number'],
  ['aiVisionDailyLimit', 'auditDailyLimit', 'number'],
  ['aiVisionTriggerWords', 'auditTriggerPatterns', 'patterns'],
  ['timezone', 'auditTimezone', 'text'],
  ['language', 'auditLanguage', 'language'],
  ['webhookEnabled', 'auditWebhookDelivery', 'boolean'],
  ['webhookUrls', 'auditWebhookDestinations', 'count'],
];

function createSetupCommandManager({
  client,
  configStore,
  additionalCommands = [],
  runGuildConfigOperation = async (_guildId, task) => task(),
  invalidateGuildConfig = () => {},
  resetGuildRuntimeState = async () => {},
}) {
  function commandData() {
    const en = createTranslator('en');
    const id = createTranslator('id');
    return new SlashCommandBuilder()
      .setName(COMMAND_NAME)
      .setDescription('Manage Spam Catcher for this server')
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addSubcommand((subcommand) => subcommand
        .setName('help')
        .setDescription('Show Spam Catcher commands and features'))
      .addSubcommand((subcommand) => subcommand
        .setName('setup')
        .setDescription('Open the Spam Catcher setup panel'))
      .addSubcommand((subcommand) => subcommand
        .setName('reset-setup')
        .setDescription(en('setup.resetDescription'))
        .setDescriptionLocalizations({ id: id('setup.resetDescription') }))
      .addSubcommand((subcommand) => subcommand
        .setName('lang')
        .setDescription('Set the Spam Catcher interface language')
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

    const commands = [commandData(), ...additionalCommands.filter(Boolean)];
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

  function formatAuditChannels(ids, t) {
    if (!Array.isArray(ids) || ids.length === 0) return `\`${t('setup.notSet')}\``;
    const visible = ids.slice(0, 5).map((id) => `<#${id}>`).join(', ');
    const remaining = ids.length - 5;
    return remaining > 0
      ? `${visible} ${t('setup.auditMoreChannels', { count: remaining })}`
      : visible;
  }

  function formatAuditValue(value, type, config, t) {
    if (type === 'boolean') return `\`${t(value ? 'setup.auditEnabled' : 'setup.auditDisabled')}\``;
    if (type === 'channel') return value ? `<#${value}>` : `\`${t('setup.notSet')}\``;
    if (type === 'channels') return formatAuditChannels(value, t);
    if (type === 'minutes') return `\`${formatMinutes(value, config.language)}\``;
    if (type === 'seconds') return `\`${Math.max(1, Math.floor(Number(value) || 1))}s\``;
    if (type === 'banMode') {
      const key = value === 'immediate'
        ? 'setup.banImmediately'
        : value === 'after_timeout'
          ? 'setup.banAfterTimeout'
          : 'setup.banAfterAppeal';
      return `\`${t(key)}\``;
    }
    if (type === 'patterns') {
      const count = Array.isArray(value) ? value.length : 0;
      return `\`${t(count === 1 ? 'setup.auditPatternCountOne' : 'setup.auditPatternCount', { count })}\``;
    }
    if (type === 'language') return `\`${languageName(value)}\``;
    if (type === 'count') return `\`${Array.isArray(value) ? value.length : 0}\``;
    return `\`${String(value ?? t('setup.notSet'))}\``;
  }

  function settingsAuditChanges(before, after) {
    const t = createTranslator(after.language || before.language);
    return SETTINGS_AUDIT_FIELDS.flatMap(([key, labelKey, type]) => {
      if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) return [];
      return [{
        label: t(`setup.${labelKey}`),
        before: formatAuditValue(before[key], type, before, t),
        after: formatAuditValue(after[key], type, after, t),
      }];
    });
  }

  async function sendSettingsAudit(interaction, before, after) {
    const changes = settingsAuditChanges(before, after);
    if (changes.length === 0) return;
    const guild = interaction.guild;
    if (!guild) return;
    const t = createTranslator(after.language || before.language);
    const logChannelIds = [...new Set([before.logChannelId, after.logChannelId].filter(Boolean))];
    if (logChannelIds.length === 0) return;

    for (const channelId of logChannelIds) {
      const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x3b82f6)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent([
                `## ${t('setup.settingsAuditTitle')}`,
                `**${t('setup.settingsAuditChangedBy')}:** <@${interaction.user.id}> (\`${interaction.user.id}\`)`,
                `**${t('setup.settingsAuditChanges')}:**`,
                ...changes.map((change) => `- **${change.label}:** ${change.before} → ${change.after}`),
              ].join('\n'))
            ),
        ],
        allowedMentions: { parse: [] },
      }).catch((error) => {
        logger.warn('Failed to send Spam Catcher settings audit record', {
          guildId: interaction.guildId,
          channelId,
          adminId: interaction.user.id,
          error: errorMeta(error),
        });
      });
    }
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
    return { usageDate, usedCount };
  }

  function outcomeLabel(config, timeoutMinutes) {
    const t = createTranslator(config.language);
    const timeout = formatMinutes(timeoutMinutes, config.language);
    const delay = formatMinutes(config.banDelayMinutes, config.language);
    if (!config.autoBanEnabled) return t('setup.timeoutOnlyOutcome', { timeout });
    if (config.banMode === 'immediate') return t('setup.banImmediateOutcome');
    if (config.banMode === 'after_timeout') return t('setup.banAfterTimeoutOutcome', { timeout });
    return t('setup.banDelayedOutcome', { timeout, delay });
  }

  function isConfigReady(config) {
    return Boolean(
      config.requiredChannelsSet === 1
      && config.channelIds.length > 0
      && config.reviewChannelId
      && config.logChannelId
    );
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
    return Boolean(
      config.logChannelId
      && config.reviewChannelId
      && config.logChannelId !== config.reviewChannelId
    );
  }

  function hasAutomaticDetectionPermissions(guild, config) {
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) return false;
    for (const channelId of [config.logChannelId, config.reviewChannelId]) {
      const channel = guild.channels.cache.get(channelId);
      const permissions = channel?.permissionsFor?.(botMember);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return false;
    }
    return [...guild.channels.cache.values()].every((channel) => {
      if (!channel.isTextBased?.()) return true;
      if (config.enabled && config.channelIds.includes(channel.id)) return true;
      const permissions = channel.permissionsFor?.(botMember);
      return !permissions?.has(PermissionFlagsBits.ViewChannel)
        || permissions.has(PermissionFlagsBits.ManageMessages);
    });
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

  function spamCatcherToggleButton(config) {
    const t = createTranslator(config.language);
    const isReady = isConfigReady(config);
    return config.enabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:disable`)
        .setLabel(t('setup.disableTrapProtection'))
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:enable`)
        .setLabel(t('setup.enableTrapProtection'))
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

  function hasAutoBanPermission(guild) {
    return guild?.members.me?.permissions.has(PermissionFlagsBits.BanMembers) === true;
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

  function requiredChannelSelect(type, config, t, panel = null) {
    const isLog = type === 'log';
    const channelId = isLog ? config.logChannelId : config.reviewChannelId;
    return new ChannelSelectMenuBuilder()
      .setCustomId(`${SETUP_PREFIX}:${type}${panel ? `:${panel}` : ''}`)
      .setPlaceholder(t(isLog ? 'setup.logChannelPlaceholder' : 'setup.reviewChannelPlaceholder'))
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
      .setDefaultChannels(channelId ? [channelId] : []);
  }

  function buildRequiredChannelsStagePayload(config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const completed = Number(Boolean(config.logChannelId)) + Number(Boolean(config.reviewChannelId));
    const container = new ContainerBuilder()
      .setAccentColor(completed === 2 ? 0xf59e0b : 0x3b82f6)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('setup.stageOneTitle')}`,
          `-# ${t('setup.stageProgress', { completed })}`,
          t('setup.stageOneIntroduction'),
          statusSuffix(statusMessage, config).trim(),
          '',
          `### ${t('setup.logChannel')}`,
          t('setup.logChannelExplanation'),
        ].filter((line) => line !== null && line !== undefined).join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(requiredChannelSelect('log', config, t))
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('setup.reviewChannel')}`,
          t('setup.reviewChannelExplanation'),
        ].join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(requiredChannelSelect('review', config, t))
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function panelButton(panel, label, style = ButtonStyle.Primary) {
    return new ButtonBuilder()
      .setCustomId(`${SETUP_PREFIX}:panel:${panel}`)
      .setLabel(label)
      .setStyle(style);
  }

  function backToDashboardRow(t) {
    return new ActionRowBuilder().addComponents(
      panelButton('dashboard', t('setup.backToDashboard'), ButtonStyle.Secondary)
    );
  }

  function trapStatusLabel(config, t) {
    if (config.enabled) return t('setup.enabledStatus');
    return isConfigReady(config) ? t('setup.offReadyStatus') : t('setup.offNeedsTrapStatus');
  }

  function automaticStatusLabel(config, t) {
    if (config.automaticSpamDetectionEnabled) return t('setup.enabledStatus');
    return isAutomaticSpamDetectionReady(config) ? t('setup.offReadyStatus') : t('setup.offNeedsLogStatus');
  }

  function autoBanModeLabel(config, t) {
    if (!config.autoBanEnabled) return t('setup.timeoutOnlyMode');
    if (config.banMode === 'immediate') return t('setup.banImmediately');
    if (config.banMode === 'after_timeout') return t('setup.banAfterTimeout');
    return t('setup.banAfterAppeal');
  }

  function buildDashboardPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    if (config.requiredChannelsSet !== 1) {
      return buildRequiredChannelsStagePayload(config, statusMessage, { ephemeral });
    }

    const t = createTranslator(config.language);
    const trapStatus = trapStatusLabel(config, t);
    const automaticStatus = automaticStatusLabel(config, t);
    const autoBanStatus = config.autoBanEnabled ? t('setup.enabledStatus') : t('setup.offStatus');

    const statusContainer = new ContainerBuilder()
      .setAccentColor(0x3b82f6)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `# ${t('setup.dashboardTitle')}`,
          `-# ${t('setup.guild')}: \`${guildId}\``,
          `**${t('setup.status')}:** \`${t('setup.stageTwoReady')}\``,
          statusSuffix(statusMessage, config).trim(),
        ].filter(Boolean).join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:refresh`)
            .setLabel(t('setup.refresh'))
            .setStyle(ButtonStyle.Secondary)
        )
      );

    const requiredChannelsContainer = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addSectionComponents(
        buttonSection(
          t('setup.requiredChannelsSummary'),
          [
            `**${t('setup.log')}:** ${mentionChannelLocalized(config.logChannelId, t)}`,
            `**${t('setup.review')}:** ${mentionChannelLocalized(config.reviewChannelId, t)}`,
          ].join('\n'),
          panelButton('required', t('setup.editRequiredChannels'))
        )
      );

    const trapContainer = new ContainerBuilder()
      .setAccentColor(config.enabled ? 0x22c55e : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          t('setup.trapProtectionSummary'),
          [
            `**${t('setup.status')}:** \`${trapStatus}\``,
            `**${t('setup.summary')}:** ${t('setup.trapDashboardDetails', {
              count: config.channelIds.length,
              timeout: formatMinutes(config.timeoutMinutes, config.language),
            })}`,
          ].join('\n'),
          panelButton('trap', t('setup.openSettings'))
        )
      );

    const automaticContainer = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0x22c55e : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          t('setup.automaticSummary'),
          [
            `**${t('setup.status')}:** \`${automaticStatus}\``,
            `**${t('setup.aiVision')}:** \`${config.aiVisionSpamCheckEnabled ? t('setup.enabledStatus') : t('setup.offStatus')}\``,
          ].join('\n'),
          panelButton('automatic', t('setup.openSettings'))
        )
      );

    const autoBanContainer = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          t('setup.autoBanSummary'),
          [
            `**${t('setup.status')}:** \`${autoBanStatus}\``,
            `**${t('setup.currentMode')}:** \`${autoBanModeLabel(config, t)}\``,
          ].join('\n'),
          panelButton('autoban', t('setup.openSettings'))
        )
      );

    return buildComponentPayload(
      [statusContainer, requiredChannelsContainer, trapContainer, automaticContainer, autoBanContainer],
      { ephemeral }
    );
  }

  function buildRequiredChannelsPanelPayload(config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const container = new ContainerBuilder()
      .setAccentColor(0x22c55e)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `## ${t('setup.requiredChannelsSettings')}`,
          t('setup.requiredChannelsEditHint'),
          statusSuffix(statusMessage, config).trim(),
          '',
          `### ${t('setup.logChannel')}`,
          t('setup.logChannelExplanation'),
        ].filter((line) => line !== null && line !== undefined).join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(requiredChannelSelect('log', config, t, 'required'))
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `### ${t('setup.reviewChannel')}`,
          t('setup.reviewChannelExplanation'),
        ].join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(requiredChannelSelect('review', config, t, 'required'))
      );

    return buildComponentPayload([container, backToDashboardRow(t)], { ephemeral });
  }

  function buildTrapPanelPayload(config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const trapReady = isConfigReady(config);
    const container = new ContainerBuilder()
      .setAccentColor(config.enabled ? 0x22c55e : trapReady ? 0xf59e0b : 0xef4444)
      .addSectionComponents(
        buttonSection(
          t('setup.trapProtectionSummary'),
          [
            `**${t('setup.status')}:** \`${trapStatusLabel(config, t)}\``,
            `**${t('setup.trap')}:** ${mentionChannelsLocalized(config.channelIds, t)}`,
            `**${t('setup.currentTimeout')}:** \`${formatMinutes(config.timeoutMinutes, config.language)}\``,
            `**${t('setup.result')}:** \`${outcomeLabel(config, config.timeoutMinutes)}\``,
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          spamCatcherToggleButton(config)
        )
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${t('setup.channelsCaption')}:`)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:trap`)
            .setPlaceholder(t('setup.trapChannelPlaceholder'))
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(25)
            .setDefaultChannels(config.channelIds.slice(0, 25))
        )
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${t('setup.timeoutTimeCaption')}:`)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:timeout`)
            .setPlaceholder(`${t('setup.timeout')}: ${formatMinutes(config.timeoutMinutes, config.language)}`)
            .addOptions(selectOptions(TIMEOUT_OPTIONS.map((option) => ({
              ...option,
              label: formatMinutes(Number(option.value), config.language),
            })), config.timeoutMinutes))
        )
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        buttonSection(
          t('setup.noticesSummary'),
          trapReady ? t('setup.postNoticesReady') : t('setup.postNoticesNotReady'),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:post_notices`)
            .setLabel(t('setup.postNotices'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!trapReady)
        )
      );

    return buildComponentPayload([container, backToDashboardRow(t)], { ephemeral });
  }

  function buildAutomaticPanelPayload(
    guildId,
    config,
    statusMessage,
    { ephemeral = false, quotaInfo = null } = {}
  ) {
    const t = createTranslator(config.language);
    const guild = client.guilds.cache.get(guildId);
    const automaticReady = isAutomaticSpamDetectionReady(config);
    const automaticPermissionsReady = hasAutomaticDetectionPermissions(guild, config);
    const automaticOutcome = outcomeLabel(config, config.attachmentSpamTimeoutMinutes);
    const quotaLine = quotaInfo?.usedCount === null
      ? `**${t('setup.aiVisionQuota')}:** \`${t('setup.notAvailable')}\``
      : `**${t('setup.aiVisionQuota')}:** \`${t('setup.aiVisionQuotaUsed', {
        used: quotaInfo?.usedCount || 0,
        limit: config.aiVisionDailyLimit,
        date: quotaInfo?.usageDate,
      })}\``;
    const container = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0x22c55e : automaticReady ? 0xf59e0b : 0xef4444)
      .addSectionComponents(
        buttonSection(
          t('setup.automaticSummary'),
          [
            `**${t('setup.status')}:** \`${automaticStatusLabel(config, t)}\``,
            `**${t('setup.permissionReadiness')}:** \`${automaticPermissionsReady ? t('setup.permissionsReady') : t('setup.permissionsMissing')}\``,
            t('setup.automaticPermissionRequirements'),
            t('setup.automaticTriggerSummary', {
              threshold: config.attachmentSpamThreshold,
              window: formatMinutes(config.attachmentSpamWindowSeconds / 60, config.language),
            }),
            t('setup.automaticActionSummary', { outcome: automaticOutcome }),
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          automaticSpamDetectionToggleButton(config)
        )
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        buttonSection(
          t('setup.aiVisionSummary'),
          [
            `**${t('setup.status')}:** \`${config.aiVisionSpamCheckEnabled ? t('setup.enabledStatus') : t('setup.offStatus')}\``,
            `**${t('setup.aiVisionDailyLimit')}:** \`${t('setup.aiVisionDailyLimitValue', { limit: config.aiVisionDailyLimit })}\``,
            quotaLine,
            `**${t('setup.timezone')}:** \`${config.timezone}\``,
            `**${t('setup.aiVisionTriggerWords')}:** \`${config.aiVisionTriggerWords.length}\``,
            `-# ${t('setup.aiVisionAutomaticOnly')}`,
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

    return buildComponentPayload([container, backToDashboardRow(t)], { ephemeral });
  }

  async function buildAutomaticPanelPayloadWithQuota(guildId, config, statusMessage, options = {}) {
    const quotaInfo = await getAiVisionQuotaInfo(guildId, config);
    return buildAutomaticPanelPayload(guildId, config, statusMessage, { ...options, quotaInfo });
  }

  function buildAutoBanPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const t = createTranslator(config.language);
    const guild = client.guilds.cache.get(guildId);
    const trapOutcome = outcomeLabel(config, config.timeoutMinutes);
    const automaticOutcome = outcomeLabel(config, config.attachmentSpamTimeoutMinutes);
    const container = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          t('setup.autoBanSummary'),
          [
            `**${t('setup.status')}:** \`${config.autoBanEnabled ? t('setup.enabledStatus') : t('setup.offStatus')}\``,
            t('setup.autoBanSharedExplanation'),
            `**${t('setup.permissionReadiness')}:** \`${hasAutoBanPermission(guild) ? t('setup.permissionsReady') : t('setup.banMembersMissing')}\``,
            `**${t('setup.trapOutcome')}:** \`${trapOutcome}\``,
            `**${t('setup.automaticOutcome')}:** \`${automaticOutcome}\``,
            config.autoBanEnabled && config.banMode === 'delayed'
              ? `**${t('setup.currentAppealWindow')}:** \`${formatMinutes(config.banDelayMinutes, config.language)}\``
              : null,
            statusSuffix(statusMessage, config).trim(),
          ].filter(Boolean).join('\n'),
          autoBanToggleButton(config)
        )
      );

    if (config.autoBanEnabled) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${t('setup.chooseBanMethod')}:`)
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:delayed`)
              .setLabel(t('setup.banAfterAppeal'))
              .setStyle(config.banMode === 'delayed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:immediate`)
              .setLabel(t('setup.banImmediately'))
              .setStyle(config.banMode === 'immediate' ? ButtonStyle.Danger : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:after_timeout`)
              .setLabel(t('setup.banAfterTimeout'))
              .setStyle(config.banMode === 'after_timeout' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          )
        );
    }

    if (config.autoBanEnabled && config.banMode === 'delayed') {
      container
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${t('setup.timeCaption')}:`)
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${SETUP_PREFIX}:delay`)
              .setPlaceholder(`${t('setup.appealWindow')}: ${formatMinutes(config.banDelayMinutes, config.language)}`)
              .addOptions(selectOptions(APPEAL_WINDOW_OPTIONS.map((option) => ({
                ...option,
                label: formatMinutes(Number(option.value), config.language),
              })), config.banDelayMinutes))
          )
        );
    }

    return buildComponentPayload([container, backToDashboardRow(t)], { ephemeral });
  }

  async function buildPanelPayload(panel, guildId, config, statusMessage, options = {}) {
    if (config.requiredChannelsSet !== 1) {
      return buildRequiredChannelsStagePayload(config, statusMessage, options);
    }
    if (panel === 'trap') return buildTrapPanelPayload(config, statusMessage, options);
    if (panel === 'automatic') {
      return buildAutomaticPanelPayloadWithQuota(guildId, config, statusMessage, options);
    }
    if (panel === 'autoban') return buildAutoBanPanelPayload(guildId, config, statusMessage, options);
    if (panel === 'required') return buildRequiredChannelsPanelPayload(config, statusMessage, options);
    return buildDashboardPayload(guildId, config, statusMessage, options);
  }

  async function buildDashboardPayloadWithQuota(guildId, config, statusMessage, options = {}) {
    return buildPanelPayload('dashboard', guildId, config, statusMessage, options);
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
      `### /spam-catcher reset-setup`,
      `Start setup again, turn off protection, and cancel pending Trap and Automatic Detection bans. Past spam activity and existing Discord messages are kept. Restricted to Administrators.`,
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
      `Watches monitored guild channels for repeated attachment bursts from the same user and immediately applies the shared timeout and Auto Ban policy. AI Verdict runs afterward and updates the existing Review card without delaying moderation.`,
      '',
      `## AI Verdict Checker`,
      `Optional post-moderation analysis for Automatic Detection. It checks the first supported trigger image once and updates the existing Review card. Its result never delays, removes, or changes the timeout or ban. The quota resets by server timezone.`,
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

  async function validateRequiredChannels(guild, config) {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);

    async function isValid(channelId) {
      if (!channelId || !botMember) return false;
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return false;
      return channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ]) === true;
    }

    const [logValid, reviewValid] = await Promise.all([
      isValid(config.logChannelId),
      isValid(config.reviewChannelId),
    ]);
    const sameChannel = Boolean(
      config.logChannelId
      && config.reviewChannelId
      && config.logChannelId === config.reviewChannelId
    );
    return { logValid, reviewValid, sameChannel, bothValid: logValid && reviewValid && !sameChannel };
  }

  function applyRequiredChannelSafety(config, validity, requiredChannelsSet) {
    const next = {
      ...config,
      requiredChannelsSet,
      logChannelId: validity.logValid ? config.logChannelId : null,
      reviewChannelId: validity.reviewValid ? config.reviewChannelId : null,
    };
    if (requiredChannelsSet !== 1) {
      next.enabled = false;
      next.automaticSpamDetectionEnabled = false;
      next.aiVisionSpamCheckEnabled = false;
      next.autoBanEnabled = false;
    }
    return next;
  }

  async function reconcileRequiredChannels(guild) {
    return runGuildConfigOperation(guild.id, async () => {
      const current = await configStore.getSpamCatcherConfig(guild.id);
      const validity = await validateRequiredChannels(guild, current);
      let requiredChannelsSet = 0;

      if (current.requiredChannelsSet === 1 && validity.bothValid) {
        requiredChannelsSet = 1;
      } else if (current.requiredChannelsSet == null && validity.bothValid) {
        requiredChannelsSet = 1;
      }

      const next = applyRequiredChannelSafety(current, validity, requiredChannelsSet);
      const changed = [
        'requiredChannelsSet',
        'logChannelId',
        'reviewChannelId',
        'enabled',
        'automaticSpamDetectionEnabled',
        'aiVisionSpamCheckEnabled',
        'autoBanEnabled',
      ].some((key) => next[key] !== current[key]);
      if (!changed) return current;

      const saved = await configStore.saveSpamCatcherConfig(guild.id, next);
      invalidateGuildConfig(guild.id);
      return saved;
    });
  }

  async function handleSetupCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await reconcileRequiredChannels(interaction.guild);
    await interaction.editReply(await buildDashboardPayloadWithQuota(
      interaction.guildId,
      config,
      null,
      { ephemeral: true }
    ));
    return true;
  }

  function buildResetSetupConfirmationPayload(interaction, config) {
    const t = createTranslator(config.language);
    const confirmationId = `${interaction.guildId}:${interaction.user.id}`;
    const container = new ContainerBuilder()
      .setAccentColor(0xef4444)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          `## ${t('setup.resetTitle')}`,
          t('setup.resetConfirmation'),
          `-# ${t('setup.resetPreservesHistory')}`,
        ].join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:reset:confirm:${confirmationId}`)
            .setLabel(t('setup.confirmReset'))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:reset:cancel:${confirmationId}`)
            .setLabel(t('setup.cancelReset'))
            .setStyle(ButtonStyle.Secondary)
        )
      );
    return buildComponentPayload([container], { ephemeral: true });
  }

  function buildResetSetupResultPayload(title, body, accentColor) {
    return buildComponentPayload([
      new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([`## ${title}`, body].join('\n'))
        ),
    ]);
  }

  async function handleResetSetupCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    await interaction.editReply(buildResetSetupConfirmationPayload(interaction, config));
    return true;
  }

  async function handleResetSetupButton(interaction, decision, customGuildId, requestingAdminId, config) {
    const t = createTranslator(config.language);
    if (interaction.guildId !== customGuildId || interaction.user.id !== requestingAdminId) {
      await interaction.editReply(buildInfoPayload(t('setup.resetTitle'), t('setup.resetOwnerMismatch')));
      return true;
    }

    if (decision === 'cancel') {
      await interaction.editReply(buildResetSetupResultPayload(
        t('setup.resetCancelledTitle'),
        t('setup.resetCancelled'),
        0x6b7280
      ));
      return true;
    }

    if (decision !== 'confirm') return false;
    try {
      const result = await runGuildConfigOperation(interaction.guildId, () => (
        configStore.resetSpamCatcherSetup(interaction.guildId)
      ));
      invalidateGuildConfig(interaction.guildId);
      await sendSettingsAudit(interaction, config, result.config);
      try {
        await resetGuildRuntimeState(interaction.guildId, result);
      } catch (error) {
        logger.error('Failed to clear guild runtime state after setup reset', {
          guildId: interaction.guildId,
          error: errorMeta(error),
        });
      }
      await interaction.editReply(buildResetSetupResultPayload(
        t('setup.resetSuccessTitle'),
        t('setup.resetSuccess', {
          trapBans: result.spamCatcherBanCancellationCount || 0,
          automaticBans: result.automaticBanCancellationCount || 0,
        }),
        0x22c55e
      ));
    } catch (error) {
      logger.error('Failed to reset Spam Catcher setup', {
        guildId: interaction.guildId,
        error: errorMeta(error),
      });
      await interaction.editReply(buildResetSetupResultPayload(
        t('setup.resetFailedTitle'),
        t('setup.resetFailed'),
        0xef4444
      ));
    }
    return true;
  }

  async function handleLangCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const language = normalizeLanguage(interaction.options.getString('language', true));
    await reconcileRequiredChannels(interaction.guild);
    const { before, saved } = await updateGuildConfig(
      interaction.guildId,
      (config) => ({ ...config, language })
    );
    await sendSettingsAudit(interaction, before, saved);
    const t = createTranslator(saved.language);
    await interaction.editReply(await buildDashboardPayloadWithQuota(
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

  async function updateGuildConfig(guildId, updateConfig) {
    return runGuildConfigOperation(guildId, async () => {
      const config = await configStore.getSpamCatcherConfig(guildId);
      const saved = await configStore.saveSpamCatcherConfig(guildId, updateConfig(config));
      invalidateGuildConfig(guildId);
      return { before: config, saved };
    });
  }

  async function saveRequiredChannelSelection(interaction, type) {
    return runGuildConfigOperation(interaction.guildId, async () => {
      const current = await configStore.getSpamCatcherConfig(interaction.guildId);
      const candidate = {
        ...current,
        [type === 'log' ? 'logChannelId' : 'reviewChannelId']: interaction.values[0],
      };
      const validity = await validateRequiredChannels(interaction.guild, candidate);
      const next = applyRequiredChannelSafety(candidate, validity, validity.bothValid ? 1 : 0);
      const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, next);
      invalidateGuildConfig(interaction.guildId);
      return { before: current, saved, validity };
    });
  }

  async function saveAndUpdate(
    interaction,
    updateConfig,
    statusMessage,
    panel = 'dashboard',
    validateConfig = null
  ) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    const { before, saved } = await updateGuildConfig(interaction.guildId, (config) => {
      if (validateConfig && !validateConfig(config)) {
        throw new Error('Guild settings changed before this action could be saved. Refresh the setup panel and try again.');
      }
      return updateConfig(config);
    });
    await sendSettingsAudit(interaction, before, saved);
    const payload = await buildPanelPayload(panel, interaction.guildId, saved, statusMessage);
    await interaction.editReply(payload);
  }

  async function handleSelect(interaction) {
    if (!await requireAdmin(interaction)) return true;
    await interaction.deferUpdate();
    const [, type, panel] = interaction.customId.split(':');

    if (type === 'review' || type === 'log') {
      const { before, saved, validity } = await saveRequiredChannelSelection(interaction, type);
      const t = createTranslator(saved.language);
      const selectedChannelValid = type === 'log' ? validity.logValid : validity.reviewValid;
      const statusMessage = validity.sameChannel
        ? t('setup.requiredChannelsMustDiffer')
        : validity.bothValid
        ? t('setup.requiredChannelsCompleted')
          : selectedChannelValid
          ? t(type === 'log' ? 'setup.logSaved' : 'setup.reviewSaved')
          : t('setup.requiredChannelInvalid');
      await sendSettingsAudit(interaction, before, saved);
      await interaction.editReply(await buildPanelPayload(
        panel === 'required' ? 'required' : 'dashboard',
        interaction.guildId,
        saved,
        statusMessage
      ));
      return true;
    }

    const config = await reconcileRequiredChannels(interaction.guild);
    const t = createTranslator(config.language);
    if (config.requiredChannelsSet !== 1) {
      await interaction.editReply(await buildDashboardPayloadWithQuota(
        interaction.guildId,
        config,
        t('setup.completeRequiredChannelsFirst')
      ));
      return true;
    }

    if (type === 'trap') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, channelIds: interaction.values }),
        t('setup.trapSaved'),
        'trap'
      );
      return true;
    }
    if (type === 'timeout') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, timeoutMinutes: Number(interaction.values[0]) }),
        t('setup.timeoutSaved'),
        'trap'
      );
      return true;
    }
    if (type === 'delay') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, banDelayMinutes: Number(interaction.values[0]) }),
        t('setup.delaySaved'),
        'autoban'
      );
      return true;
    }
    return false;
  }

  async function handleButton(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const [, action, value, customGuildId, requestingAdminId] = interaction.customId.split(':');

    if (action === 'aivision_words') {
      const config = await configStore.getSpamCatcherConfig(interaction.guildId);
      const t = createTranslator(config.language);
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

    const resetOwnerMismatch = action === 'reset'
      && (interaction.guildId !== customGuildId || interaction.user.id !== requestingAdminId);
    if (resetOwnerMismatch) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferUpdate();
    }

    if (action === 'refresh') {
      const reconciled = await reconcileRequiredChannels(interaction.guild);
      const t = createTranslator(reconciled.language);
      await interaction.editReply(await buildDashboardPayloadWithQuota(
        interaction.guildId,
        reconciled,
        t('setup.panelRefreshed')
      ));
      return true;
    }

    const config = action === 'reset'
      ? await configStore.getSpamCatcherConfig(interaction.guildId)
      : await reconcileRequiredChannels(interaction.guild);
    const t = createTranslator(config.language);

    if (action === 'reset') {
      return handleResetSetupButton(
        interaction,
        value,
        customGuildId,
        requestingAdminId,
        config
      );
    }

    if (action === 'panel') {
      await interaction.editReply(await buildPanelPayload(
        value,
        interaction.guildId,
        config,
        null
      ));
      return true;
    }

    if (config.requiredChannelsSet !== 1) {
      await interaction.editReply(await buildDashboardPayloadWithQuota(
        interaction.guildId,
        config,
        t('setup.completeRequiredChannelsFirst')
      ));
      return true;
    }

    if (action === 'enable') {
      if (!isConfigReady(config)) {
        await interaction.editReply(await buildPanelPayload(
          'trap',
          interaction.guildId,
          config,
          t('setup.cannotEnableSpam')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, enabled: true }),
        t('setup.spamEnabled'),
        'trap',
        isConfigReady
      );
      return true;
    }

    if (action === 'disable') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, enabled: false }),
        t('setup.spamDisabled'),
        'trap'
      );
      return true;
    }

    if (action === 'autoban') {
      if (value === 'on' && !hasAutoBanPermission(interaction.guild)) {
        await interaction.editReply(await buildPanelPayload(
          'autoban',
          interaction.guildId,
          config,
          t('setup.cannotEnableAutoBanPermissions')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, autoBanEnabled: value === 'on' }),
        value === 'on' ? t('setup.autoBanEnabled') : t('setup.autoBanDisabled'),
        'autoban',
        value === 'on' ? () => hasAutoBanPermission(interaction.guild) : null
      );
      return true;
    }

    if (action === 'mode') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, banMode: value }),
        t('setup.banTimingSaved'),
        'autoban'
      );
      return true;
    }

    if (action === 'timeout') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, timeoutMinutes: Number(value) }),
        t('setup.timeoutSaved'),
        'trap'
      );
      return true;
    }

    if (action === 'delay') {
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, banDelayMinutes: Number(value) }),
        t('setup.delaySaved'),
        'autoban'
      );
      return true;
    }

    if (action === 'autodetect') {
      if (value === 'on' && !isAutomaticSpamDetectionReady(config)) {
        await interaction.editReply(await buildPanelPayload(
          'automatic',
          interaction.guildId,
          config,
          t('setup.cannotEnableDetection')
        ));
        return true;
      }
      if (value === 'on' && !hasAutomaticDetectionPermissions(interaction.guild, config)) {
        await interaction.editReply(await buildPanelPayload(
          'automatic',
          interaction.guildId,
          config,
          t('setup.cannotEnableDetectionPermissions')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, automaticSpamDetectionEnabled: value === 'on' }),
        value === 'on' ? t('setup.detectionEnabled') : t('setup.detectionDisabled'),
        'automatic',
        value === 'on'
          ? (current) => isAutomaticSpamDetectionReady(current)
            && hasAutomaticDetectionPermissions(interaction.guild, current)
          : null
      );
      return true;
    }

    if (action === 'aivision') {
      if (value === 'on' && !hasAiVisionKey()) {
        await interaction.editReply(await buildPanelPayload(
          'automatic',
          interaction.guildId,
          config,
          t('setup.cannotEnableAiVision')
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        (current) => ({ ...current, aiVisionSpamCheckEnabled: value === 'on' }),
        value === 'on' ? t('setup.aiVisionEnabled') : t('setup.aiVisionDisabled'),
        'automatic'
      );
      return true;
    }

    if (action === 'post_notices') {
      const saved = await configStore.getSpamCatcherConfig(interaction.guildId);
      let result;
      try {
        result = await postTrapNotices(interaction.guild, saved);
      } catch (error) {
        logger.error('Post/update trap notices crashed', {
          guildId: interaction.guildId,
          error: errorMeta(error),
        });
        await interaction.editReply(await buildPanelPayload(
          'trap',
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
      await interaction.editReply(await buildPanelPayload(
        'trap',
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

    if (interaction.isFromMessage?.()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const config = await reconcileRequiredChannels(interaction.guild);
    const t = createTranslator(config.language);
    if (config.requiredChannelsSet !== 1) {
      await interaction.editReply(await buildDashboardPayloadWithQuota(
        interaction.guildId,
        config,
        t('setup.completeRequiredChannelsFirst'),
        { ephemeral: true }
      ));
      return true;
    }
    const words = interaction.fields.getTextInputValue('words');
    const { before, saved } = await updateGuildConfig(interaction.guildId, (current) => ({
      ...current,
      aiVisionTriggerWords: words,
    }));
    await sendSettingsAudit(interaction, before, saved);
    await interaction.editReply(await buildPanelPayload(
      'automatic',
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
      && interaction.options.getSubcommand(false) === 'reset-setup') {
      return handleResetSetupCommand(interaction);
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
    commandData,
    registerCommands,
    handleInteraction,
  };
}

module.exports = { createSetupCommandManager };
