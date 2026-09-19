/**
 * client/src/pages/Connect.jsx — LLM Provider Setup page (/connect)
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import ConnectPanel from '../components/ConnectPanel'
import Navbar from '../components/Navbar'
import { useLLM } from '../context/LLMContext'
import ErrorBoundary from '../components/ErrorBoundary'
import { useToast } from '../components/Toast'

export default function Connect() {
  const navigate    = useNavigate()
  const { llmState } = useLLM()
  const toast        = useToast()

  function handleSkip() {
    toast('Make sure LLM_PROVIDER and your API key are set in .env', 'warning')
    navigate('/')
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-10">
          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-mono font-medium text-cyan mb-2">Connect LLM</h1>
            <p className="text-muted text-sm">Select a provider and enter your API key to enable AI-powered testing</p>
          </div>

          {/* Currently connected banner */}
          {llmState.configured && (
            <div className="mb-6 p-4 bg-green/10 border border-green/30 rounded-lg flex items-center justify-between gap-4">
              <div className="text-green text-sm">
                <span className="font-semibold">Currently connected:</span>{' '}
                {llmState.displayName} · {llmState.model}
              </div>
              <button
                onClick={() => navigate('/')}
                className="text-green text-sm underline hover:no-underline shrink-0"
                aria-label="Continue to testing page"
              >
                Continue →
              </button>
            </div>
          )}

          <ConnectPanel />

          {/* Action buttons */}
          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="px-8 py-3 rounded-xl font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg, rgb(var(--tw-cyan)), rgb(var(--tw-purple) / 0.8))', color: 'rgb(var(--tw-bg))', boxShadow: '0 0 20px rgb(var(--tw-cyan) / 0.2)' }}
              aria-label="Continue to the testing page"
            >
              Continue to Testing →
            </button>
            <button
              onClick={handleSkip}
              className="text-muted text-xs hover:text-white transition-colors underline"
              aria-label="Skip and use .env configuration"
            >
              Skip for now (using .env config)
            </button>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
