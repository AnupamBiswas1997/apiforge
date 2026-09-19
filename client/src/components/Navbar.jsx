/**
 * client/src/components/Navbar.jsx — Global navigation bar
 * Branding: APIForge
 */

import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLLM } from '../context/LLMContext'
import { useTheme } from '../context/ThemeContext'
import { LLMStatusBadge } from './LLMStatusBadge'

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

/** Forge icon — stylised anvil/lightning */
function ForgeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" opacity="0.9"/>
    </svg>
  )
}

export function Navbar() {
  const { llmState } = useLLM()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()

  const navLink = (to, label) => (
    <Link
      to={to}
      className={`relative text-sm font-medium transition-colors px-1 py-0.5 ${
        location.pathname === to
          ? 'text-cyan'
          : 'text-muted hover:text-white'
      }`}
    >
      {label}
      {location.pathname === to && (
        <span className="absolute -bottom-3 left-0 right-0 h-[2px] bg-cyan rounded-full" />
      )}
    </Link>
  )

  return (
    <nav
      className="sticky top-0 z-50 border-b border-border/60"
      style={{ background: 'rgb(var(--tw-bg) / 0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div className="max-w-7xl mx-auto px-4 h-13 flex items-center justify-between" style={{ height: '52px' }}>
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <span className="text-cyan group-hover:drop-shadow-[0_0_8px_rgb(99_179_237_/0.6)] transition-all">
            <ForgeIcon />
          </span>
          <span className="font-semibold text-white tracking-tight text-base">
            API<span className="text-cyan">Forge</span>
          </span>
          <span className="text-muted text-xs hidden sm:block font-normal ml-0.5">AI Testing</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-5">
          {navLink('/', 'New Run')}
          {navLink('/history', 'History')}

          {/* LLM connect */}
          <Link
            to="/connect"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors font-medium"
            aria-label={llmState.configured ? 'LLM connected' : 'Connect LLM'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${llmState.configured ? 'bg-green shadow-[0_0_6px_rgb(72_199_142_/0.7)]' : 'bg-red animate-pulse'}`}
              aria-hidden="true"
            />
            <span className="hidden sm:block">Connect</span>
          </Link>

          <LLMStatusBadge className="hidden md:flex" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border/60 text-muted hover:text-white hover:border-cyan/30 hover:bg-cyan/5 transition-all"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>
    </nav>
  )
}

export default Navbar
