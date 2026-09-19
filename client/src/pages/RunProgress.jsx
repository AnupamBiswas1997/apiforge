/**
 * client/src/pages/RunProgress.jsx — Live pipeline execution view (/run/:runId)
 */

import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSSE } from '../hooks/useSSE'
import { StepProgress } from '../components/Badges'
import ErrorBoundary from '../components/ErrorBoundary'
import Navbar from '../components/Navbar'

const STEPS = [
  { label: 'Extract' },
  { label: 'Gen Cases' },
  { label: 'Gen Payloads' },
  { label: 'Execute APIs' },
  { label: 'Analyze' },
  { label: 'Report' },
]

export default function RunProgress() {
  const { runId }  = useParams()
  const navigate   = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [logs,        setLogs]        = useState([])
  const [stepLabel,   setStepLabel]   = useState('Extract Requirements')
  const [progress,    setProgress]    = useState(0)
  const [complete,    setComplete]    = useState(false)
  const [error,       setError]       = useState(null)
  const logRef     = useRef(null)
  const navTimerRef = useRef(null)

  // Cleanup nav timer on unmount so we never call navigate on an unmounted component
  useEffect(() => {
    return () => { if (navTimerRef.current) clearTimeout(navTimerRef.current) }
  }, [])

  // Auto-scroll log panel to bottom on new entries
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const addLog = (text, type = 'normal') =>
    setLogs((l) => [...l, { text, ts: new Date().toLocaleTimeString(), type }])

  const { streamError } = useSSE(runId ? `/api/runs/${runId}/stream` : null, {
    onStep: (data) => {
      setCurrentStep(data.step)
      setStepLabel(data.label)
      setProgress(data.progress ?? Math.round(((data.step - 1) / 6) * 100))
      addLog(`[Step ${data.step}] ${data.label}`)
    },
    onLog: (data) => {
      addLog(data.message)
    },
    onComplete: (data) => {
      setComplete(true)
      setProgress(100)
      addLog('✓ Run complete — loading report...', 'success')
      navTimerRef.current = setTimeout(() => navigate(`/report/${data.runId || runId}`), 1200)
    },
    onError: (data) => {
      setError(data.message || 'An unexpected error occurred')
      addLog(`✕ ${data.message}`, 'error')
    },
  })

  const stepPct = Math.round(((currentStep - 1) / 6) * 100)
  const displayProgress = complete ? 100 : Math.max(progress, stepPct)

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-10 fade-in">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h1 className="text-xl font-semibold text-white tracking-tight">Pipeline Running</h1>
              <span className="text-xs font-mono text-muted/70 bg-surface border border-border/60 px-2 py-0.5 rounded-md">{runId}</span>
            </div>
            <p className="text-muted text-sm">
              {complete ? 'Pipeline finished successfully.' : error ? 'Pipeline stopped with an error.' : 'AI pipeline running — typically 1–5 minutes.'}
            </p>
          </div>

          {/* Main card */}
          <div className="rounded-2xl border border-border/60 overflow-hidden shadow-card" style={{ background: 'rgb(var(--tw-surface) / 0.6)', backdropFilter: 'blur(12px)' }}>

            {/* Progress header */}
            <div className="px-6 pt-6 pb-5 border-b border-border/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-white">
                  {error ? (
                    <span className="text-red flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red" />
                      Error — {error}
                    </span>
                  ) : complete ? (
                    <span className="text-green flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green shadow-[0_0_6px_rgb(72_199_142_/0.7)]" />
                      Complete — navigating to report…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan animate-pulse shadow-[0_0_6px_rgb(99_179_237_/0.6)]" />
                      {stepLabel}
                    </span>
                  )}
                </span>
                <span className="text-sm font-mono font-semibold text-cyan">{displayProgress}%</span>
              </div>

              {/* Gradient progress bar */}
              <div className="w-full h-1.5 bg-border/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${displayProgress}%`,
                    background: complete
                      ? 'linear-gradient(90deg, rgb(var(--tw-green)), rgb(72 199 142 / 0.8))'
                      : error
                      ? 'rgb(var(--tw-red))'
                      : 'linear-gradient(90deg, rgb(var(--tw-cyan)), rgb(var(--tw-purple)))',
                    boxShadow: complete ? '0 0 8px rgb(72 199 142 / 0.4)' : error ? 'none' : '0 0 8px rgb(99 179 237 / 0.4)',
                  }}
                  role="progressbar"
                  aria-valuenow={displayProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>

            {/* Step indicators */}
            <div className="px-6 py-4 border-b border-border/40">
              <StepProgress steps={STEPS} currentStep={currentStep} />
            </div>

            {/* Log panel */}
            <div
              ref={logRef}
              className="log-panel p-5 h-72 overflow-y-auto"
              style={{ background: 'rgb(10 10 15 / 0.5)' }}
              role="log"
              aria-label="Pipeline execution log"
              aria-live="polite"
            >
              {logs.length === 0 ? (
                <span className="text-muted/50 italic text-xs">Connecting to pipeline…</span>
              ) : (
                logs.map((entry, i) => (
                  <div
                    key={i}
                    className={`mb-0.5 leading-relaxed text-xs ${
                      entry.type === 'success' ? 'text-green' :
                      entry.type === 'error'   ? 'text-red'   : 'text-muted/80'
                    }`}
                  >
                    <span className="text-muted/30 mr-2 select-none tabular-nums">{entry.ts}</span>
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SSE transport error */}
          {streamError && !error && (
            <div className="mt-4 p-3 bg-amber/10 border border-amber/30 rounded-lg text-amber text-xs font-mono">
              ⚠ {streamError}
            </div>
          )}

          {/* Error navigation */}
          {error && (
            <div className="mt-6 flex gap-3 flex-wrap">
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-surface border border-border/60 rounded-lg text-sm font-medium text-muted hover:text-white hover:border-cyan/30 transition-all"
              >
                ← New Run
              </button>
              <button
                onClick={() => navigate('/history')}
                className="px-4 py-2 bg-surface border border-border/60 rounded-lg text-sm font-medium text-muted hover:text-white hover:border-cyan/30 transition-all"
              >
                History
              </button>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}
