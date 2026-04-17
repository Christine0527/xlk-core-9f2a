import { createContext, useContext, useState } from 'react'
import { translations } from './i18n'

const LangContext = createContext()

export function LangProvider({ children }) {
  const [lang, setLang] = useState('zh')
  const toggle = () => setLang(l => l === 'zh' ? 'en' : 'zh')
  const t = translations[lang]
  return (
    <LangContext.Provider value={{ lang, toggle, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
