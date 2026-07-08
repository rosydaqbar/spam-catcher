const {
  DISCORD_TOKEN,
  DATABASE_URL,
  ALLOWED_GUILD_IDS,
  DEBUG,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS,
} = process.env;

function parseAllowedGuildIds(value = ALLOWED_GUILD_IDS) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseAiVisionDailyLimitBypassGuildIds(value = AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function requireRuntimeEnv() {
  const missing = [];
  if (!DISCORD_TOKEN) missing.push('DISCORD_TOKEN');
  if (!DATABASE_URL) missing.push('DATABASE_URL');

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

module.exports = {
  DISCORD_TOKEN,
  DATABASE_URL,
  ALLOWED_GUILD_IDS,
  DEBUG,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  AI_VISION_DAILY_LIMIT_BYPASS_GUILD_IDS,
  parseAllowedGuildIds,
  parseAiVisionDailyLimitBypassGuildIds,
  requireRuntimeEnv,
};
