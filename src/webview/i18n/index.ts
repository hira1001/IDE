import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ja from './ja.json';

// Detect language from VS Code config passed via window.__AAO_LANG__
const detectedLang =
  (typeof window !== 'undefined' && (window as unknown as { __AAO_LANG__?: string }).__AAO_LANG__) ?? 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: detectedLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
