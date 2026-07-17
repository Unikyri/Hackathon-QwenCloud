import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FusionExplorer from '../FusionExplorer'
import { api } from '../../../lib/api'

vi.mock('../../../lib/api', () => ({ api: { recallExplain: vi.fn() } }))

const recallExplain = api.recallExplain as ReturnType<typeof vi.fn>

const explanation = {
  query: 'dragon',
  pipeline_sizes: { vector: 2, graph: 1, recency: 1, keyword: 0, consolidated: 0 },
  items: [
    {
      id: 'i1', entity_id: 'e1', fact: 'The dragon guards the tower', rrf_score: 0.9,
      contributions: [{ pipeline: 'vector', rank: 1, delta: 0.5 }, { pipeline: 'graph', rank: 2, delta: 0.4 }], fit_in_budget: true,
    },
    {
      id: 'i2', entity_id: 'e2', fact: 'A lone knight rides north', rrf_score: 0.3,
      contributions: [{ pipeline: 'recency', rank: 1, delta: 0.3 }], fit_in_budget: false,
    },
  ],
  budget: { max_context_tokens: 1000, available: 400, entities_tokens: 200, vector_tokens: 300, tools_tokens: 100, used_percent: 60, vector_tokens_used: 120 },
}

function renderAndRecall(query = 'dragon') {
  render(<FusionExplorer universeId="u1" />)
  fireEvent.change(screen.getByLabelText(/ask about your story/i), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: /^recall$/i }))
}

describe('FusionExplorer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows retrieved evidence first and hides pipeline details until requested', async () => {
    recallExplain.mockResolvedValue(explanation)
    renderAndRecall()

    await waitFor(() => expect(screen.getByTestId('fused-item-i1')).toBeInTheDocument())
    expect(screen.getByText(/what quill found/i)).toBeInTheDocument()
    expect(screen.getByTestId('fused-item-i1')).toHaveTextContent(/the dragon guards the tower/i)
    expect(screen.getByTestId('fit-in-budget-i1')).toHaveTextContent(/included/i)
    expect(screen.getByTestId('fit-in-budget-i2')).toHaveTextContent(/held back/i)
    const explanationDetails = screen.getByText(/see how this recall was assembled/i).closest('details')
    expect(explanationDetails).not.toHaveAttribute('open')

    fireEvent.click(screen.getByText(/see how this recall was assembled/i))
    expect(explanationDetails).toHaveAttribute('open')
    expect(screen.getByTestId('pipeline-column-vector')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-column-consolidated')).toBeInTheDocument()
    expect(screen.getByTestId('contribution-i1-vector')).toHaveTextContent(/semantic matches/i)
    expect(screen.getByTestId('contribution-i1-graph')).toBeInTheDocument()
  })

  it('shows an honest empty result when no matching memory is returned', async () => {
    recallExplain.mockResolvedValue({ ...explanation, items: [], pipeline_sizes: {} })
    renderAndRecall()
    await waitFor(() => expect(screen.getByText(/found no matching memory/i)).toBeInTheDocument())
  })

  it('shows a loading state and offers a retry after a failed request', async () => {
    let reject!: (error: Error) => void
    recallExplain.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest }))
    renderAndRecall()
    expect(screen.getByRole('status')).toHaveTextContent(/searching quill/i)

    reject(new Error('Memory service unavailable'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/memory service unavailable/i))
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('does not call the API for an empty question', () => {
    render(<FusionExplorer universeId="u1" />)
    fireEvent.click(screen.getByRole('button', { name: /^recall$/i }))
    expect(recallExplain).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/ask a specific question/i)
  })

  it('ignores a deferred A recall after the universe changes to B', async () => {
    let resolveA!: (value: typeof explanation) => void
    let resolveB!: (value: typeof explanation) => void
    const onResult = vi.fn()
    const responseA = { ...explanation, query: 'a question', items: [{ ...explanation.items[0], id: 'a-item', fact: 'A-only evidence' }] }
    const responseB = { ...explanation, query: 'b question', items: [{ ...explanation.items[0], id: 'b-item', fact: 'B-only evidence' }] }
    recallExplain.mockImplementation((universeId: string) => new Promise((resolve) => {
      if (universeId === 'uni-a') resolveA = resolve
      else resolveB = resolve
    }))

    const view = render(<FusionExplorer universeId="uni-a" onResult={onResult} />)
    fireEvent.change(screen.getByLabelText(/ask about your story/i), { target: { value: 'a question' } })
    fireEvent.click(screen.getByRole('button', { name: /^recall$/i }))
    await waitFor(() => expect(recallExplain).toHaveBeenCalledWith('uni-a', 'a question', 10))

    view.rerender(<FusionExplorer universeId="uni-b" onResult={onResult} />)
    fireEvent.change(screen.getByLabelText(/ask about your story/i), { target: { value: 'b question' } })
    fireEvent.click(screen.getByRole('button', { name: /^recall$/i }))
    await waitFor(() => expect(recallExplain).toHaveBeenCalledWith('uni-b', 'b question', 10))

    resolveB(responseB)
    await waitFor(() => expect(screen.getByTestId('fused-item-b-item')).toBeInTheDocument())

    resolveA(responseA)
    await waitFor(() => expect(screen.getByTestId('fused-item-b-item')).toBeInTheDocument())
    expect(screen.queryByText('A-only evidence')).not.toBeInTheDocument()
    expect(onResult).not.toHaveBeenCalledWith(responseA)
  })
})
