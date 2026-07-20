import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import GraphControls from '../GraphControls'
import { ENTITY_TYPES } from '../../../lib/entityTypes'
import { useGraphStore } from '../../../stores/graphStore'

beforeEach(() => {
  useGraphStore.setState({
    nodeFilter: Object.fromEntries(ENTITY_TYPES.map((type) => [type, true])),
    showArchived: false,
  })
})

describe('GraphControls', () => {
  it('exposes only the archived toggle — per-type filtering lives in the sidebar chips', () => {
    render(<GraphControls />)

    for (const type of ENTITY_TYPES) {
      expect(screen.queryByRole('checkbox', { name: `Toggle ${type} entities` })).not.toBeInTheDocument()
    }

    const archivedToggle = screen.getByRole('checkbox', { name: 'Show archived entities' })
    expect(archivedToggle).not.toBeChecked()
    fireEvent.click(archivedToggle)
    expect(archivedToggle).toBeChecked()
  })

  it('shows the edge legend only when a focal entity is set', () => {
    const { rerender } = render(<GraphControls />)
    expect(screen.queryByLabelText('What the relationship line styles mean')).not.toBeInTheDocument()

    useGraphStore.setState({ focalNodeId: 'n1' })
    rerender(<GraphControls />)
    expect(screen.getByLabelText('What the relationship line styles mean')).toBeInTheDocument()
    expect(screen.getByText('Direct to focal entity')).toBeInTheDocument()
    expect(screen.getByText('Second-degree (fainter, dashed)')).toBeInTheDocument()
  })
})
