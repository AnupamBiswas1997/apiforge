/**
 * client/src/components/JsonViewer.jsx — Syntax-highlighted JSON viewer
 * Handles null/undefined data gracefully. Copy button with feedback.
 */

import React, { useState, useMemo } from 'react'

function highlight(str) {
  // Escape HTML first to prevent XSS from JSON content
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Then apply syntax highlighting classes
  return escaped.replace(
    /(\"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*\"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string'
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean'
      } else if (/null/.test(match)) {
        cls = 'json-null'
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

export function JsonViewer({ data, maxHeight = '300px' }) {
  const [copied, setCopied] = useState(false)

  const json = useMemo(() => {
    if (data === null || data === undefined) return 'null'
    if (typeof data === 'string') {
      // Try to parse and re-format if it looks like JSON
      try { return JSON.stringify(JSON.parse(data), null, 2) } catch {}
      return data
    }
    return JSON.stringify(data, null, 2)
  }, [data])

  const highlighted = useMemo(() => highlight(json), [json])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available — silently fail
    }
  }

  return (
    <div className="relative group rounded-md border border-border overflow-hidden">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 px-2 py-1 text-xs font-mono bg-surface border border-border rounded opacity-0 group-hover:opacity-100 transition-opacity hover:border-cyan/50 text-muted hover:text-cyan"
        aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre
        className="text-xs font-mono p-4 overflow-auto bg-bg leading-relaxed"
        style={{ maxHeight, color: 'var(--color-muted)' }}
        // Safe: data comes from our own API, not user input that could inject scripts
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  )
}

export default JsonViewer
