/**
 * client/src/pages/Upload.jsx — Requirements upload page (/)
 *
 * Supports file upload for: PDF, DOCX, DOC, XLSX, XLS, JSON (Postman), TXT, MD
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useLLM } from '../context/LLMContext'
import LLMStatusBadge from '../components/LLMStatusBadge'
import ErrorBoundary from '../components/ErrorBoundary'
import Navbar from '../components/Navbar'
import { useToast } from '../components/Toast'
import { ResultBadge } from '../components/Badges'

// File types accepted by the server parser
const ACCEPTED_TYPES = '.pdf,.docx,.doc,.xlsx,.xls,.json,.txt,.md'

const FILE_TYPE_LABELS = {
  pdf:     '📄 PDF',
  docx:    '📝 Word',
  doc:     '📝 Word (legacy)',
  xlsx:    '📊 Excel',
  xls:     '📊 Excel (legacy)',
  postman: '📮 Postman Collection',
  json:    '{ } JSON',
  text:    '📃 Text',
}

export default function Upload() {
  const navigate = useNavigate()
  const { llmState } = useLLM()
  const toast = useToast()

  const [requirements,  setRequirements]  = useState('')
  const [dryRun,        setDryRun]        = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [fileLoading,   setFileLoading]   = useState(false)
  const [uploadedFile,  setUploadedFile]  = useState(null)
  const [recentRuns,    setRecentRuns]    = useState([])
  const [insecureTls,   setInsecureTls]   = useState(false)

  useEffect(() => {
    axios.get('/api/runs').then(({ data }) => {
      setRecentRuns((data || []).slice(0, 5))
    }).catch(() => {})
    axios.get('/api/health').then(({ data }) => {
      setInsecureTls(!!data.allowInsecureTls)
    }).catch(() => {})
  }, [])

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setFileLoading(true)
    setUploadedFile(null)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const { data } = await axios.post('/api/parse-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setRequirements(data.text)
      setUploadedFile({ name: file.name, type: data.fileType })
      const label = FILE_TYPE_LABELS[data.fileType] || data.fileType
      const detail = data.pages ? ` (${data.pages} pages)` : ''
      toast(`${label} loaded${detail} — ${data.text.length.toLocaleString()} chars`, 'success')
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to parse file'
      toast(msg, 'error')
    } finally {
      setFileLoading(false)
    }
  }

  async function handleSubmit() {
    if (!canSubmit || loading) return
    setLoading(true)
    try {
      const { data } = await axios.post('/api/runs/start', {
        requirementsText: requirements.trim(),
        dryRun,
      })
      navigate(`/run/${data.runId}`)
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to start run'
      toast(msg, 'error')
      setLoading(false)
    }
  }

  const canSubmit = requirements.trim().length >= 20 && llmState.configured

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-bg">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-8">

          <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1.5 tracking-tight">
                New Test Run
              </h1>
              <p className="text-muted text-sm max-w-lg leading-relaxed">
                Paste or upload your API requirements — endpoint, payload, and headers are extracted automatically by AI.
              </p>
            </div>
            <LLMStatusBadge />
          </div>

          {/* TLS warning */}
          {insecureTls && (
            <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-amber/10 border border-amber/30 rounded-lg text-xs text-amber">
              <span className="text-lg shrink-0" aria-hidden="true">⚠</span>
              <div>
                <span className="font-semibold">TLS verification bypass active</span>
                {' — '}
                <code className="font-mono">ALLOW_INSECURE_TLS=true</code> is set.
                All API requests skip certificate verification (self-signed / corporate CA certs).
                Certificate errors are also auto-detected and retried even without this flag.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">

              {/* Requirements textarea */}
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="text-sm font-medium text-white" htmlFor="requirements">
                    API Requirements Document
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted font-mono">{requirements.length} chars</span>
                    <label
                      className={`text-xs font-mono transition-colors cursor-pointer ${
                        fileLoading ? 'text-muted cursor-wait' : 'text-muted hover:text-cyan'
                      }`}
                      aria-label="Upload a requirements file"
                    >
                      {fileLoading ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 border border-cyan/40 border-t-cyan rounded-full animate-spin" />
                          Parsing…
                        </span>
                      ) : (
                        '↑ Upload file'
                      )}
                      <input
                        type="file"
                        accept={ACCEPTED_TYPES}
                        onChange={handleFileUpload}
                        disabled={fileLoading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Uploaded file chip */}
                {uploadedFile && (
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 bg-cyan/10 border border-cyan/20 text-cyan rounded-full">
                      {FILE_TYPE_LABELS[uploadedFile.type] || uploadedFile.type}
                    </span>
                    <span className="text-muted truncate">{uploadedFile.name}</span>
                    <button
                      onClick={() => { setRequirements(''); setUploadedFile(null) }}
                      className="text-muted hover:text-red ml-auto"
                      aria-label="Clear uploaded file"
                    >✕</button>
                  </div>
                )}

                {/* Supported formats */}
                <div className="flex flex-wrap gap-1.5 text-xs text-muted/60 font-mono">
                  <span>Supported:</span>
                  {['PDF', 'DOCX', 'XLSX', 'Postman JSON', 'TXT', 'MD'].map(t => (
                    <span key={t} className="px-1.5 py-0.5 bg-surface border border-border rounded text-muted/80">{t}</span>
                  ))}
                </div>

                <textarea
                  id="requirements"
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder={
                    'Paste your full API requirements document here, or upload a file above.\n\n' +
                    'Supported file types: PDF, Word (.docx), Excel (.xlsx), Postman Collection (.json), Text\n\n' +
                    'The pipeline will automatically extract:\n' +
                    '  • Base URL and endpoint path\n' +
                    '  • Request method and payload template\n' +
                    '  • Required headers (User-Agent, etc.)\n' +
                    '  • Expected success and error responses'
                  }
                  className="w-full h-64 bg-surface border border-border rounded-lg px-4 py-3 text-sm font-mono text-white placeholder:text-muted/50 focus:outline-none focus:border-cyan/50 resize-none transition-colors"
                  aria-required="true"
                />
                {requirements.length > 0 && requirements.length < 20 && (
                  <p className="text-xs text-amber">Requirements must be at least 20 characters.</p>
                )}
              </div>

              {/* Dry run */}
              <div className="border border-border/60 rounded-xl p-4" style={{ background: 'rgb(var(--tw-surface) / 0.6)' }}>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="w-4 h-4 rounded border-border bg-bg accent-cyan"
                    aria-label="Dry run mode"
                  />
                  <div>
                    <span className="text-sm text-white group-hover:text-cyan transition-colors select-none font-medium">Dry run</span>
                    <p className="text-xs text-muted mt-0.5">Generate and analyse test cases without sending real HTTP requests.</p>
                  </div>
                </label>
              </div>

              {/* Submit */}
              {!llmState.configured ? (
                <button
                  onClick={() => navigate('/connect')}
                  className="w-full py-3 bg-amber/10 border border-amber/40 text-amber rounded-lg text-sm font-mono hover:bg-amber/20 transition-colors"
                >
                  ⚠ Connect an LLM provider first →
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || loading}
                  className="w-full py-3 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, rgb(var(--tw-cyan)), rgb(var(--tw-purple) / 0.8))', color: 'rgb(var(--tw-bg))', boxShadow: '0 0 20px rgb(var(--tw-cyan) / 0.2)' }}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
                      Starting…
                    </>
                  ) : 'Run Tests →'}
                </button>
              )}

              {/* Info */}
              <div className="border border-cyan/15 rounded-xl p-4 text-xs text-muted space-y-1.5" style={{ background: 'rgb(var(--tw-cyan) / 0.04)' }}>
                <p className="text-cyan font-medium text-sm">What gets extracted automatically</p>
                <p>• <strong className="text-white">Base URL & endpoint</strong> — taken directly from the document</p>
                <p>• <strong className="text-white">Request payload</strong> — the example JSON body becomes the ground-truth template</p>
                <p>• <strong className="text-white">Headers</strong> — User-Agent and other headers are applied to every request</p>
                <p>• <strong className="text-white">Error codes</strong> — expected error responses are used to validate test results</p>
                <p>• <strong className="text-white">Postman collections</strong> — requests, endpoints, headers and body payloads are extracted automatically</p>
              </div>
            </div>

            {/* Recent runs sidebar */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Recent Runs</h2>
                {recentRuns.length > 0 && (
                  <button onClick={() => navigate('/history')} className="text-xs text-cyan hover:underline">View all →</button>
                )}
              </div>
              {recentRuns.length === 0 ? (
                <div className="border border-border/50 rounded-xl p-6 text-muted text-sm text-center" style={{ background: 'rgb(var(--tw-surface) / 0.5)' }}>
                  <div className="text-2xl mb-2">📋</div>No runs yet
                </div>
              ) : recentRuns.map((run) => {
                const runId = run.runId || run.id
                return (
                  <button
                    key={runId}
                    onClick={() => navigate(`/report/${runId}`)}
                    className="w-full border border-border/50 rounded-xl p-4 text-left hover:border-cyan/30 transition-all group" style={{ background: 'rgb(var(--tw-surface) / 0.5)' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-muted truncate group-hover:text-white transition-colors">{runId}</span>
                      <ResultBadge result={
                        run.status === 'running' ? 'running' :
                        run.status === 'failed'  ? 'fail'    :
                        run.passRate >= 80       ? 'pass'    :
                        run.passRate >= 50       ? 'warning' : 'fail'
                      } />
                    </div>
                    <div className="text-xs text-muted truncate mb-1">{run.baseUrl || '—'}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted">{run.totalTests ?? 0} tests</span>
                      <span className="text-muted">·</span>
                      <span className={run.passRate >= 80 ? 'text-green' : run.passRate >= 50 ? 'text-amber' : 'text-red'}>
                        {run.passRate ?? 0}% passed
                      </span>
                    </div>
                    {run.llmProvider && (
                      <div className="text-xs text-muted/60 font-mono mt-1 truncate">
                        {run.llmProvider.key} · {run.llmProvider.model?.split('-').slice(0, 2).join('-')}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
