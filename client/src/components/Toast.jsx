/**
 * client/src/components/Toast.jsx
 *
 * ToastProvider wraps the app. useToast() returns addToast(message, type, duration).
 * Types: 'info' | 'success' | 'error' | 'warning'
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

const TYPE_STYLES = {
  info:    'border-cyan/40  bg-cyan/10  text-cyan',
  success: 'border-green/40 bg-green/10 text-green',
  error:   'border-red/40   bg-red/10   text-red',
  warning: 'border-amber/40 bg-amber/10 text-amber',
}

const TYPE_ICONS = {
  info: 'ℹ', success: '✓', error: '✕', warning: '⚠',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none max-w-sm w-full"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-card pointer-events-auto fade-in ${TYPE_STYLES[t.type] || TYPE_STYLES.info}`}
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
            role="alert"
          >
            <span className="shrink-0 mt-px" aria-hidden="true">{TYPE_ICONS[t.type]}</span>
            <span className="flex-1 break-words">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1 text-base leading-none"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Returns addToast(message, type?, duration?) — call directly.
 * @example const toast = useToast(); toast('Saved!', 'success')
 */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
