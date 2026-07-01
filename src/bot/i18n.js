const en = require('./locales/en.json');
const id = require('./locales/id.json');

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = {
  en,
  id,
};

function normalizeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'id' || normalized === 'indonesia' || normalized === 'indonesian') return 'id';
  if (normalized === 'en' || normalized === 'english') return 'en';
  return DEFAULT_LANGUAGE;
}

function getByPath(source, key) {
  return String(key || '').split('.').reduce((value, part) => (
    value && Object.prototype.hasOwnProperty.call(value, part) ? value[part] : undefined
  ), source);
}

function interpolate(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

function createTranslator(language) {
  const lang = normalizeLanguage(language);
  const locale = SUPPORTED_LANGUAGES[lang] || en;
  return function t(key, vars = {}) {
    const value = getByPath(locale, key) ?? getByPath(en, key) ?? key;
    return interpolate(value, vars);
  };
}

function languageName(language) {
  const lang = normalizeLanguage(language);
  return SUPPORTED_LANGUAGES[lang]?.languageName || en.languageName;
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  createTranslator,
  languageName,
  normalizeLanguage,
};
