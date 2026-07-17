import { useEffect, useMemo, useRef } from 'react'
import cytoscape, {
  type Core,
  type ElementDefinition,
  type LayoutOptions,
  type StylesheetJson,
} from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useGraphStore } from '../../stores/graphStore'
import { toCytoscapeElements } from '../../lib/graphElements'
import styles from './GraphCanvas.module.css'

cytoscape.use(fcose)

const style: StylesheetJson = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: '14px',
      'background-color': '#fffefa',
      'border-width': 2,
      'border-color': '#52605b',
      color: '#192321',
      'font-family': 'Spline Sans, system-ui, sans-serif',
      'font-size': 12,
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-max-width': '150px',
      'text-valign': 'center',
      'text-halign': 'center',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'node[entityType = "character"]',
    style: { 'border-color': '#155e58' },
  },
  {
    selector: 'node[entityType = "place"]',
    style: { 'border-color': '#4d8069' },
  },
  {
    selector: 'node[entityType = "object"]',
    style: { 'border-color': '#8a5d00' },
  },
  {
    selector: 'node[entityType = "faction"]',
    style: { 'border-color': '#52605b' },
  },
  {
    selector: 'node[entityType = "event"]',
    style: { 'border-color': '#8a5d00' },
  },
  {
    selector: 'node[entityType = "world_rule"]',
    style: { 'border-color': '#337c73' },
  },
  {
    selector: 'node[entityType = "plot_arc"]',
    style: { 'border-color': '#a23d33' },
  },
  {
    selector: 'node[focal]',
    style: {
      'border-width': 3,
      'background-color': '#f1f3ee',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-color': '#0c6a85',
      'background-color': '#e7f0ee',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#9ca7a2',
      'target-arrow-color': '#9ca7a2',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: '',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      width: 3,
      'line-color': '#155e58',
      'target-arrow-color': '#155e58',
    },
  },
]

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export default function GraphCanvas() {
  const nodes = useGraphStore((state) => state.nodes)
  const edges = useGraphStore((state) => state.edges)
  const nodeFilter = useGraphStore((state) => state.nodeFilter)
  const showArchived = useGraphStore((state) => state.showArchived)
  const limits = useGraphStore((state) => state.limits)
  const focalNodeId = useGraphStore((state) => state.focalNodeId)
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId)
  const selectedEdgeId = useGraphStore((state) => state.selectedEdgeId)
  const selectNode = useGraphStore((state) => state.selectNode)
  const selectEdge = useGraphStore((state) => state.selectEdge)
  const focusNode = useGraphStore((state) => state.focusNode)
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const callbacksRef = useRef({ selectNode, selectEdge, focusNode })

  callbacksRef.current = { selectNode, selectEdge, focusNode }

  const visibleNeighborhood = useMemo(() => {
    // A map response without limits is treated as unsafe rather than passed
    // into fCoSE. graphStore turns that contract failure into a retry state.
    if (!limits) return null

    const visibleNodes = nodes.filter((node) => (
      nodeFilter[node.type] !== false && (showArchived || node.data.status !== 'archived')
    )).slice(0, limits.node_limit)
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
    const visibleEdges = edges.filter((edge) => (
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )).slice(0, limits.edge_limit)

    return { nodes: visibleNodes, edges: visibleEdges, truncated: false, limits }
  }, [edges, limits, nodeFilter, nodes, showArchived])

  const elements = useMemo(
    () => visibleNeighborhood ? toCytoscapeElements(visibleNeighborhood, focalNodeId) : [],
    [focalNodeId, visibleNeighborhood],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const cy = cytoscape({
      container,
      style,
      elements: [],
      boxSelectionEnabled: false,
    })
    cyRef.current = cy

    cy.on('tap', 'node', (event) => {
      const id = event.target.id()
      callbacksRef.current.selectNode(id)
      void callbacksRef.current.focusNode(id)
    })
    cy.on('tap', 'edge', (event) => {
      callbacksRef.current.selectEdge(event.target.id())
    })
    cy.on('tap', (event) => {
      if (event.target === cy) {
        callbacksRef.current.selectNode(null)
        callbacksRef.current.selectEdge(null)
      }
    })

    const resizeObserver = new ResizeObserver(() => cy.resize())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().remove()
    if (elements.length === 0) return

    cy.add(elements as unknown as ElementDefinition[])
    cy.layout({
      name: 'fcose',
      quality: 'default',
      randomize: false,
      animate: !prefersReducedMotion(),
      animationDuration: 220,
      nodeSeparation: 90,
      idealEdgeLength: 150,
      nodeRepulsion: 8_000,
      gravity: 0.25,
      padding: 48,
    } as LayoutOptions).run()
    cy.fit(cy.elements(), 48)
  }, [elements])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().unselect()
    const selectedId = selectedNodeId || selectedEdgeId
    if (selectedId) cy.$id(selectedId).select()
  }, [selectedEdgeId, selectedNodeId])

  return (
    <div className={styles.canvasWrap}>
      <div
        ref={containerRef}
        className={styles.canvas}
        tabIndex={0}
        role="application"
        aria-label="Story relationship map. Use the entity and relationship lists for keyboard navigation."
      />
    </div>
  )
}
