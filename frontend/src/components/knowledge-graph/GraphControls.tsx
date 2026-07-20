import { useGraphStore } from '../../stores/graphStore'
import styles from './GraphCanvas.module.css'

// Entity-type filtering lives in the sidebar's own type chips (see
// KnowledgeGraphPage's filterChips, wired to setSingleTypeFilter) — this used
// to duplicate that as a second checkbox row here, which only ate vertical
// space the canvas and Timeline both need. "Show archived" isn't covered by
// the sidebar chips (archived is a status, not a type), so it stays.
export default function GraphControls() {
  const showArchived = useGraphStore((s) => s.showArchived)
  const toggleArchived = useGraphStore((s) => s.toggleArchived)
  const focalNodeId = useGraphStore((s) => s.focalNodeId)

  return (
    <>
      <div className={styles.filterBar}>
        <label className={styles.filterLabel}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={toggleArchived}
            className={styles.filterCheckbox}
            aria-label="Show archived entities"
          />
          <span className={styles.filterText}>Show archived</span>
        </label>
      </div>

      {focalNodeId && (
        <div className={styles.edgeLegend} aria-label="What the relationship line styles mean">
          <span className={styles.edgeLegendItem}>
            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#155e58" strokeWidth="3" /></svg>
            Direct to focal entity
          </span>
          <span className={styles.edgeLegendItem}>
            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#63706a" strokeWidth="1.8" /></svg>
            Between direct neighbors
          </span>
          <span className={styles.edgeLegendItem}>
            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#8b968f" strokeWidth="1.4" strokeDasharray="3,2" /></svg>
            Second-degree (fainter, dashed)
          </span>
          <span className={styles.edgeLegendItem}>
            <span className={styles.focalRingSample} aria-hidden="true" />
            Focal entity (larger, ringed)
          </span>
          <span className={styles.edgeLegendItem}>Hover any node or line to see its name.</span>
        </div>
      )}
    </>
  )
}
