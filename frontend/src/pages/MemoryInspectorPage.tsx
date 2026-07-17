import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BudgetTheater from '../components/memory/BudgetTheater'
import DecayTimeline from '../components/memory/DecayTimeline'
import FusionExplorer from '../components/memory/FusionExplorer'
import WriterMemoryPanel from '../components/memory/WriterMemoryPanel'
import type { RecallExplanation } from '../lib/types'
import styles from './MemoryInspectorPage.module.css'

export default function MemoryInspectorPage() {
  const { universeId } = useParams<{ universeId: string }>()
  const [recall, setRecall] = useState<RecallExplanation | null>(null)
  const [recallUniverseId, setRecallUniverseId] = useState<string | null>(null)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)
  const [writerMemoryOpen, setWriterMemoryOpen] = useState(false)

  useEffect(() => {
    setRecall(null)
    setRecallUniverseId(null)
    setLifecycleOpen(false)
    setWriterMemoryOpen(false)
  }, [universeId])

  const handleRecallResult = useCallback((nextRecall: RecallExplanation | null) => {
    setRecall(nextRecall)
    setRecallUniverseId(nextRecall && universeId ? universeId : null)
  }, [universeId])

  const currentRecall = recallUniverseId === universeId ? recall : null

  if (!universeId) return null

  return (
    <main className={styles.wrap}>
      <FusionExplorer key={universeId} universeId={universeId} onResult={handleRecallResult} />

      {currentRecall && (
        <details className={styles.disclosure}>
          <summary>Inspect the context budget for this recall</summary>
          <div className={styles.disclosureBody}><BudgetTheater budget={currentRecall.budget} items={currentRecall.items} /></div>
        </details>
      )}

      <details key={`lifecycle-${universeId}`} className={styles.disclosure} onToggle={(event) => setLifecycleOpen(event.currentTarget.open)}>
        <summary>Inspect memory lifecycle and consolidation</summary>
        <div className={styles.disclosureBody}>
          <p className={styles.disclosureIntro}>Lifecycle information is loaded when you ask for it, so the first screen stays focused on the answer to your question.</p>
          {lifecycleOpen && <DecayTimeline key={universeId} universeId={universeId} />}
        </div>
      </details>

      <details key={`writer-memory-${universeId}`} className={styles.disclosure} onToggle={(event) => setWriterMemoryOpen(event.currentTarget.open)}>
        <summary>Inspect what Quill has learned about your writing</summary>
        <div className={styles.disclosureBody}>
          {writerMemoryOpen && <WriterMemoryPanel key={universeId} universeId={universeId} />}
        </div>
      </details>
    </main>
  )
}
