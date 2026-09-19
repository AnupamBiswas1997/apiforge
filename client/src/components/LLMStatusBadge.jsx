/**
 * client/src/components/LLMStatusBadge.jsx
 * Shows active LLM provider. Click to navigate to /connect.
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useLLM } from '../context/LLMContext'
import { ProviderIcon } from './ProviderIcon'

function trimModel(model) {
  if (!model) return ''
  // For namespaced models like anthropic/claude-sonnet → claude-sonnet
  const slash = model.lastIndexOf('/')
  const base  = slash >= 0 ? model.slice(slash + 1) : model
  // Take first two dash-segments for brevity
  return base.split('-').slice(0, 3).join('-')
}

export function LLMStatusBadge({ className = '' }) {
  const { llmState } = useLLM()
  const navigate     = useNavigate()

  if (llmState.loading) return null

  if (!llmState.configured) {
    return (
      <button
        onClick={() => navigate('/connect')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red/40 bg-red/10 text-red text-xs font-mono hover:border-red/70 transition-colors ${className}`}
        aria-label="No LLM provider connected. Click to connect."
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse shrink-0" aria-hidden="true" />
        Not connected
      </button>
    )
  }

  return (
    <button
      onClick={() => navigate('/connect')}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cyan/30 bg-cyan/10 text-cyan text-xs font-mono hover:border-cyan/60 transition-colors ${className}`}
      aria-label={`Connected to ${llmState.displayName}. Click to change.`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-cyan shrink-0" aria-hidden="true" />
      <ProviderIcon provider={llmState.provider} size={12} />
      <span className="max-w-[80px] truncate">{llmState.displayName || llmState.provider}</span>
      {llmState.model && (
        <span className="opacity-50 shrink-0">· {trimModel(llmState.model)}</span>
      )}
    </button>
  )
}

export default LLMStatusBadge
