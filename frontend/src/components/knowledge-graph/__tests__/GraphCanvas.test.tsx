import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import GraphCanvas from '../GraphCanvas'
import { useGraphStore } from '../../../stores/graphStore'

const { mockCore, mockCytoscape } = vi.hoisted(() => {
  const mockCore = {
    add: vi.fn(),
    destroy: vi.fn(),
    elements: vi.fn(() => ({ remove: vi.fn(), unselect: vi.fn() })),
    fit: vi.fn(),
    layout: vi.fn(() => ({ run: vi.fn() })),
    on: vi.fn(),
    resize: vi.fn(),
    $id: vi.fn(() => ({ select: vi.fn() })),
  }
  const mockCytoscape = Object.assign(vi.fn(() => mockCore), { use: vi.fn() })

  return { mockCore, mockCytoscape }
})

const graphLimits = { hops: 2, max_hops: 2, node_limit: 96, edge_limit: 160, result_limit: 256 }

vi.mock('cytoscape', () => ({ default: mockCytoscape }))
vi.mock('cytoscape-fcose', () => ({ default: {} }))

function latestAddedNodeIds() {
  const calls = mockCore.add.mock.calls
  const latestElements = (calls[calls.length - 1]?.[0] ?? []) as Array<{
    group: string
    data: { id: string }
  }>

  return latestElements
    .filter((element) => element.group === 'nodes')
    .map((element) => element.data.id)
}

beforeEach(() => {
  vi.clearAllMocks()
  useGraphStore.setState({
    nodes: [
      { id: 'active', type: 'character', data: { label: 'Active', status: 'active' } },
      { id: 'archived', type: 'object', data: { label: 'Archived', status: 'archived' } },
    ],
    edges: [],
    nodeFilter: { character: true, place: true, object: true, faction: true, event: true, world_rule: true, plot_arc: true },
    showArchived: false,
    limits: graphLimits,
  })
})

describe('GraphCanvas', () => {
  it('hides archived nodes until the archived toggle is enabled', async () => {
    render(<GraphCanvas />)
    expect(screen.getByRole('application', { name: /story relationship map/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(latestAddedNodeIds()).toEqual(['active'])
    })

    act(() => {
      useGraphStore.setState({ showArchived: true })
    })

    await waitFor(() => {
      expect(latestAddedNodeIds()).toEqual(['active', 'archived'])
    })
  })

  it('does not run fCoSE when graph data lacks traversal bounds', async () => {
    useGraphStore.setState({ limits: null })

    render(<GraphCanvas />)

    await waitFor(() => {
      expect(mockCore.add).not.toHaveBeenCalled()
      expect(mockCore.layout).not.toHaveBeenCalled()
    })
  })
})
