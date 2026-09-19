/**
 * client/src/components/ConnectPanel.jsx — LLM provider connection UI
 *
 * Shows provider cards, credential fields, connection test, and result.
 * Used on the /connect page.
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useLLM } from '../context/LLMContext'
import { ProviderIcon } from './ProviderIcon'
import { useToast } from './Toast'

const PROVIDER_ACCENT = {
  anthropic:  '#CC785C',
  openai:     '#10a37f',
  gemini:     '#4285F4',
  mistral:    '#FF7000',
  ollama:     '#7C3AED',
  marsmax:    '#E8432D',
  openrouter: '#6366F1',
}

const ERROR_HINTS = {
  INVALID_KEY:          'Your API key / bearer token is incorrect or has been revoked. Check your provider dashboard.',
  RATE_LIMITED:         'Rate limit exceeded. This is usually transient — wait a moment and try again.',
  INSUFFICIENT_CREDITS: 'Your account has run out of credits or quota. Top up or upgrade your plan with this provider — retrying will not help until you do.',
  MODEL_NOT_FOUND:      'The model name is not recognised by this provider. Check with your platform team.',
  NETWORK_ERROR:        'Cannot reach the provider. For Mars Max: ensure your APIForge server is running on an IP that is on the Mars APIM allowlist. For Ollama: check that ollama serve is running.',
  CONNECTION_FAILED:    'Connection timed out. The provider may be temporarily unavailable.',
  UNEXPECTED_RESPONSE:  'Provider responded but returned unexpected content. Try a different model.',
}

export function ConnectPanel({ onConnected }) {
  const { setActiveLLM } = useLLM()
  const navigate         = useNavigate()
  const toast            = useToast()

  const [providers,        setProviders]        = useState([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [fieldValues,      setFieldValues]      = useState({})
  const [showKey,          setShowKey]          = useState(false)
  const [testing,          setTesting]          = useState(false)
  const [testResult,       setTestResult]       = useState(null)
  const [connected,        setConnected]        = useState(false)

  // fetchProviders is stable — extracted so dependency array is correct
  useEffect(() => {
    setLoadingProviders(true)
    axios.get('/api/llm/providers')
      .then(({ data }) => {
        setProviders(data.providers || [])
        if (data.activeProvider) {
          const active = (data.providers || []).find((p) => p.key === data.activeProvider)
          if (active) {
            setSelectedProvider(active)
            setFieldValues({ model: data.activeModel })
          }
        }
      })
      .catch(() => toast('Failed to load provider list', 'error'))
      .finally(() => setLoadingProviders(false))
  }, [toast])

  function selectProvider(p) {
    setSelectedProvider(p)
    setTestResult(null)
    setConnected(false)
    setShowKey(false)
    const defaults = {}
    p.fields.forEach((f) => {
      if (f.name === 'model') defaults.model = f.placeholder
      // Only pre-fill baseUrl when it is required (ollama); leave optional fields empty
      if (f.name === 'baseUrl' && p.requiresBaseUrl) defaults.baseUrl = f.placeholder
    })
    setFieldValues(defaults)
  }

  function isFormValid() {
    if (!selectedProvider) return false
    return selectedProvider.fields.every((f) => {
      if (f.name === 'apiKey')  return !!fieldValues.apiKey?.trim()
      if (f.name === 'baseUrl') return !selectedProvider.requiresBaseUrl || !!fieldValues.baseUrl?.trim()
      return true
    })
  }

  async function handleTest() {
    if (!isFormValid() || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const { data } = await axios.post('/api/llm/connect', {
        provider: selectedProvider.key,
        apiKey:   fieldValues.apiKey  || undefined,
        model:    fieldValues.model   || undefined,
        baseUrl:  fieldValues.baseUrl || undefined,
      })
      setTestResult(data)
      if (data.success) {
        setConnected(true)
        setActiveLLM({
          provider:    selectedProvider.key,
          displayName: selectedProvider.displayName,
          model:       data.model,
          configured:  true,
        })
        try {
          localStorage.setItem('apiforge_provider', JSON.stringify({
            provider:    selectedProvider.key,
            displayName: selectedProvider.displayName,
            model:       data.model,
          }))
        } catch {}
        onConnected?.()
      }
    } catch (err) {
      const errData = err.response?.data
      setTestResult({
        success: false,
        error: errData?.error || { code: 'NETWORK_ERROR', message: err.message },
      })
    } finally {
      setTesting(false)
    }
  }

  // ── Provider card skeleton while loading ──
  if (loadingProviders) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="w-28 h-24 rounded-lg border border-border bg-surface animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Provider cards */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Select LLM provider">
        {providers.map((p) => {
          const isSelected = selectedProvider?.key === p.key
          const accent     = PROVIDER_ACCENT[p.key] || 'var(--color-cyan)'
          return (
            <button
              key={p.key}
              onClick={() => selectProvider(p)}
              className={`relative p-3 rounded-lg border text-left transition-all w-28 shrink-0 ${
                isSelected ? 'border-cyan/60' : 'border-border bg-surface hover:border-cyan/30'
              }`}
              style={isSelected ? { borderColor: `${accent}90`, background: `${accent}12` } : {}}
              role="radio"
              aria-checked={isSelected}
              aria-label={`${p.displayName}${p.key === 'ollama' ? ' — no key needed' : ''}`}
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <ProviderIcon
                  provider={p.key}
                  size={26}
                  style={{ color: isSelected ? accent : 'var(--color-muted)' }}
                />
                <span className={`text-xs font-medium leading-tight ${isSelected ? 'text-white' : 'text-muted'}`}>
                  {p.displayName}
                </span>
                {p.key === 'ollama' && (
                  <span className="text-xs bg-surface border border-border text-muted px-1.5 py-0.5 rounded-full">
                    Local
                  </span>
                )}
                {p.configured && p.key !== 'ollama' && (
                  <span className="text-green text-xs">● Active</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Config fields */}
      {selectedProvider && (
        <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">
            Configure {selectedProvider.displayName}
          </h3>

          {selectedProvider.fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <label htmlFor={`field-${field.name}`} className="block text-xs font-mono text-muted">
                {field.label}
                {field.name === 'baseUrl' && !selectedProvider.requiresBaseUrl && (
                  <span className="ml-1 text-muted/60">(optional)</span>
                )}
              </label>
              <div className="relative">
                <input
                  id={`field-${field.name}`}
                  type={field.secret && !showKey ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => setFieldValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono text-white placeholder:text-muted/40 focus:outline-none focus:border-cyan/60 transition-colors"
                  aria-label={field.label}
                  autoComplete={field.secret ? 'current-password' : 'off'}
                />
                {field.secret && (
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white text-xs px-1"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                )}
              </div>

              {field.name === 'model' && (
                <p className="text-xs text-muted">
                  {selectedProvider.key === 'openrouter'
                    ? <>Namespaced format: <code className="text-cyan font-mono">anthropic/claude-sonnet-4-5</code> or <code className="text-cyan font-mono">openai/gpt-4o</code>. Browse at <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="text-cyan underline">openrouter.ai/models</a>.</>
                    : selectedProvider.key === 'marsmax'
                    ? <><code className="text-cyan font-mono">auto</code> lets the gateway pick the best available model. Leave as default unless told otherwise by your Mars platform team.</>
                    : 'Leave as default if unsure. Change to test a specific version.'
                  }
                </p>
              )}
              {field.name === 'baseUrl' && selectedProvider.key === 'ollama' && (
                <p className="text-xs text-muted font-mono">
                  Ollama must be running. Start with: <code className="text-cyan">ollama serve &amp;&amp; ollama pull {fieldValues.model || 'llama3'}</code>
                </p>
              )}
            </div>
          ))}

          {selectedProvider.key === 'marsmax' && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted/70 flex items-start gap-1.5">
                <span aria-hidden="true">ℹ</span>
                Token format: <code className="text-cyan font-mono">pk-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>. Get yours from your Mars DNA / AI platform team.
              </p>
              <p className="text-xs text-amber/80 flex items-start gap-1.5">
                <span aria-hidden="true">⏱</span>
                Mars Max gateway can take 30–120s per pipeline step. Total test runs may take 5–10 minutes. This is normal — each step retries automatically on timeout.
              </p>
            </div>
          )}
          <p className="text-xs text-muted/70 flex items-start gap-1.5">
            <span aria-hidden="true">🔒</span>
            Credentials are held in server memory only and never written to disk.
          </p>

          <button
            onClick={handleTest}
            disabled={!isFormValid() || testing}
            className="w-full bg-cyan/10 border border-cyan/40 text-cyan rounded-md py-2.5 text-sm font-mono font-medium hover:bg-cyan/20 hover:border-cyan/70 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            aria-label="Test connection to selected LLM provider"
          >
            {testing ? (
              <>
                <span className="w-4 h-4 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin" aria-hidden="true" />
                Testing connection…
              </>
            ) : 'Test Connection'}
          </button>

          {testResult && (
            <div
              className={`rounded-md border p-4 text-sm space-y-2 ${
                testResult.success
                  ? 'border-green/40 bg-green/5'
                  : testResult.error?.code === 'UNEXPECTED_RESPONSE'
                  ? 'border-amber/40 bg-amber/5'
                  : 'border-red/40 bg-red/5'
              }`}
              role="status"
              aria-live="polite"
            >
              {testResult.success ? (
                <>
                  <div className="flex items-center gap-2 text-green font-medium">
                    <span aria-hidden="true">✓</span>
                    Connected to {selectedProvider.displayName} ({testResult.model}) — {testResult.latencyMs}ms
                  </div>
                  {testResult.testResponse && (
                    <div className="text-xs font-mono text-muted bg-bg rounded p-2">
                      Response: {testResult.testResponse.slice(0, 120)}
                    </div>
                  )}
                </>
              ) : testResult.error?.code === 'UNEXPECTED_RESPONSE' ? (
                <>
                  <div className="flex items-center gap-2 text-amber font-medium">
                    <span aria-hidden="true">⚠</span>
                    Unexpected response from provider
                  </div>
                  <div className="text-xs font-mono text-muted bg-bg rounded p-2 break-all">
                    {testResult.testResponse || testResult.error?.message}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-red font-medium">
                    <span aria-hidden="true">✕</span>
                    Connection failed
                  </div>
                  <div className="text-xs text-muted space-y-1.5">
                    <div>
                      <code className="text-red font-mono">{testResult.error?.code}</code>
                      {' — '}
                      {ERROR_HINTS[testResult.error?.code] || testResult.error?.message}
                    </div>
                    {testResult.error?.detail && (
                      <div className="font-mono text-xs bg-bg border border-red/20 rounded p-2 break-all text-muted">
                        <span className="text-red/70">Gateway said: </span>{testResult.error.detail}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Success — show continue button */}
      {connected && (
        <div className="flex items-center justify-between p-4 bg-green/10 border border-green/30 rounded-lg gap-4">
          <p className="text-green text-sm font-medium">
            ✓ Connected to {selectedProvider?.displayName}. Ready to run tests.
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-green/20 border border-green/40 text-green text-sm font-mono rounded-md hover:bg-green/30 transition-colors shrink-0"
            aria-label="Continue to testing page"
          >
            Start Testing →
          </button>
        </div>
      )}
    </div>
  )
}

export default ConnectPanel
