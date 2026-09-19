/**
 * client/src/hooks/useSSE.js — Server-Sent Events hook with stable handler refs
 *
 * Fixes stale closure bug: handlers are stored in refs so the EventSource
 * always calls the latest version without needing to reconnect.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * @description Opens an SSE connection to `url` and dispatches incoming events
 * to the provided handlers. Handlers can change between renders without
 * causing a reconnect, because they are stored in refs.
 *
 * @param {string|null} url - The SSE endpoint. Pass null to not connect.
 * @param {{ onStep, onLog, onComplete, onError }} handlers
 */
export function useSSE(url, { onStep, onLog, onComplete, onError } = {}) {
  const [connected,   setConnected]   = useState(false)
  const [streamError, setStreamError] = useState(null)

  // Store latest handlers in refs so EventSource listeners don't go stale
  const onStepRef     = useRef(onStep)
  const onLogRef      = useRef(onLog)
  const onCompleteRef = useRef(onComplete)
  const onErrorRef    = useRef(onError)

  useEffect(() => { onStepRef.current     = onStep     }, [onStep])
  useEffect(() => { onLogRef.current      = onLog      }, [onLog])
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onErrorRef.current    = onError    }, [onError])

  const esRef      = useRef(null)
  const retryCount = useRef(0)
  const retryTimer = useRef(null)

  const connect = useCallback(() => {
    if (!url) return
    if (esRef.current) esRef.current.close()

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      setStreamError(null)
      retryCount.current = 0
    }

    const bind = (eventName, refObj) => {
      es.addEventListener(eventName, (e) => {
        try {
          const data = JSON.parse(e.data)
          refObj.current?.(data)
        } catch {
          console.warn('SSE: malformed event', eventName, e.data)
        }
      })
    }

    bind('step',     onStepRef)
    bind('log',      onLogRef)
    bind('complete', onCompleteRef)
    // Named pipeline events sent as: event: error\ndata: {...}
    // These are DIFFERENT from the browser's built-in onerror (transport failure).
    // We use a custom event name 'pipeline-error' to avoid the ambiguity.
    // The server emits: event: error (which the browser also uses for transport)
    // so we listen on 'error' but only process events that have data.
    es.addEventListener('error', (e) => {
      // Only handle events with data — these are named pipeline error events.
      // Events WITHOUT e.data are transport errors handled by es.onerror below.
      if (e.data) {
        try {
          const data = JSON.parse(e.data)
          setStreamError(data.message)
          onErrorRef.current?.(data)
        } catch {
          console.warn('SSE: malformed error event', e.data)
        }
      }
    })

    // Transport-level error (connection dropped, network failure)
    // Only fires when e.data is absent — actual named 'error' events have data.
    es.onerror = (e) => {
      if (e.data) return // already handled above as a named event
      setConnected(false)
      es.close()
      if (retryCount.current < 3) {
        const delay = Math.pow(2, retryCount.current) * 1000
        retryCount.current++
        retryTimer.current = setTimeout(connect, delay)
      } else {
        setStreamError('Stream disconnected. Please refresh to reconnect.')
      }
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryTimer.current)
      esRef.current?.close()
    }
  }, [connect])

  return { connected, streamError }
}
