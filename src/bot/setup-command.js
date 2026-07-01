const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const {
  ContainerBuilder,
  SeparatorBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { createLogger } = require('../lib/logger');

const COMMAND_NAME = 'spam-catcher';
const SETUP_PREFIX = 'spamsetup';
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
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((subcommand) => subcommand
        .setName('setup')
        .setDescription('Open the Spam Catcher setup panel'))
      .toJSON();
  }

  async function registerCommands() {
    if (!client.application) return;
    const data = commandData();
    const commands = await client.application.commands.fetch();
    const existing = commands.find((command) => command.name === COMMAND_NAME);
    if (existing) {
      await existing.edit(data);
      return;
    }
    await client.application.commands.create(data);
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
      await interaction.reply(buildInfoPayload('Spam Catcher Setup', 'Run this command inside a Discord server.')).catch(() => null);
      return false;
    }
    if (!isAdmin(interaction)) {
      await interaction.reply(buildInfoPayload('Spam Catcher Setup', 'Only users with Administrator permission can configure Spam Catcher.')).catch(() => null);
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

  function outcomeLabel(config) {
    if (!config.autoBanEnabled) return `Timeout for ${formatMinutes(config.timeoutMinutes)}. No automatic ban.`;
    if (config.banMode === 'immediate') return 'Ban immediately. No timeout or appeal window.';
    if (config.banMode === 'after_timeout') return `Timeout for ${formatMinutes(config.timeoutMinutes)}, then ban when timeout ends.`;
    return `Timeout for ${formatMinutes(config.timeoutMinutes)}, then ban after ${formatMinutes(config.banDelayMinutes)} appeal window.`;
  }

  function setupStatus(config) {
    const missing = [];
    if (!config.channelIds.length) missing.push('trap channel');
    if (!config.reviewChannelId) missing.push('review channel');
    if (!config.logChannelId) missing.push('log channel');
    if (!missing.length) return config.enabled ? 'Ready and enabled' : 'Ready, but disabled';
    return `Incomplete: missing ${missing.join(', ')}`;
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

  function statusSuffix(statusMessage) {
    return statusMessage ? `\n-# Last action: ${statusMessage}` : '';
  }

  function openPanelButton(panel, label, style = ButtonStyle.Primary) {
    return new ButtonBuilder()
      .setCustomId(`${SETUP_PREFIX}:panel:${panel}`)
      .setLabel(label)
      .setStyle(style);
  }

  function spamCatcherToggleButton(config) {
    const isReady = isConfigReady(config);
    return config.enabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:disable`)
        .setLabel('Disable Spam Catcher')
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:enable`)
        .setLabel('Enable Spam Catcher')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!isReady);
  }

  function autoBanToggleButton(config) {
    return config.autoBanEnabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autoban:off`)
        .setLabel('Turn Auto Ban Off')
        .setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autoban:on`)
        .setLabel('Turn Auto Ban On')
        .setStyle(ButtonStyle.Danger);
  }

  function automaticSpamDetectionToggleButton(config) {
    return config.automaticSpamDetectionEnabled
      ? new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autodetect:off`)
        .setLabel('Disable Automatic Detection')
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`${SETUP_PREFIX}:autodetect:on`)
        .setLabel('Enable Automatic Detection')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!isAutomaticSpamDetectionReady(config));
  }

  function buildDashboardPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const isReady = isConfigReady(config);
    const autoReady = isAutomaticSpamDetectionReady(config);
    const statusLabel = config.enabled ? 'ON' : isReady ? 'OFF, READY' : 'OFF, NEEDS CHANNELS';
    const statusAccent = config.enabled ? 0x22c55e : isReady ? 0xf59e0b : 0xef4444;
    const automaticStatus = config.automaticSpamDetectionEnabled
      ? 'ON'
      : autoReady
        ? 'OFF, READY'
        : 'OFF, NEEDS LOG CHANNEL';

    const statusContainer = new ContainerBuilder()
      .setAccentColor(statusAccent)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          '# Spam Catcher Dashboard',
          `\`Guild\` ${guildId}`,
          `**Status:** \`${statusLabel}\`${statusSuffix(statusMessage)}`,
        ].join('\n'))
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        buttonSection(
          'Spam Catcher Summary',
          [
            `**Config:** ${setupStatus(config)}`,
            `**Result:** ${outcomeLabel(config)}`,
          ].join('\n'),
          openPanelButton('spam', 'Open Settings')
        )
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:refresh`)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary)
        )
      );

    const channelsContainer = new ContainerBuilder()
      .setAccentColor(isReady ? 0x22c55e : 0x3b82f6)
      .addSectionComponents(
        buttonSection(
          'Channels / Timeout Summary',
          [
            `**Trap:** ${mentionChannels(config.channelIds)}`,
            `**Review:** ${mentionChannel(config.reviewChannelId)}`,
            `**Log:** ${mentionChannel(config.logChannelId)}`,
            `**Timeout:** ${formatMinutes(config.timeoutMinutes)}`,
          ].join('\n'),
          openPanelButton('channels', 'Edit Channels')
        )
      );

    const autoBanContainer = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          'Auto Ban Summary',
          [
            `**Status:** \`${config.autoBanEnabled ? 'ON' : 'OFF'}\``,
            `**Result:** ${outcomeLabel(config)}`,
            config.autoBanEnabled && config.banMode === 'delayed'
              ? `**Appeal window:** ${formatMinutes(config.banDelayMinutes)}`
              : null,
          ].filter(Boolean).join('\n'),
          openPanelButton('autoban', 'Edit Auto Ban', config.autoBanEnabled ? ButtonStyle.Danger : ButtonStyle.Primary)
        )
      );

    const automaticContainer = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0xef4444 : autoReady ? 0xf59e0b : 0x6b7280)
      .addSectionComponents(
        buttonSection(
          'Automatic Spam Detection Summary',
          [
            `**Status:** \`${automaticStatus}\``,
            `**Trigger:** ${config.attachmentSpamThreshold}+ attachments twice within ${formatMinutes(config.attachmentSpamWindowSeconds / 60)}`,
            `**Action:** timeout for ${formatMinutes(config.attachmentSpamTimeoutMinutes)}, log Danger card`,
            `**Log:** ${mentionChannel(config.logChannelId)}`,
            '-# Independent from main Spam Catcher enabled state.',
          ].join('\n'),
          openPanelButton('automatic', 'Edit Detection', config.automaticSpamDetectionEnabled ? ButtonStyle.Danger : ButtonStyle.Primary)
        )
      );

    const noticesContainer = new ContainerBuilder()
      .setAccentColor(0x8b5cf6)
      .addSectionComponents(
        buttonSection(
          'Trap Notices Summary',
          [
            `**Trap channels:** ${config.channelIds.length}`,
            isReady
              ? 'Ready to post or refresh warning notices.'
              : 'Set trap, review, and log channels before posting notices.',
          ].join('\n'),
          openPanelButton('notices', 'Open Notices')
        )
      );

    return buildComponentPayload(
      [statusContainer, channelsContainer, autoBanContainer, automaticContainer, noticesContainer],
      { ephemeral }
    );
  }

  function buildSpamCatcherPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const isReady = isConfigReady(config);
    const statusLabel = config.enabled ? 'ON' : isReady ? 'OFF, READY' : 'OFF, NEEDS CHANNELS';
    const container = new ContainerBuilder()
      .setAccentColor(config.enabled ? 0x22c55e : isReady ? 0xf59e0b : 0xef4444)
      .addSectionComponents(
        buttonSection(
          'Spam Catcher Settings',
          [
            `**Status:** \`${statusLabel}\``,
            `**Config:** ${setupStatus(config)}`,
            `**Result:** ${outcomeLabel(config)}`,
            config.enabled
              ? 'Trap-channel messages are handled using saved settings.'
              : isReady
                ? 'Settings are saved, but trap-channel messages are ignored until enabled.'
                : 'Set trap, review, and log channels before enabling.',
            statusSuffix(statusMessage).trim(),
          ].filter(Boolean).join('\n'),
          spamCatcherToggleButton(config)
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildChannelsPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const container = new ContainerBuilder()
      .setAccentColor(isConfigReady(config) ? 0x22c55e : 0x3b82f6)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
          '## Channels / Timeout',
          `**Trap:** ${mentionChannels(config.channelIds)}`,
          `**Review:** ${mentionChannel(config.reviewChannelId)}`,
          `**Log:** ${mentionChannel(config.logChannelId)}`,
          `**Timeout:** ${formatMinutes(config.timeoutMinutes)}`,
          '-# Selections save immediately.',
          statusSuffix(statusMessage).trim(),
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
          '## Timeout',
          `Current timeout is **${formatMinutes(config.timeoutMinutes)}**.`,
          '-# Used by Timeout Only, Ban After Appeal Window, and Ban After Timeout Ends. Ban Immediately skips timeout.',
        ].join('\n'))
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${SETUP_PREFIX}:timeout`)
            .setPlaceholder(`Timeout: ${formatMinutes(config.timeoutMinutes)}`)
            .addOptions(selectOptions(TIMEOUT_OPTIONS, config.timeoutMinutes))
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildAutoBanPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const container = new ContainerBuilder()
      .setAccentColor(config.autoBanEnabled ? 0xef4444 : 0xf59e0b)
      .addSectionComponents(
        buttonSection(
          config.autoBanEnabled ? 'Auto Ban Is On' : 'Auto Ban Is Off',
          [
            config.autoBanEnabled
              ? 'Caught users are banned using ban timing below.'
              : 'Caught users receive timeout only. No automatic ban is scheduled.',
            `**Current result:** ${outcomeLabel(config)}`,
            statusSuffix(statusMessage).trim(),
          ].filter(Boolean).join('\n'),
          autoBanToggleButton(config)
        )
      );

    if (config.autoBanEnabled) {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            '## Ban Timing',
            'Choose when Auto Ban happens.',
          ].join('\n'))
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:delayed`)
              .setLabel('Ban After Appeal Window')
              .setStyle(config.banMode === 'delayed' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:immediate`)
              .setLabel('Ban Immediately')
              .setStyle(config.banMode === 'immediate' ? ButtonStyle.Danger : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`${SETUP_PREFIX}:mode:after_timeout`)
              .setLabel('Ban After Timeout Ends')
              .setStyle(config.banMode === 'after_timeout' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          )
        );
    }

    if (config.autoBanEnabled && config.banMode === 'delayed') {
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            '## Appeal Window',
            `Current appeal window: **${formatMinutes(config.banDelayMinutes)}**`,
            'Shown only for Ban After Appeal Window.',
          ].join('\n'))
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${SETUP_PREFIX}:delay`)
              .setPlaceholder(`Appeal window: ${formatMinutes(config.banDelayMinutes)}`)
              .addOptions(selectOptions(APPEAL_WINDOW_OPTIONS, config.banDelayMinutes))
          )
        );
    }

    return buildComponentPayload([container], { ephemeral });
  }

  function buildAutomaticSpamDetectionPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const isReady = isAutomaticSpamDetectionReady(config);
    const statusLabel = config.automaticSpamDetectionEnabled ? 'ON' : isReady ? 'OFF, READY' : 'OFF, NEEDS LOG CHANNEL';
    const container = new ContainerBuilder()
      .setAccentColor(config.automaticSpamDetectionEnabled ? 0xef4444 : isReady ? 0xf59e0b : 0x6b7280)
      .addSectionComponents(
        buttonSection(
          'Automatic Spam Detection',
          [
            `**Status:** \`${statusLabel}\``,
            `**Trigger:** first ${config.attachmentSpamThreshold}+ attachment message starts fixed ${formatMinutes(config.attachmentSpamWindowSeconds / 60)} window.`,
            `**Danger:** next ${config.attachmentSpamThreshold}+ attachment message by same user inside window.`,
            `**Action:** set spammer=1, increment spammer_count, timeout for ${formatMinutes(config.attachmentSpamTimeoutMinutes)}, post Danger card to log channel.`,
            `**Log channel:** ${mentionChannel(config.logChannelId)}`,
            '-# Watches all guild channels when enabled. Ignores bots, webhooks, and users bot cannot moderate.',
            '-# Independent from main Spam Catcher enabled state.',
            statusSuffix(statusMessage).trim(),
          ].filter(Boolean).join('\n'),
          automaticSpamDetectionToggleButton(config)
        )
      );

    return buildComponentPayload([container], { ephemeral });
  }

  function buildNoticesPanelPayload(guildId, config, statusMessage, { ephemeral = false } = {}) {
    const isReady = isConfigReady(config);
    const container = new ContainerBuilder()
      .setAccentColor(0x8b5cf6)
      .addSectionComponents(
        buttonSection(
          'Trap Notices',
          [
            'Post or refresh warning message in each trap channel using current timeout and Auto Ban settings.',
            `**Trap:** ${mentionChannels(config.channelIds)}`,
            statusSuffix(statusMessage).trim(),
          ].filter(Boolean).join('\n'),
          new ButtonBuilder()
            .setCustomId(`${SETUP_PREFIX}:post_notices`)
            .setLabel('Post/Update Notices')
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
    if (panel === 'automatic') return buildAutomaticSpamDetectionPanelPayload(guildId, config, statusMessage, options);
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

  function buildTrapNoticePayload(caughtCount, config) {
    const safeCount = Math.max(0, Math.floor(Number(caughtCount) || 0));
    const timeoutText = formatMinutes(config.timeoutMinutes);
    const banDelayText = formatMinutes(config.banDelayMinutes);
    const actionId = config.autoBanEnabled
      ? config.banMode === 'immediate'
        ? 'kamu akan langsung terkena `ban`.'
        : config.banMode === 'after_timeout'
          ? `kamu akan terkena \`timeout\` selama ${timeoutText}, lalu terkena \`ban\` saat timeout berakhir.`
          : `kamu akan terkena \`timeout\` selama ${timeoutText}, lalu terkena \`ban\` setelah periode appeal selama ${banDelayText}.`
      : `kamu akan terkena \`timeout\` selama ${timeoutText}.`;
    const appealId = config.autoBanEnabled && config.banMode === 'immediate'
      ? 'Jika ini adalah kesalahan, silakan hubungi admin server.'
      : 'Jika kamu terkena timeout, silakan kirim private message ke salah satu admin yang sedang online atau gunakan tombol appeal jika tersedia.';
    const actionEn = config.autoBanEnabled
      ? config.banMode === 'immediate'
        ? 'you will be `banned` immediately.'
        : config.banMode === 'after_timeout'
          ? `you will receive a \`timeout\` for ${timeoutText}, then be \`banned\` when the timeout ends.`
          : `you will receive a \`timeout\` for ${timeoutText}, then be \`banned\` after a ${banDelayText} appeal window.`
      : `you will receive a \`timeout\` for ${timeoutText}.`;
    const appealEn = config.autoBanEnabled && config.banMode === 'immediate'
      ? 'If this was a mistake, please contact a server admin.'
      : 'If you are timed out, please send a private message to one of the online admins or use the appeal button if available.';

    return {
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              '# 🚫 Dilarang Mengirim Pesan di Channel Ini',
              `⚠️ Channel ini dibuat untuk menangkap spammer. Jika kamu mengirim pesan di channel ini, ${actionId} ${appealId}`,
              '',
              '## 😈 Jangan Berani-Berani Mencoba',
              'Kalau cuma mau tes, sistem tetap akan menangkap kamu.',
              '',
              `-# Jumlah user yang sudah tertangkap di channel ini: \`${safeCount}\``,
            ].join('\n'))
          )
          .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              '# 🚫 Do Not Send Messages in This Channel',
              `⚠️ This channel is made to catch spammers. If you send a message in this channel, ${actionEn} ${appealEn}`,
              '',
              "## 😈 Don't Even Think About Trying",
              'Even if you are just testing, the system will still catch you.',
              '',
              `-# Caught users in this channel: \`${safeCount}\``,
            ].join('\n'))
          ),
      ],
      allowedMentions: { parse: [] },
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

  async function handleSetupCommand(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    await interaction.reply(buildDashboardPayload(interaction.guildId, config, null, { ephemeral: true }));
    return true;
  }

  async function saveAndUpdate(interaction, nextConfig, statusMessage, buildPayload = buildDashboardPayload) {
    const saved = await configStore.saveSpamCatcherConfig(interaction.guildId, nextConfig);
    await interaction.update(buildPayload(interaction.guildId, saved, statusMessage)).catch(async () => {
      await interaction.editReply(buildPayload(interaction.guildId, saved, statusMessage)).catch(() => null);
    });
  }

  async function handleSelect(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const [, type] = interaction.customId.split(':');

    if (type === 'trap') {
      await saveAndUpdate(interaction, { ...config, channelIds: interaction.values }, 'Trap channels saved.', buildChannelsPanelPayload);
      return true;
    }
    if (type === 'review') {
      await saveAndUpdate(interaction, { ...config, reviewChannelId: interaction.values[0] }, 'Review channel saved.', buildChannelsPanelPayload);
      return true;
    }
    if (type === 'log') {
      await saveAndUpdate(interaction, { ...config, logChannelId: interaction.values[0] }, 'Log channel saved.', buildChannelsPanelPayload);
      return true;
    }
    if (type === 'timeout') {
      await saveAndUpdate(interaction, { ...config, timeoutMinutes: Number(interaction.values[0]) }, 'Timeout duration saved.', buildChannelsPanelPayload);
      return true;
    }
    if (type === 'delay') {
      await saveAndUpdate(interaction, { ...config, banDelayMinutes: Number(interaction.values[0]) }, 'Appeal window saved.', buildAutoBanPanelPayload);
      return true;
    }
    return false;
  }

  async function handleButton(interaction) {
    if (!await requireAdmin(interaction)) return true;
    const config = await configStore.getSpamCatcherConfig(interaction.guildId);
    const [, action, value] = interaction.customId.split(':');

    if (action === 'panel') {
      await interaction.reply(buildPanelPayload(value, interaction.guildId, config, null, { ephemeral: true }));
      return true;
    }

    if (action === 'refresh') {
      await interaction.update(buildDashboardPayload(interaction.guildId, config, 'Panel refreshed.'));
      return true;
    }

    if (action === 'enable') {
      if (!isConfigReady(config)) {
        await interaction.update(buildSpamCatcherPanelPayload(
          interaction.guildId,
          config,
          'Cannot enable yet: set trap, review, and log channels first.'
        ));
        return true;
      }
      await saveAndUpdate(interaction, { ...config, enabled: true }, 'Spam Catcher enabled.', buildSpamCatcherPanelPayload);
      return true;
    }

    if (action === 'disable') {
      await saveAndUpdate(interaction, { ...config, enabled: false }, 'Spam Catcher disabled.', buildSpamCatcherPanelPayload);
      return true;
    }

    if (action === 'autoban') {
      const nextConfig = value === 'on'
        ? { ...config, autoBanEnabled: true }
        : { ...config, autoBanEnabled: false };
      await saveAndUpdate(
        interaction,
        nextConfig,
        value === 'on' ? 'Auto Ban enabled. Choose ban timing below.' : 'Auto Ban disabled. Users will be timed out only.',
        buildAutoBanPanelPayload
      );
      return true;
    }

    if (action === 'mode') {
      await saveAndUpdate(interaction, { ...config, autoBanEnabled: true, banMode: value }, 'Ban timing saved.', buildAutoBanPanelPayload);
      return true;
    }

    if (action === 'timeout') {
      await saveAndUpdate(interaction, { ...config, timeoutMinutes: Number(value) }, 'Timeout duration saved.', buildChannelsPanelPayload);
      return true;
    }

    if (action === 'delay') {
      await saveAndUpdate(interaction, { ...config, banDelayMinutes: Number(value) }, 'Ban delay saved.', buildAutoBanPanelPayload);
      return true;
    }

    if (action === 'autodetect') {
      if (value === 'on' && !isAutomaticSpamDetectionReady(config)) {
        await interaction.update(buildAutomaticSpamDetectionPanelPayload(
          interaction.guildId,
          config,
          'Cannot enable yet: set log channel first.'
        ));
        return true;
      }
      await saveAndUpdate(
        interaction,
        { ...config, automaticSpamDetectionEnabled: value === 'on' },
        value === 'on' ? 'Automatic Spam Detection enabled.' : 'Automatic Spam Detection disabled.',
        buildAutomaticSpamDetectionPanelPayload
      );
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
          'Post/update notices failed. Check bot logs.'
        )).catch(() => null);
        return true;
      }
      const notices = result.notices || [];
      const failures = result.failures || [];
      const statusMessage = failures.length > 0
        ? `Post/update notices finished: ${notices.length}/${saved.channelIds.length} succeeded, ${failures.length} failed. Check bot logs.`
        : `Post/update notices finished: ${notices.length}/${saved.channelIds.length} succeeded.`;
      await interaction.editReply(buildNoticesPanelPayload(
        interaction.guildId,
        saved,
        statusMessage
      )).catch(() => null);
      return true;
    }

    return false;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()
      && interaction.commandName === COMMAND_NAME
      && interaction.options.getSubcommand(false) === 'setup') {
      return handleSetupCommand(interaction);
    }
    if ((interaction.isChannelSelectMenu?.() || interaction.isStringSelectMenu?.())
      && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleSelect(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${SETUP_PREFIX}:`)) {
      return handleButton(interaction);
    }
    return false;
  }

  return {
    registerCommands,
    handleInteraction,
  };
}

module.exports = { createSetupCommandManager };
