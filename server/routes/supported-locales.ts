/** Locales shipped by the checked-in frontend language bundles. */
export const SUPPORTED_LANGUAGES = [
  'en', 'de', 'fr', 'pt', 'tr', 'it', 'es', 'zh-cn', 'zh-tw', 'cs', 'pl', 'ru', 'ja'
] as const;

/** Route-pattern fragment for the finite set of frontend-supported locales. */
export const SUPPORTED_LANGUAGE_PATTERN = SUPPORTED_LANGUAGES.join('|');
