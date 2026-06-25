const { DISCORD_TOKEN, DATABASE_URL, LOG_CHANNEL_ID, DISCORD_GUILD_ID, DEBUG } = process.env;

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
  LOG_CHANNEL_ID,
  DISCORD_GUILD_ID,
  DEBUG,
  requireRuntimeEnv,
};
