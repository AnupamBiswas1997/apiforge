/**
 * client/src/context/LLMContext.jsx — Global LLM provider state
 *
 * Responsible for:
 *   - Providing active provider info to all components via React Context
 *   - Fetching initial state from GET /api/llm/active on mount
 *   - Exposing setActiveLLM() so ConnectPanel can update global state after /connect
 *
 * Side effects: Reads from GET /api/llm/active on first render.
 */

import React, { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const LLMContext = createContext(null)

/**
 * @description Provider component — wrap the app root with this.
 * @param {{ children: React.ReactNode }} props
 */
export function LLMProvider({ children }) {
  const [llmState, setLLMState] = useState({
    configured: false,
    provider:   null,
    displayName: null,
    model:      null,
    maskedKey:  null,
    loading:    true,
  })

  // Fetch active provider on mount
  useEffect(() => {
    axios.get('/api/llm/active')
      .then(({ data }) => {
        setLLMState({ ...data, loading: false })
      })
      .catch(() => {
        setLLMState((s) => ({ ...s, loading: false }))
      })
  }, [])

  /**
   * @description Update global LLM state after a successful /connect call.
   * @param {{ provider, displayName, model }} info
   */
  function setActiveLLM(info) {
    setLLMState({ ...info, configured: true, loading: false })
  }

  return (
    <LLMContext.Provider value={{ llmState, setActiveLLM }}>
      {children}
    </LLMContext.Provider>
  )
}

/**
 * @description Hook to consume LLM context.
 * @returns {{ llmState: object, setActiveLLM: function }}
 */
export function useLLM() {
  const ctx = useContext(LLMContext)
  if (!ctx) throw new Error('useLLM must be used within LLMProvider')
  return ctx
}
