const { MessageFlags } = require('discord.js');
const {
  ContainerBuilder,
  TextDisplayBuilder,
} = require('@discordjs/builders');
const { createTranslator, normalizeLanguage } = require('./i18n');

function formatNoticeMinutes(minutes, language = 'en') {
  const safeMinutes = Math.max(1, Math.floor(Number(minutes) || 1));
  const lang = normalizeLanguage(language);
  if (safeMinutes % 1440 === 0) {
    const days = safeMinutes / 1440;
    if (lang === 'id') return `${days} hari`;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60;
    if (lang === 'id') return `${hours} jam`;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (lang === 'id') return `${safeMinutes} menit`;
  return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
}

function buildTrapNoticeText(caughtCount, config) {
  const safeCount = Math.max(0, Math.floor(Number(caughtCount) || 0));
  const language = normalizeLanguage(config.language);
  const t = createTranslator(language);
  const timeoutText = formatNoticeMinutes(config.timeoutMinutes, language);
  const banDelayText = formatNoticeMinutes(config.banDelayMinutes, language);
  const action = config.autoBanEnabled
    ? config.banMode === 'immediate'
      ? t('notice.banImmediateAction')
      : config.banMode === 'after_timeout'
        ? t('notice.banAfterTimeoutAction', { timeout: timeoutText })
        : t('notice.banDelayedAction', { timeout: timeoutText, delay: banDelayText })
    : t('notice.timeoutAction', { timeout: timeoutText });
  const appeal = config.autoBanEnabled && config.banMode === 'immediate'
    ? t('notice.appealImmediate')
    : t('notice.appealDefault');

  return [
    t('notice.title'),
    t('notice.warning', { action, appeal }),
    '',
    t('notice.dareTitle'),
    t('notice.dareBody'),
    '',
    t('notice.caughtCount', { count: safeCount }),
  ].join('\n');
}

function buildTrapNoticePayload(caughtCount, config) {
  const text = buildTrapNoticeText(caughtCount, config);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
    ],
    allowedMentions: { parse: [] },
  };
}

function buildTrapNoticeRestPayload(caughtCount, config) {
  const text = buildTrapNoticeText(caughtCount, config);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        components: [
          { type: 10, content: text },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

module.exports = {
  buildTrapNoticePayload,
  buildTrapNoticeRestPayload,
  formatNoticeMinutes,
};
