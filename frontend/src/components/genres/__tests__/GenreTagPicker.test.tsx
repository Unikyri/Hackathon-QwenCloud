import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { GenreTagPicker } from '../GenreTagPicker'

function ControlledPicker({ initialValue = [] }: { initialValue?: string[] }) {
  const [value, setValue] = useState(initialValue)
  return <GenreTagPicker onChange={setValue} value={value} />
}

describe('GenreTagPicker', () => {
  it('renders the existing closed vocabulary with no forced selection', () => {
    render(<ControlledPicker />)

    expect(screen.getAllByRole('checkbox')).toHaveLength(20)
    expect(screen.getByRole('checkbox', { name: 'Fantasy' })).not.toBeChecked()
    expect(screen.getByText('No genres selected. Genres are optional.')).toBeInTheDocument()
  })

  it('filters the vocabulary and emits a controlled multi-selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<GenreTagPicker onChange={onChange} value={['horror']} />)

    await user.type(screen.getByRole('searchbox', { name: 'Search genres' }), 'science')
    expect(screen.getByRole('checkbox', { name: 'Science Fiction' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Fantasy' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Science Fiction' }))
    expect(onChange).toHaveBeenCalledWith(['horror', 'science-fiction'])
  })

  it('supports keyboard selection and removable selected tags', async () => {
    const user = userEvent.setup()
    render(<ControlledPicker initialValue={['fantasy']} />)

    const horror = screen.getByRole('checkbox', { name: 'Horror' })
    horror.focus()
    await user.keyboard('[Space]')
    expect(horror).toBeChecked()
    expect(screen.getByRole('button', { name: 'Remove Horror' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Fantasy' }))
    expect(screen.getByRole('checkbox', { name: 'Fantasy' })).not.toBeChecked()
  })
})
