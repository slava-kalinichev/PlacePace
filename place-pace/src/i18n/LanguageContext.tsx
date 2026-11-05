import { createContext, useContext } from 'react';
import { DICTIONARY } from './dictionary';

export type Language = 'ru' | 'en';

interface LanguageContextValue {
  language: Language;
  t: (ru: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'ru',
  t: (ru) => ru,
});

export function LanguageProvider({ language, children }: { language: Language; children: React.ReactNode }) {
  const t = (ru: string): string => {
    if (language !== 'en') return ru;
    return DICTIONARY[ru] ?? ru;
  };
  return (
    <LanguageContext.Provider value={{ language, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
