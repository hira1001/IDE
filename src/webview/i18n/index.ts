import i18n, { type InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ja from './ja.json';

// Detect language from VS Code config passed via window.__AAO_LANG__
const detectedLang =
  (typeof window !== 'undefined' && (window as unknown as { __AAO_LANG__?: string }).__AAO_LANG__) ?? 'en';

// Double-cast bypasses i18next overload resolution issue in strict mode
// (FallbackLng includes `false` which conflicts with some internal type expectations)
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: detectedLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
} as unknown as InitOptions);

export default i18n;
