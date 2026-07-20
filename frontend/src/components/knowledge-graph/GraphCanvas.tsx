import { useEffect, useMemo, useRef } from 'react'
import cytoscape, {
  type Core,
  type ElementDefinition,
  type LayoutOptions,
  type NodeSingular,
  type StylesheetJson,
} from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useGraphStore } from '../../stores/graphStore'
import { GRAPH_RENDER_EDGE_LIMIT, GRAPH_RENDER_NODE_LIMIT, toCytoscapeElements } from '../../lib/graphElements'
import { ENTITY_TYPE_META } from '../../lib/entityTypes'
import styles from './GraphCanvas.module.css'

cytoscape.use(fcose)

// Redesign (round 2 — the opacity/border-width nudges in the previous pass
// were confirmed, by inspecting Cytoscape's actual node data, to be a
// legibility problem, not a data/logic bug: focal:true and hop:0 were
// already on the right node, the rectangle-with-thin-border-on-near-white
// look just made every non-focal node unreadable regardless. Filled-circle
// nodes with real color contrast, no permanent label (name shows on hover —
// the entity list already gives every name), and a large, unmistakable
// focal ring fix the actual problem instead of tuning the old approach
// further.
// Cytoscape's JS-object stylesheet does not resolve CSS custom properties
// (confirmed by rendering: every node fell back to the same flat gray) —
// these must be the literal hex values behind the app's --node-*/--accent-live
// tokens in index.css, not var(...) references.
const NODE_FILL: Record<string, string> = {
  character: '#155e58',
  place: '#4d8069',
  object: '#8a5d00',
  faction: '#52605b',
  event: '#8a5d00',
  world_rule: '#337c73',
  plot_arc: '#a23d33',
}

// The app's node-type palette (--node-character/--node-place/--node-faction/…)
// was designed for thin borders on a near-white card, not solid fills read on
// their own — several types (character/place/faction) are all dark, low-
// saturation greens and are hard to tell apart by hue alone once color is the
// *only* type signal (no permanent label). Reusing each type's existing glyph
// (ENTITY_TYPE_META, already used by the filter legend) as the node's label
// gives type a shape signal independent of hue, instead of re-tuning the palette.
const NODE_GLYPH: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_TYPE_META).map(([type, meta]) => [type, meta.glyph]),
)

function nodeGlyph(node: NodeSingular): string {
  return NODE_GLYPH[node.data('entityType') as string] || '?'
}

const style: StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'ellipse',
      width: 36,
      height: 36,
      'background-color': '#7c8b85',
      // A light halo separates each solid-color node from the canvas and
      // from overlapping neighbors — without it, same-family colors
      // (e.g. the two green-ish types) blur together at a glance.
      'border-width': 2,
      'border-color': '#edf0ea',
      // Type glyph inside the node — a shape cue that survives even when
      // two types render similar colors (see NODE_GLYPH above).
      label: nodeGlyph as unknown as string,
      color: '#fffefa',
      'font-size': 13,
      'text-valign': 'center',
      'text-halign': 'center',
      'overlay-opacity': 0,
    },
  },
  ...Object.entries(NODE_FILL).map(([entityType, color]) => ({
    selector: `node[entityType = "${entityType}"]`,
    style: { 'background-color': color },
  })),
  // Second-degree nodes read as peripheral context — smaller reads as
  // "further away" on its own; unlike the old thin-border design, the
  // color fill is still fully opaque so a small node is still identifiable
  // by type at a glance, not just fainter.
  {
    selector: 'node[hop = 2]',
    style: {
      width: 24,
      height: 24,
    },
  },
  // Name appears on hover/selection only — every entity is already listed
  // by name in the left rail; the map's job is the shape of relationships,
  // not repeating 20 labels on top of each other.
  {
    selector: 'node.hovered, node:selected',
    style: {
      label: 'data(label)',
      'font-family': 'Spline Sans, system-ui, sans-serif',
      'font-size': 12,
      'font-weight': 600,
      color: '#192321',
      'text-valign': 'bottom',
      'text-margin-y': 6,
      'text-background-color': '#fffefa',
      'text-background-opacity': 1,
      'text-background-padding': '3px',
      'text-border-width': 1,
      'text-border-color': 'rgba(25, 35, 33, 0.2)',
      'text-border-opacity': 1,
      'z-index': 30,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#0c6a85',
    },
  },
  // The focal entity: the one node that must be unmistakable without
  // hovering or reading a legend. Large, and ringed in the accent reserved
  // app-wide for "this is the thing the system is actively centered on"
  // (same token the Editor's live-pipeline/context-budget numbers use).
  // Declared AFTER node:selected so the focal ring wins over the generic
  // selected-border color on the common case where the focal node is also
  // the selected one (fetchGraph/focusNode always select the new focal).
  // `[?focal]` (existential-truthy), NOT `[focal]` — toCytoscapeElements
  // always sets `focal` to a real boolean (true or false, never undefined),
  // so every node HAS the field; `[focal]` only checks the field exists and
  // matched every node regardless of its value, ringing the entire graph in
  // the "focal" style instead of just the one focal node. Confirmed via
  // Cytoscape's actual computed style before/after this change.
  {
    selector: 'node[?focal]',
    style: {
      width: 52,
      height: 52,
      'border-width': 5,
      'border-color': '#605198',
      'z-index': 20,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.8,
      'line-color': '#8b968f',
      'target-arrow-color': '#8b968f',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      label: '',
      'overlay-opacity': 0,
    },
  },
  // Edge visual language for the ego graph: a relationship's weight in the
  // line mirrors how peripheral it is, so the map reads center-out instead
  // of as an undifferentiated tangle. edgeTier: 0 touches the focal entity,
  // 1 connects two direct neighbors, 2 reaches a second-degree node (see
  // toCytoscapeElements) — matches the legend in GraphControls.tsx.
  {
    selector: 'edge[edgeTier = 0]',
    style: {
      width: 3,
      'line-color': '#155e58',
      'target-arrow-color': '#155e58',
    },
  },
  {
    selector: 'edge[edgeTier = 1]',
    style: {
      width: 1.8,
      'line-color': '#63706a',
      'target-arrow-color': '#63706a',
    },
  },
  {
    selector: 'edge[edgeTier = 2]',
    style: {
      width: 1.4,
      'line-color': '#8b968f',
      'target-arrow-color': '#8b968f',
      'line-style': 'dashed',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      width: 3,
      'line-color': '#155e58',
      'target-arrow-color': '#155e58',
      'line-style': 'solid',
    },
  },
  // Relationship type appears on hover/selection only, same reasoning as
  // node labels — the map defaults to shape, detail comes on demand.
  {
    selector: 'edge.hovered, edge:selected',
    style: {
      label: 'data(relationshipType)',
      'font-family': 'Spline Sans, system-ui, sans-serif',
      'font-size': 10,
      'font-weight': 600,
      color: '#192321',
      'text-background-color': '#fffefa',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
      'text-rotation': 'autorotate',
    },
  },
  // Applied/removed imperatively by the eventHighlightIds effect below, not
  // part of element data — dimming must not trigger a re-layout (see that
  // effect for why it's driven by classes instead of a data field).
  {
    selector: 'node.dimmed',
    style: { opacity: 0.2 },
  },
  {
    selector: 'edge.dimmed',
    style: { opacity: 0.08 },
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
  const eventHighlightIds = useGraphStore((state) => state.eventHighlightIds)
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const callbacksRef = useRef({ selectNode, selectEdge, focusNode })

  callbacksRef.current = { selectNode, selectEdge, focusNode }

  const visibleNeighborhood = useMemo(() => {
    // limits is only present for a bounded focal-entity traversal; a
    // full-graph fetch has no hop count to report, so fall back to the same
    // render caps the store adapters already applied to nodes/edges.
    const nodeCap = limits?.node_limit ?? GRAPH_RENDER_NODE_LIMIT
    const edgeCap = limits?.edge_limit ?? GRAPH_RENDER_EDGE_LIMIT

    const visibleNodes = nodes.filter((node) => (
      nodeFilter[node.type] !== false && (showArchived || node.data.status !== 'archived')
    )).slice(0, nodeCap)
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
    const visibleEdges = edges.filter((edge) => (
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    )).slice(0, edgeCap)

    return { nodes: visibleNodes, edges: visibleEdges, truncated: false, limits }
  }, [edges, limits, nodeFilter, nodes, showArchived])

  const elements = useMemo(
    () => toCytoscapeElements(visibleNeighborhood, focalNodeId),
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
      minZoom: 0.2,
      maxZoom: 2,
      // D1: default wheelSensitivity is 1 (very slow); 3 makes zooming feel
      // responsive without being jumpy. Tune between 2–4 by feel if needed.
      wheelSensitivity: 3,
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

    // Nodes/edges carry no permanent label (see stylesheet above) — hover
    // reveals the name/relationship type via the `.hovered` class instead,
    // so the map stays a shape at rest and a name/relationship on demand.
    cy.on('mouseover', 'node', (event) => event.target.addClass('hovered'))
    cy.on('mouseout', 'node', (event) => event.target.removeClass('hovered'))
    cy.on('mouseover', 'edge', (event) => event.target.addClass('hovered'))
    cy.on('mouseout', 'edge', (event) => event.target.removeClass('hovered'))

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

    // Ego mode (a focal entity was picked) carries a hop distance on every
    // node — lay those out in rings around the center instead of letting
    // fCoSE's force simulation scatter them. The full, unfocused graph has
    // no hop data and keeps the force-directed layout.
    const isEgoGraph = elements.some((el) => el.group === 'nodes' && typeof el.data.hop === 'number')
    const layout: LayoutOptions = isEgoGraph
      ? {
          name: 'concentric',
          animate: !prefersReducedMotion(),
          animationDuration: 220,
          concentric: (node) => 3 - (Number(node.data('hop')) || 0),
          levelWidth: () => 1,
          minNodeSpacing: 60,
          padding: 48,
        } as LayoutOptions
      : {
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
        } as LayoutOptions
    // Fit after the layout finishes moving nodes, not synchronously right
    // after starting it — firing cy.fit() immediately fits to the pre/mid
    // animation positions, not the finished layout (layoutstop fires either
    // way, animated or not).
    const run = cy.layout(layout)
    run.one('layoutstop', () => cy.fit(cy.elements(), 40))
    run.run()
  }, [elements])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().unselect()
    const selectedId = selectedNodeId || selectedEdgeId
    if (selectedId) cy.$id(selectedId).select()
  }, [selectedEdgeId, selectedNodeId])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().removeClass('dimmed')
    if (!eventHighlightIds || eventHighlightIds.length === 0) return

    const highlighted = new Set(eventHighlightIds)
    const visibleNodeIds = new Set(cy.nodes().map((node) => node.id()))
    // Dimming everything because none of the event's participants happen to
    // be on the current map would read as a broken graph, not a filter —
    // leave it alone and let the timeline's own participant chips be the way
    // to jump to an off-screen entity instead.
    const anyVisible = eventHighlightIds.some((id) => visibleNodeIds.has(id))
    if (!anyVisible) return

    cy.nodes().forEach((node) => {
      if (!highlighted.has(node.id())) node.addClass('dimmed')
    })
    cy.edges().forEach((edge) => {
      if (!highlighted.has(edge.source().id()) || !highlighted.has(edge.target().id())) edge.addClass('dimmed')
    })
  }, [elements, eventHighlightIds])

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
