import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntityRelevanceList from '../EntityRelevanceList'
import type { MemoryStatusEntity } from '../../../lib/types'

function makeEntity(overrides: Partial<MemoryStatusEntity> & { id: string; name: string }): MemoryStatusEntity {
  return {
    type: 'character',
    relevance_score: 0.5,
    status: 'active',
    consolidated: false,
    lifecycle: 'active',
    history: [{ score: 0.5, recorded_at: '2026-07-01T00:00:00Z' }],
    ...overrides,
  }
}

describe('EntityRelevanceList', () => {
  it('renders one row per entity, sorted by relevance descending', () => {
    render(<EntityRelevanceList entities={[
      makeEntity({ id: 'e1', name: 'Low', relevance_score: 0.2 }),
      makeEntity({ id: 'e2', name: 'High', relevance_score: 0.9 }),
    ]} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('High')
    expect(rows[1]).toHaveTextContent('Low')
  })

  it('filters by name', async () => {
    render(<EntityRelevanceList entities={[
      makeEntity({ id: 'e1', name: 'Lyra Vane' }),
      makeEntity({ id: 'e2', name: 'Kael Drystan' }),
    ]} />)

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/filter by name/i), 'lyra')

    expect(screen.getByText('Lyra Vane')).toBeInTheDocument()
    expect(screen.queryByText('Kael Drystan')).not.toBeInTheDocument()
  })

  it('filters by lifecycle', async () => {
    render(<EntityRelevanceList entities={[
      makeEntity({ id: 'e1', name: 'Active One', lifecycle: 'active' }),
      makeEntity({ id: 'e2', name: 'Archived One', lifecycle: 'archived' }),
    ]} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'archived' }))

    expect(screen.getByText('Archived One')).toBeInTheDocument()
    expect(screen.queryByText('Active One')).not.toBeInTheDocument()
  })

  it('shows only the top 8 entities by default, with a button to reveal the rest', async () => {
    const entities = Array.from({ length: 12 }, (_, index) =>
      makeEntity({ id: `e${index}`, name: `Entity ${index}`, relevance_score: 1 - index * 0.05 }))

    render(<EntityRelevanceList entities={entities} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    const showAllBtn = screen.getByRole('button', { name: /show all 12/i })

    const user = userEvent.setup()
    await user.click(showAllBtn)

    expect(screen.getAllByRole('listitem')).toHaveLength(12)
  })

  it('renders the empty message when there are no entities', () => {
    render(<EntityRelevanceList entities={[]} />)
    expect(screen.getByText(/no entity lifecycle data yet/i)).toBeInTheDocument()
  })
})
