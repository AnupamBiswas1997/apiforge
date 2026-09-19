/**
 * client/src/components/Badges.jsx
 * MethodBadge, ResultBadge, MetricCard, SkeletonLoader, StepProgress
 * All use Tailwind opacity classes that now correctly reference CSS variables.
 */

import React from 'react'

const METHOD_COLORS = {
  GET:    'text-green  border-green/40  bg-green/10',
  POST:   'text-cyan   border-cyan/40   bg-cyan/10',
  PUT:    'text-amber  border-amber/40  bg-amber/10',
  PATCH:  'text-amber  border-amber/40  bg-amber/10',
  DELETE: 'text-red    border-red/40    bg-red/10',
}

export function MethodBadge({ method }) {
  const color = METHOD_COLORS[method?.toUpperCase()] || 'text-muted border-border bg-surface'
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-mono font-semibold shrink-0 ${color}`}>
      {method?.toUpperCase() || '?'}
    </span>
  )
}

const RESULT_CONFIG = {
  pass:    { label: 'PASS',    color: 'text-green  border-green/40  bg-green/10',  icon: '✓' },
  fail:    { label: 'FAIL',    color: 'text-red    border-red/40    bg-red/10',    icon: '✕' },
  warning: { label: 'WARN',    color: 'text-amber  border-amber/40  bg-amber/10',  icon: '⚠' },
  skipped: { label: 'SKIP',    color: 'text-muted  border-border    bg-surface',   icon: '—' },
  running: { label: 'RUNNING', color: 'text-cyan   border-cyan/40   bg-cyan/10',   icon: '…' },
  error:   { label: 'ERROR',   color: 'text-red    border-red/40    bg-red/10',    icon: '✕' },
}

export function ResultBadge({ result }) {
  const cfg = RESULT_CONFIG[result] || RESULT_CONFIG.running
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono font-semibold shrink-0 ${cfg.color}`}
      aria-label={`Result: ${cfg.label}`}
    >
      <span aria-hidden="true">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}

export function MetricCard({ label, value, color = 'text-white', sublabel }) {
  return (
    <div
      className="border border-border/60 rounded-xl p-4 flex flex-col gap-1 transition-all hover:border-border"
      style={{ background: 'rgb(var(--tw-surface) / 0.7)', backdropFilter: 'blur(8px)' }}
    >
      <div className="text-muted/70 text-xs font-medium uppercase tracking-wider">{label}</div>
      <div className={`text-3xl font-mono font-bold tabular-nums ${color}`}>{value ?? 0}</div>
      {sublabel && <div className="text-muted/60 text-xs">{sublabel}</div>}
    </div>
  )
}

export function SkeletonLoader({ lines = 3, className = '' }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} aria-label="Loading…" role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-surface rounded"
          style={{ width: `${60 + (i % 3) * 15}%` }}
        />
      ))}
    </div>
  )
}

export function StepProgress({ steps, currentStep }) {
  return (
    <div className="flex items-center" role="list" aria-label="Pipeline steps">
      {steps.map((step, idx) => {
        const num    = idx + 1
        const done   = num < currentStep
        const active = num === currentStep

        return (
          <React.Fragment key={num}>
            <div className="flex flex-col items-center gap-1" role="listitem">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono border-2 transition-all ${
                  done   ? 'bg-green/20 border-green text-green'         :
                  active ? 'bg-cyan/20  border-cyan  text-cyan pulse-glow' :
                           'bg-surface  border-border text-muted'
                }`}
                aria-label={`Step ${num}: ${step.label} — ${done ? 'complete' : active ? 'active' : 'pending'}`}
              >
                {done ? '✓' : num}
              </div>
              <span className={`text-xs font-mono hidden sm:block ${
                active ? 'text-cyan' : done ? 'text-green' : 'text-muted'
              }`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-1 transition-colors ${done ? 'bg-green/50' : 'bg-border'}`}
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
