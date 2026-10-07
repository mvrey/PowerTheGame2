// Texts by key in several languages, for the games' screens. Each game brings its tables; the
// first table lists every key, and the others must give them all (the type checks it).

export interface Translator<L extends string, K extends string> {
  /** The text of `key` in the current language, with {0}, {1}... replaced by `args`. */
  t(key: K, ...args: (string | number)[]): string;
  setLang(next: L): void;
  getLang(): L;
  /** Whether `key` has a text in `language` (for tests over keys built from game data). */
  has(key: string, language: L): boolean;
}

export function translator<L extends string, K extends string>(
  tables: Record<L, Record<K, string>>,
  initial: L,
): Translator<L, K> {
  let lang = initial;
  return {
    t(key, ...args) {
      // A missing text shows its key rather than breaking the screen; the games' i18n tests catch it.
      const text = tables[lang][key] ?? key;
      return text.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)] ?? ''));
    },
    setLang(next) {
      lang = next;
      if (typeof document !== 'undefined') document.documentElement.lang = next;
    },
    getLang: () => lang,
    has: (key, language) => key in tables[language],
  };
}
