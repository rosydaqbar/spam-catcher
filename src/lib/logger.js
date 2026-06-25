function formatScope(scope) {
  return scope ? `[${scope}]` : '[app]';
}

function createLogger(scope) {
  const prefix = formatScope(scope);

  function info(message, meta) {
    if (meta === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }
    console.log(`${prefix} ${message}`, meta);
  }

  function warn(message, meta) {
    if (meta === undefined) {
      console.warn(`${prefix} ${message}`);
      return;
    }
    console.warn(`${prefix} ${message}`, meta);
  }

  function error(message, meta) {
    if (meta === undefined) {
      console.error(`${prefix} ${message}`);
      return;
    }
    console.error(`${prefix} ${message}`, meta);
  }

  return { info, warn, error };
}

module.exports = { createLogger };
