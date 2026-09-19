/**
 * client/src/pages/Report.jsx — Test run report dashboard (/report/:runId)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useRun } from '../hooks/useRun'
import { MethodBadge, ResultBadge, MetricCard, SkeletonLoader } from '../components/Badges'
import JsonViewer from '../components/JsonViewer'
import ProviderIcon from '../components/ProviderIcon'
import ErrorBoundary from '../components/ErrorBoundary'
import Navbar from '../components/Navbar'
import { useToast } from '../components/Toast'

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Format a number of tokens as a compact string e.g. 12,345 or 1.2k */
function fmtTokens(n) {
  if (n == null) return '—'   // provider doesn't return token counts
  if (n === 0)   return '0'
  return n.toLocaleString()
}

/** Bar width for per-step token breakdown */
function tokenPct(tokens, total) {
  if (!total || !tokens) return 0
  return Math.round((tokens / total) * 100)
}

export default function Report() {
  const { runId }  = useParams()
  const navigate   = useNavigate()
  const toast      = useToast()
  const { run, loading, error } = useRun(runId)

  const [filter,     setFilter]     = useState('all')
  const [search,     setSearch]     = useState('')
  const [selectedTc, setSelectedTc] = useState(null)
  const [activeTab,  setActiveTab]  = useState('request')
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [rerunning,  setRerunning]  = useState(false)

  const testCases     = run?.testCases || []
  const filteredCases = testCases.filter((tc) => {
    const matchFilter = filter === 'all' || tc.verdict?.result === filter
    const matchSearch = !search ||
      tc.name?.toLowerCase().includes(search.toLowerCase()) ||
      tc.endpoint?.toLowerCase().includes(search.toLowerCase()) ||
      tc.actualResponse?.actualUrl?.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  })

  const handleKeyDown = useCallback((e) => {
    if (!filteredCases.length) return
    const idx = selectedTc ? filteredCases.findIndex((t) => t.id === selectedTc.id) : -1
    if (e.key === 'Escape') { setSelectedTc(null); return }
    if (e.key === 'ArrowDown' && idx < filteredCases.length - 1) { setSelectedTc(filteredCases[idx + 1]); e.preventDefault() }
    if (e.key === 'ArrowUp'   && idx > 0)                        { setSelectedTc(filteredCases[idx - 1]); e.preventDefault() }
  }, [filteredCases, selectedTc])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  function handleDownload() {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `${runId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setDeleting(true); setConfirmDel(false)
    try { await axios.delete(`/api/runs/${runId}`); navigate('/history') }
    catch { toast('Failed to delete run', 'error'); setDeleting(false) }
  }

  async function handleRerun() {
    if (rerunning) return
    setRerunning(true)
    try {
      const { data } = await axios.post(`/api/runs/${runId}/rerun`, { dryRun: run.dryRun })
      navigate(`/run/${data.runId}`)
    } catch (err) {
      toast(err.response?.data?.error?.message || 'Failed to start re-run', 'error')
      setRerunning(false)
    }
  }

  // ── Loading / error ──────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-10"><SkeletonLoader lines={8} /></div>
    </div>
  )

  if (error || !run) return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="text-4xl mb-4">⚠</div>
        <div className="text-red font-medium mb-2">Failed to load report</div>
        <div className="text-muted text-sm mb-6">{error || 'Run not found'}</div>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate('/')} className="px-4 py-2 text-sm border border-border rounded text-muted hover:text-white transition-colors">← Back</button>
          <button onClick={() => navigate('/history')} className="px-4 py-2 text-sm border border-border rounded text-muted hover:text-white transition-colors">History</button>
        </div>
      </div>
    </div>
  )

  // Derive categories from actual test data — don't assume fixed list
  const allCategories = [...new Set(testCases.map((t) => t.category).filter(Boolean))]
  const FALLBACK_CATEGORIES = ['happy_path', 'negative', 'edge_case', 'auth']
  const categoryList = allCategories.length > 0 ? allCategories : FALLBACK_CATEGORIES
  const CATEGORY_COUNTS = categoryList.map((cat) => ({
    cat,
    count: testCases.filter((t) => t.category === cat).length,
    pass:  testCases.filter((t) => t.category === cat && t.verdict?.result === 'pass').length,
  })).filter((cc) => cc.count > 0) // only show categories that have test cases

  // Per-step token data for the breakdown bar
  const STEP_TOKEN_MAP = { step1: 'Extract', step2: 'Test Cases', step3: 'Payloads', step5: 'Analysis', step6: 'Summary' }
  const totalTokens = run.totalTokensUsed ?? 0
  const hasTokens   = totalTokens > 0

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg font-sans">
        <Navbar />

        {/* ── Sticky summary bar ── */}
        <div className="sticky top-[52px] z-40 border-b border-border/50" style={{ background: 'rgb(var(--tw-bg) / 0.9)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          <div className="max-w-7xl mx-auto px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3 min-w-0 flex-wrap">
                <span className="text-xs font-mono text-muted">{runId}</span>
                {/* Full endpoint URL — this is what every request was sent to */}
                {run.baseUrl && run.baseUrl.startsWith('http') && (
                  <>
                    <span className="text-muted text-xs hidden sm:block">·</span>
                    <a
                      href={run.baseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono text-cyan hover:underline truncate hidden sm:block max-w-xs"
                      title={run.baseUrl}
                    >
                      {run.baseUrl}
                    </a>
                  </>
                )}
                {run.llmProvider && (
                  <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface border border-border text-xs font-mono text-muted">
                    <ProviderIcon provider={run.llmProvider.key} size={12} />
                    <span>{run.llmProvider.displayName}</span>
                    <span className="opacity-60">· {run.llmProvider.model?.split('-').slice(0, 2).join('-')}</span>
                    {/* Token count in sticky bar so it's always visible */}
                    {hasTokens && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="text-cyan">{fmtTokens(totalTokens)} tokens</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleDownload} className="px-3 py-1.5 text-xs font-mono border border-border rounded hover:border-cyan/50 text-muted hover:text-cyan transition-colors" aria-label="Download JSON">↓ JSON</button>
                {run.status === 'complete' && (
                  <button
                    onClick={handleRerun}
                    disabled={rerunning}
                    className="px-3 py-1.5 text-xs font-mono border border-green/30 rounded hover:border-green/60 text-green/70 hover:text-green transition-colors disabled:opacity-40"
                    aria-label="Re-run tests using existing test cases and payloads"
                    title="Re-execute Steps 4–6 using the existing test cases and payloads"
                  >
                    {rerunning ? '…' : '▶ Re-run'}
                  </button>
                )}
                {confirmDel ? (
                  <div className="flex gap-1">
                    <button onClick={handleDelete} disabled={deleting} className="px-3 py-1.5 text-xs font-mono border border-red/60 rounded bg-red/20 text-red hover:bg-red/30 disabled:opacity-40">{deleting ? '…' : 'Confirm'}</button>
                    <button onClick={() => setConfirmDel(false)} className="px-3 py-1.5 text-xs font-mono border border-border rounded text-muted hover:text-white">Cancel</button>
                  </div>
                ) : (
                  <button onClick={handleDelete} className="px-3 py-1.5 text-xs font-mono border border-red/30 rounded hover:border-red/60 text-red/60 hover:text-red transition-colors">Delete</button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          {/* ── Metric cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <MetricCard label="Total Tests" value={run.totalTests ?? 0} />
            <MetricCard label="Passed"   value={run.passed   ?? 0} color="text-green" sublabel="✓ All checks pass" />
            <MetricCard label="Failed"   value={run.failed   ?? 0} color="text-red"   sublabel="✕ Issues found" />
            <MetricCard label="Warnings" value={run.warnings ?? 0} color="text-amber" sublabel="⚠ Needs review" />
            <MetricCard
              label="LLM Tokens"
              value={run.status === 'running' ? '…' : fmtTokens(totalTokens)}
              color="text-cyan"
              sublabel={run.status === 'running' ? 'accumulating…' : 'total across all steps'}
            />
          </div>

          {/* ── Token usage breakdown — prominent, right after metrics ── */}
          <div className="bg-surface border border-cyan/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span className="text-cyan" aria-hidden="true">⬡</span>
                  LLM Token Usage
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Total tokens consumed across all AI steps for this test run
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-mono font-bold text-cyan tabular-nums">
                  {run.status === 'running' ? '…' : fmtTokens(totalTokens)}
                </div>
                <div className="text-xs text-muted font-mono">
                  {run.llmProvider?.displayName || run.llmProvider?.key || 'LLM'} · {run.llmProvider?.model}
                </div>
              </div>
            </div>

            {/* Horizontal stacked bar */}
            {hasTokens && run.tokensByStep && (
              <div className="space-y-3">
                {/* Stacked bar */}
                <div className="w-full h-3 bg-bg rounded-full overflow-hidden flex">
                  {Object.entries(STEP_TOKEN_MAP).map(([key, label], i) => {
                    const t   = run.tokensByStep[key] ?? 0
                    const pct = tokenPct(t, totalTokens)
                    if (!pct) return null
                    const colors = ['bg-cyan', 'bg-green', 'bg-amber', 'bg-red', 'bg-muted']
                    return (
                      <div
                        key={key}
                        className={`h-full ${colors[i]} transition-all`}
                        style={{ width: `${pct}%` }}
                        title={`${label}: ${fmtTokens(t)} tokens (${pct}%)`}
                      />
                    )
                  })}
                </div>

                {/* Legend */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {Object.entries(STEP_TOKEN_MAP).map(([key, label], i) => {
                    const t   = run.tokensByStep[key] ?? 0
                    if (!t) return null
                    const colors = ['text-cyan', 'text-green', 'text-amber', 'text-red', 'text-muted']
                    const dotColors = ['bg-cyan', 'bg-green', 'bg-amber', 'bg-red', 'bg-muted']
                    return (
                      <div key={key} className="bg-bg border border-border rounded-lg p-2.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColors[i]}`} aria-hidden="true" />
                          <span className="text-xs text-muted font-mono uppercase tracking-wider">{label}</span>
                        </div>
                        <div className={`text-base font-mono font-bold tabular-nums ${colors[i]}`}>
                          {fmtTokens(t)}
                        </div>
                        <div className="text-xs text-muted mt-0.5">{tokenPct(t, totalTokens)}% of total</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!hasTokens && (
              <div className="text-muted text-xs italic">
                {run.status === 'running'
                  ? 'Token counts will appear as each step completes.'
                  : 'Token counts not available — this provider may not report usage.'}
              </div>
            )}
          </div>

          {/* ── Pass rate ring + category chart ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface border border-border rounded-lg p-6 flex flex-col items-center justify-center">
              <div className="relative">
                <svg viewBox="0 0 80 80" className="w-28 h-28 -rotate-90" aria-label={`Pass rate: ${run.passRate}%`}>
                  <circle cx="40" cy="40" r="32" fill="none" stroke="var(--color-border)" strokeWidth="7" />
                  <circle
                    cx="40" cy="40" r="32" fill="none"
                    stroke={run.passRate >= 80 ? 'var(--color-green)' : run.passRate >= 50 ? 'var(--color-amber)' : 'var(--color-red)'}
                    strokeWidth="7"
                    strokeDasharray={`${(run.passRate / 100) * 201} 201`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-2xl font-mono font-bold text-white">{run.passRate}%</div>
                </div>
              </div>
              <div className="text-xs text-muted font-mono mt-2">pass rate</div>
              {run.dryRun && <div className="text-xs text-amber mt-1 font-mono">dry run</div>}
            </div>
            <div className="md:col-span-2 bg-surface border border-border rounded-lg p-5">
              <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-4">By Category</h3>
              <div className="space-y-3">
                {CATEGORY_COUNTS.map(({ cat, count, pass }) => (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted capitalize">{cat.split('_').join(' ')}</span>
                      <span className="text-muted font-mono">{pass}/{count}</span>
                    </div>
                    <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
                      <div className="h-full bg-green rounded-full transition-all" style={{ width: count > 0 ? `${(pass / count) * 100}%` : '0%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Extracted requirements ── */}
          {run.requirements?.length > 0 && (
            <details className="bg-surface border border-border rounded-lg group">
              <summary className="px-5 py-3 text-sm font-medium text-white cursor-pointer hover:text-cyan transition-colors list-none flex items-center justify-between">
                <span>Extracted Requirements ({run.requirements.length})</span>
                <span className="text-muted text-xs group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-5 pb-4 pt-1 space-y-2.5">
                {run.requirements.map((req, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm flex-wrap">
                    <div className="flex items-center gap-2 shrink-0">
                      <MethodBadge method={req.method} />
                      <code className="text-xs font-mono text-cyan">{run.baseUrl || ''}{req.endpoint}</code>
                    </div>
                    <span className="text-muted text-xs">{req.description}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* ── Test cases + detail panel ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* Left: filter + list */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="search" placeholder="Search tests or URLs…"
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 min-w-0 bg-surface border border-border rounded-md px-3 py-1.5 text-xs font-mono text-white placeholder:text-muted/50 focus:outline-none focus:border-cyan/50 transition-colors"
                  aria-label="Search test cases"
                />
                <select
                  value={filter} onChange={(e) => { setFilter(e.target.value); setSelectedTc(null) }}
                  className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs font-mono text-muted focus:outline-none focus:border-cyan/50"
                  aria-label="Filter by result"
                >
                  <option value="all">All ({testCases.length})</option>
                  <option value="pass">Pass ({testCases.filter((t) => t.verdict?.result === 'pass').length})</option>
                  <option value="fail">Fail ({testCases.filter((t) => t.verdict?.result === 'fail').length})</option>
                  <option value="warning">Warn ({testCases.filter((t) => t.verdict?.result === 'warning').length})</option>
                  <option value="skipped">Skip ({testCases.filter((t) => t.verdict?.result === 'skipped').length})</option>
                </select>
              </div>
              <p className="text-xs text-muted font-mono">{filteredCases.length} test{filteredCases.length !== 1 ? 's' : ''} · ↑↓ navigate · Esc close</p>

              <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
                {filteredCases.length === 0 ? (
                  <div className="text-center text-muted text-sm py-8">No matching tests</div>
                ) : filteredCases.map((tc) => {
                  // Derive the full URL for display in the list
                  const fullUrl = tc.actualResponse?.actualUrl || `${run.baseUrl || ''}${tc.endpoint}`
                  return (
                    <button
                      key={tc.id}
                      onClick={() => { setSelectedTc(selectedTc?.id === tc.id ? null : tc); setActiveTab('request') }}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${selectedTc?.id === tc.id ? 'border-cyan/40 bg-cyan/5 shadow-glow-sm' : 'border-border/50 hover:border-cyan/20'}`}
                      style={{ background: selectedTc?.id === tc.id ? undefined : 'rgb(var(--tw-surface) / 0.5)' }}
                      aria-pressed={selectedTc?.id === tc.id}
                      aria-label={`${tc.name} — ${tc.verdict?.result || 'pending'}`}
                    >
                      <div className="flex items-start gap-2">
                        <MethodBadge method={tc.method} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white font-medium truncate">{tc.name}</div>
                          {/* Show the actual full URL directly in the list */}
                          <div className="text-xs font-mono text-cyan truncate mt-0.5" title={fullUrl}>{fullUrl}</div>
                        </div>
                        <ResultBadge result={tc.verdict?.result} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Right: detail panel */}
            <div className="lg:col-span-3">
              {selectedTc ? (
                <div className="bg-surface border border-border rounded-lg sticky top-28">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      <MethodBadge method={selectedTc.method} />
                      <span className="text-sm font-medium text-white truncate">{selectedTc.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ResultBadge result={selectedTc.verdict?.result} />
                      <button onClick={() => setSelectedTc(null)} className="text-muted hover:text-white ml-1 text-xl leading-none" aria-label="Close">×</button>
                    </div>
                  </div>

                  {/* Full URL bar — always visible at top of detail panel */}
                  <div className="px-5 py-2.5 bg-bg border-b border-border">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="text-muted shrink-0 font-mono">{selectedTc.method}</span>
                      <code className="font-mono text-cyan break-all flex-1">
                        {selectedTc.actualResponse?.actualUrl || `${run.baseUrl || ''}${selectedTc.endpoint}`}
                      </code>
                      {selectedTc.actualResponse?.skipped && (
                        <span className="text-amber text-xs shrink-0">(dry run)</span>
                      )}
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-border px-5">
                    {['request', 'response', 'verdict'].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-2 text-xs font-mono capitalize border-b-2 transition-colors ${activeTab === tab ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-white'}`}
                        aria-selected={activeTab === tab}
                        role="tab"
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="p-5 overflow-y-auto max-h-[420px]">

                    {/* ── Request tab ── */}
                    {activeTab === 'request' && (
                      <div className="space-y-4">
                        {selectedTc.request?.headers && Object.keys(selectedTc.request.headers).length > 0 && (
                          <div>
                            <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1.5">Headers</p>
                            <JsonViewer data={selectedTc.request.headers} maxHeight="100px" />
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1.5">Request Body</p>
                          {(() => {
                            const body = selectedTc.request?.request_body ?? selectedTc.request?.requestBody ?? null
                            return body
                              ? <JsonViewer data={body} maxHeight="280px" />
                              : <p className="text-muted text-xs italic">No request body</p>
                          })()}
                        </div>
                        {(() => {
                          const params = selectedTc.request?.query_params ?? selectedTc.request?.queryParams ?? null
                          return params && Object.keys(params).length > 0 ? (
                            <div>
                              <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1.5">Query Params</p>
                              <JsonViewer data={params} maxHeight="100px" />
                            </div>
                          ) : null
                        })()}
                      </div>
                    )}

                    {/* ── Response tab ── */}
                    {activeTab === 'response' && (
                      <div className="space-y-3">
                        {selectedTc.actualResponse?.error ? (
                          <div className="text-red text-xs font-mono p-3 bg-red/5 border border-red/20 rounded">{selectedTc.actualResponse.error}</div>
                        ) : selectedTc.actualResponse?.skipped ? (
                          <div className="text-muted text-xs italic p-3 bg-surface border border-border rounded">
                            Dry run — no HTTP request was sent.
                            <br /><span className="text-muted/60">Would have called: {selectedTc.actualResponse.actualUrl}</span>
                          </div>
                        ) : selectedTc.actualResponse ? (
                          <>
                            <div className="flex items-center gap-4 text-xs flex-wrap">
                              <span className="text-muted">Status:</span>
                              <code className={`font-mono font-bold text-sm ${
                                selectedTc.verdict?.result === 'pass' || selectedTc.verdict?.result === 'warning' ? 'text-green' :
                                selectedTc.verdict?.result === 'fail' ? 'text-red' :
                                selectedTc.actualResponse.actualStatusCode === selectedTc.expectedStatusCode ? 'text-green' : 'text-amber'
                              }`}>
                                {selectedTc.actualResponse.actualStatusCode}
                                {selectedTc.actualResponse.actualStatusCode !== selectedTc.expectedStatusCode && ` (expected ${selectedTc.expectedStatusCode})`}
                              </code>
                              <span className="text-muted">Duration:</span>
                              <code className="text-muted font-mono">{selectedTc.actualResponse.durationMs}ms</code>
                            </div>
                            <JsonViewer data={selectedTc.actualResponse.responseBody} maxHeight="280px" />
                          </>
                        ) : (
                          <p className="text-muted text-xs italic">No response data</p>
                        )}
                      </div>
                    )}

                    {/* ── Verdict tab (renamed from Expected) ── */}
                    {activeTab === 'verdict' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-4 text-xs flex-wrap">
                          <span className="text-muted">Expected status:</span>
                          <code className="text-cyan font-mono font-bold">{selectedTc.expectedStatusCode}</code>
                        </div>
                        <p className="text-xs text-muted leading-relaxed">{selectedTc.expectedBehavior}</p>
                        {selectedTc.verdict && (
                          <div className={`p-3 rounded-md border text-xs ${
                            selectedTc.verdict.result === 'pass'    ? 'border-green/30 bg-green/5' :
                            selectedTc.verdict.result === 'warning' ? 'border-amber/30 bg-amber/5' :
                            selectedTc.verdict.result === 'skipped' ? 'border-border bg-surface'   :
                                                                       'border-red/30 bg-red/5'
                          }`}>
                            <p className="mb-2 text-white leading-relaxed">{selectedTc.verdict.analysis}</p>
                            {selectedTc.verdict.issues?.length > 0 && (
                              <ul className="text-red space-y-0.5 mt-2">{selectedTc.verdict.issues.map((iss, i) => <li key={i}>⚠ {iss}</li>)}</ul>
                            )}
                            {selectedTc.verdict.suggestions?.length > 0 && (
                              <ul className="text-amber mt-2 space-y-0.5">{selectedTc.verdict.suggestions.map((s, i) => <li key={i}>→ {s}</li>)}</ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-lg p-10 text-center">
                  <div className="text-3xl mb-3">🔍</div>
                  <p className="text-muted text-sm">Select a test case to inspect details</p>
                  <p className="text-xs text-muted/60 mt-1">↑↓ arrow keys to navigate</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Executive summary ── */}
          {run.summary && (
            <div className="bg-surface border border-border rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Executive Summary</h3>
              <div className="text-sm text-muted leading-relaxed whitespace-pre-wrap">{run.summary}</div>
            </div>
          )}

          {/* ── Debug info ── */}
          <details className="bg-surface border border-border rounded-lg">
            <summary className="px-5 py-3 text-xs font-mono text-muted cursor-pointer hover:text-white transition-colors list-none flex items-center justify-between">
              <span>Debug Info</span><span>▼</span>
            </summary>
            <div className="px-5 pb-4 pt-1 space-y-1 text-xs font-mono text-muted">
              <div>runId: <span className="text-white">{run.runId}</span></div>
              <div>status: <span className="text-white">{run.status}</span></div>
              <div>baseUrl: <span className="text-cyan">{run.baseUrl}</span></div>
              <div>provider: <span className="text-white">{run.llmProvider?.key} / {run.llmProvider?.model}</span></div>
              <div>duration: <span className="text-white">{run.duration ? `${(run.duration/1000).toFixed(1)}s` : '—'}</span></div>
              <div>totalTokensUsed: <span className="text-cyan font-bold">{fmtTokens(totalTokens)}</span></div>
              <div>dryRun: <span className="text-white">{String(run.dryRun)}</span></div>
              {run.tokensByStep && Object.entries(run.tokensByStep).map(([step, tokens]) => (
                <div key={step}>{step}: <span className="text-cyan">{fmtTokens(tokens)} tokens</span></div>
              ))}
              {run.stepDurations && Object.entries(run.stepDurations).map(([step, ms]) => (
                <div key={step + '_ms'}>{step}: <span className="text-white">{(ms/1000).toFixed(1)}s</span></div>
              ))}
              {run.errors?.length > 0 && (
                <div className="mt-2 text-amber">Errors: {run.errors.length}</div>
              )}
            </div>
          </details>

        </div>
      </div>
    </ErrorBoundary>
  )
}
