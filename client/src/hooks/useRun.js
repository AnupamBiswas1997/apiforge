/**
 * client/src/hooks/useRun.js — Hook for fetching a run report
 */

import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

/**
 * @description Fetch a run report by ID. Re-fetches when runId changes.
 * @param {string|null} runId
 * @returns {{ run, loading, error, refetch }}
 */
export function useRun(runId) {
  const [run,     setRun]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const fetchRun = useCallback(async () => {
    if (!runId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get(`/api/runs/${runId}`)
      setRun(data)
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message)
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => { fetchRun() }, [fetchRun])

  return { run, loading, error, refetch: fetchRun }
}
