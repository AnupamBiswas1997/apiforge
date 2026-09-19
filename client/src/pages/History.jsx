/**
 * client/src/pages/History.jsx — Run history page (/history)
 *
 * Lists all past test runs with pass rate, LLM provenance, and delete/view actions.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Navbar from '../components/Navbar'
import { useToast } from '../components/Toast'
import ErrorBoundary from '../components/ErrorBoundary'
import ProviderIcon from '../components/ProviderIcon'

// ── Helpers (defined outside component to avoid re-creation on render) ────────

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function passRateColor(rate) {
  if (rate >= 80) return 'text-green'
  if (rate >= 50) return 'text-amber'
  return 'text-red'
}

function PassRateBar({ rate, status }) {
  const pct   = typeof rate === 'number' ? Math.round(rate) : 0
  const color = pct >= 80 ? 'bg-green' : pct >= 50 ? 'bg-amber' : 'bg-red'

  if (status === 'running') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
          <div className="h-full bg-cyan rounded-full animate-pulse" style={{ width: '40%' }} />
        </div>
        <span className="text-xs font-mono text-cyan w-10 text-right">…</span>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
          <div className="h-full bg-red rounded-full" style={{ width: '100%' }} />
        </div>
        <span className="text-xs font-mono text-red w-10 text-right">ERR</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Pass rate: ${pct}%`}>
      <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-mono font-bold ${passRateColor(pct)} w-10 text-right tabular-nums`}>
        {pct}%
      </span>
    </div>
  )
}

// Empty state is pure UI with no hooks — safe to define outside
function EmptyState({ onConnect, onUpload }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-5" aria-hidden="true">📋</div>
      <h2 className="text-xl font-semibold text-white mb-2">No runs yet</h2>
      <p className="text-muted mb-8 max-w-sm text-sm leading-relaxed">
        Run your first API test and it will appear here with full results and LLM provenance.
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={onConnect}
          className="px-4 py-2 rounded-lg border border-cyan text-cyan hover:bg-cyan/10 transition-colors text-sm font-medium"
        >
          Connect LLM →
        </button>
        <button
          onClick={onUpload}
          className="px-4 py-2 rounded-lg bg-cyan text-bg font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Start Testing →
        </button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function History() {
  const navigate     = useNavigate()
  const toast        = useToast()   // returns addToast function directly

  const [runs,          setRuns]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [deletingId,    setDeletingId]    = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get('/api/runs')
      const sorted = [...(data || [])].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      )
      setRuns(sorted)
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to load runs'
      setError(msg)
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  async function handleDelete(runId) {
    if (confirmDelete !== runId) {
      setConfirmDelete(runId)
      return
    }
    setDeletingId(runId)
    setConfirmDelete(null)
    try {
      await axios.delete(`/api/runs/${runId}`)
      setRuns((prev) => prev.filter((r) => (r.runId || r.id) !== runId))
      toast('Run deleted', 'success')
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Failed to delete run', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg">
        <Navbar />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Run History</h1>
              <p className="text-muted mt-0.5 text-sm">
                {loading ? 'Loading…' : `${runs.length} run${runs.length !== 1 ? 's' : ''} total`}
              </p>
            </div>
            {!loading && runs.length > 0 && (
              <button
                onClick={fetchRuns}
                className="text-sm text-muted hover:text-cyan transition-colors flex items-center gap-1.5"
                aria-label="Refresh run list"
              >
                <span aria-hidden="true">↻</span> Refresh
              </button>
            )}
          </div>

          {/* Loading skeletons */}
          {loading && (
            <div className="space-y-3" aria-live="polite" aria-busy="true">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-surface border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="bg-red/10 border border-red/30 rounded-lg p-6 text-center">
              <p className="text-red font-medium mb-3">{error}</p>
              <button onClick={fetchRuns} className="text-sm text-muted hover:text-white transition-colors">
                Try again
              </button>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && runs.length === 0 && (
            <EmptyState onConnect={() => navigate('/connect')} onUpload={() => navigate('/')} />
          )}

          {/* Table */}
          {!loading && !error && runs.length > 0 && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              {/* Desktop header */}
              <div className="hidden md:grid grid-cols-[1fr_1fr_160px_80px_200px_130px] gap-4 px-5 py-3 border-b border-border text-xs font-semibold text-muted uppercase tracking-wider">
                <div>Date / ID</div>
                <div>Base URL</div>
                <div>LLM</div>
                <div className="text-center">Tests</div>
                <div>Pass Rate</div>
                <div className="text-right">Actions</div>
              </div>

              <ul aria-label="Run history">
                {runs.map((run) => {
                  const runId       = run.runId || run.id
                  const isDeleting  = deletingId  === runId
                  const isConfirming = confirmDelete === runId
                  const providerKey = run.llmProvider?.key || 'anthropic'
                  const model       = run.llmProvider?.model || '—'
                  const shortModel  = model.length > 20 ? model.slice(0, 20) + '…' : model

                  return (
                    <li
                      key={runId}
                      className={`border-b border-border last:border-0 px-5 py-4 transition-colors hover:bg-border/20 ${
                        isDeleting ? 'opacity-40 pointer-events-none' : ''
                      }`}
                    >
                      {/* ── Mobile layout ── */}
                      <div className="md:hidden space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted">{formatDate(run.createdAt)}</span>
                          <span className="text-xs font-mono text-cyan truncate">{runId}</span>
                        </div>
                        <div className="font-mono text-sm text-white truncate">{run.baseUrl || '—'}</div>
                        <div className="flex items-center gap-2">
                          <ProviderIcon provider={providerKey} size={13} />
                          <span className="text-xs text-muted truncate">{shortModel}</span>
                          <span className="ml-auto text-xs text-muted">{run.totalTests ?? 0} tests</span>
                        </div>
                        <PassRateBar rate={run.passRate ?? 0} status={run.status} />
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => navigate(`/report/${runId}`)}
                            className="flex-1 py-1.5 text-xs rounded bg-cyan/10 text-cyan border border-cyan/20 hover:bg-cyan/20 transition-colors font-medium"
                          >
                            View Report
                          </button>
                          {isConfirming ? (
                            <div className="flex gap-1">
                              <button onClick={() => handleDelete(runId)} className="px-3 py-1.5 text-xs rounded bg-red/20 text-red border border-red/30 hover:bg-red/30 font-medium">Confirm</button>
                              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-white">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => handleDelete(runId)} className="px-3 py-1.5 text-xs rounded border border-border text-muted hover:text-red hover:border-red/30 transition-colors">Delete</button>
                          )}
                        </div>
                      </div>

                      {/* ── Desktop layout ── */}
                      <div className="hidden md:grid grid-cols-[1fr_1fr_160px_80px_200px_130px] gap-4 items-center">
                        <div>
                          <div className="text-sm text-white">{formatDate(run.createdAt)}</div>
                          <div className="text-xs text-muted font-mono mt-0.5 truncate">{runId}</div>
                        </div>
                        <div className="font-mono text-sm text-cyan truncate" title={run.baseUrl}>{run.baseUrl || '—'}</div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ProviderIcon provider={providerKey} size={15} />
                          <span className="text-xs text-white truncate" title={model}>{shortModel}</span>
                        </div>
                        <div className="text-sm text-muted text-center tabular-nums">{run.totalTests ?? 0}</div>
                        <PassRateBar rate={run.passRate ?? 0} status={run.status} />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => navigate(`/report/${runId}`)}
                            className="px-3 py-1 text-xs rounded bg-cyan/10 text-cyan border border-cyan/20 hover:bg-cyan/20 transition-colors font-medium"
                            aria-label={`View report for run ${runId}`}
                          >
                            View
                          </button>
                          {isConfirming ? (
                            <div className="flex gap-1">
                              <button onClick={() => handleDelete(runId)} className="px-2 py-1 text-xs rounded bg-red/20 text-red border border-red/30 hover:bg-red/30 font-medium" aria-label="Confirm delete">✓</button>
                              <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs rounded border border-border text-muted hover:text-white" aria-label="Cancel">✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDelete(runId)}
                              className="px-2 py-1 text-xs rounded border border-border text-muted hover:text-red hover:border-red/30 transition-colors"
                              aria-label={`Delete run ${runId}`}
                            >
                              Del
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </main>
      </div>
    </ErrorBoundary>
  )
}
