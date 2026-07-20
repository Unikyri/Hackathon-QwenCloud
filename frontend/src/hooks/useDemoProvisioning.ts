import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { writeImportPath, writePath } from '../lib/canonicalRoutes'
import { api } from '../lib/api'
import { createOpaqueDemoId } from '../pages/guidedDemo'

interface UseDemoProvisioning {
  startDemo: () => Promise<void>
  startDemoFromScratch: () => Promise<void>
  pending: boolean
  pendingScratch: boolean
  error: string
}

/**
 * Register (or reuse the current session) → clone the seeded demo universe →
 * land the visitor on its Write screen. Shared by LoginPage and LandingPage
 * so both demo entry points provision identically.
 *
 * A: also exposes startDemoFromScratch() which creates an EMPTY universe and
 * lands the visitor on Write with the import drawer open, so a judge can see
 * ingestion happen live rather than arriving at a pre-populated universe.
 * The old startDemo() (clone) is kept as the "jump in" path.
 */
export function useDemoProvisioning(): UseDemoProvisioning {
  const demoLogin = useAuthStore((s) => s.demoLogin)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const register = useAuthStore((s) => s.register)
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [pendingScratch, setPendingScratch] = useState(false)
  const [error, setError] = useState('')

  const startDemo = async () => {
    setError('')
    setPending(true)
    try {
      const universeId = await demoLogin()
      navigate(writePath(universeId))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  // A: "Start from scratch" path — creates an empty universe, opens the import
  // drawer, and leaves the judge one click away from watching ingestion live.
  const startDemoFromScratch = async () => {
    setError('')
    setPendingScratch(true)
    try {
      // Ensure the visitor has an auth token — reuse existing account if present.
      // A fresh, never-persisted id per registration (same pattern as
      // demoRegistration() in authStore.ts) — a persisted/deterministic id
      // here would collide on a second attempt (register only succeeds once
      // per email; a stale/cleared token but a still-existing account would
      // 500 with "duplicate key value violates unique constraint").
      if (!isAuthenticated) {
        const identity = createOpaqueDemoId()
        await register(
          `demo-scratch-${identity}@example.invalid`,
          identity,
          'Demo Visitor',
        )
      }

      // Create an empty universe for the fixture manuscript. genre_tags is
      // NOT NULL in the universes table with no default — omitting it 400s
      // ("null value in column genre_tags violates not-null constraint").
      const { universe } = await api.createUniverse({
        name: 'The Shattered Compact',
        description:
          'A demo universe — import the fixture manuscript to see Quill extract entities, detect contradictions, and build the relationship graph in real time.',
        genre_tags: [],
      })

      // Land on Write with the import drawer pre-opened (one click to start ingestion).
      navigate(writeImportPath(universe.id))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPendingScratch(false)
    }
  }

  return { startDemo, startDemoFromScratch, pending, pendingScratch, error }
}

