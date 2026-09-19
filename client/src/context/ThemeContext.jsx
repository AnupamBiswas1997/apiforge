/**
 * client/src/context/ThemeContext.jsx — Global dark/light theme state
 */

import React, { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'apiforge_theme'

/** Apply theme class to <html> immediately (used both at init and on change) */
function applyTheme(theme) {
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(`theme-${theme}`)
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const t = readStoredTheme()
    // Apply synchronously during init to prevent flash
    applyTheme(t)
    return t
  })

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'))
  const setTheme    = (t) => { if (t === 'dark' || t === 'light') setThemeState(t) }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
