import { useGraphStore } from '../../stores/graphStore'
import styles from './GraphCanvas.module.css'
import { ENTITY_TYPE_META } from '../../lib/entityTypes'

export default function NodeDrawer() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const nodes = useGraphStore((s) => s.nodes)
  const selectNode = useGraphStore((s) => s.selectNode)

  if (!selectedNodeId) return null

  const node = nodes.find((n) => n.id === selectedNodeId)
  if (!node) return null

  const meta = node.type === 'unknown'
    ? { label: 'Unknown', color: 'currentColor', glyph: '?' }
    : ENTITY_TYPE_META[node.type]
  const relevanceScore = node.data.relevanceScore
  const status = node.data.status

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerHeader}>
        <h3 className={styles.drawerTitle}>{node.data.label}</h3>
        <button className={`glyph ${styles.drawerClose}`} onClick={() => selectNode(null)}>
          ✕
        </button>
      </div>
      <span className={styles.drawerType} style={{ borderLeft: `3px solid ${meta.color}` }}>
        <span className="glyph">{meta.glyph}</span> {meta.label}
      </span>
      {status && (
        <div className={styles.drawerField}>
          <span className={styles.drawerFieldKey}>Status</span>
          <span className={styles.drawerFieldValue}>{status}</span>
        </div>
      )}
      {typeof relevanceScore === 'number' && (
        <div className={styles.drawerField}>
          <span className={styles.drawerFieldKey}>Relevance</span>
          <span className={styles.drawerFieldValue}>{Math.round(relevanceScore * 100)}%</span>
        </div>
      )}
      {Object.entries(node.data)
        .filter(([k]) => !['label', 'description', 'type', 'relevanceScore', 'status'].includes(k))
        .map(([key, value]) => (
          <div key={key} className={styles.drawerField}>
            <span className={styles.drawerFieldKey}>{key}</span>
            <span className={styles.drawerFieldValue}>{String(value)}</span>
          </div>
        ))}
    </div>
  )
}
