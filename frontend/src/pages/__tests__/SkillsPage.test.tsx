import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SkillsPage from '../SkillsPage'

vi.mock('../SkillsPage.module.css', () => ({ default: new Proxy({}, { get: (_, key) => key }) }))

const mockRouteParams = vi.hoisted(() => ({ universeId: 'uni-1' }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => mockRouteParams }
})

const getSkills = vi.fn()
const getUniverseSkills = vi.fn()
const updateUniverseSkills = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    getSkills: (...args: unknown[]) => getSkills(...args),
    getUniverseSkills: (...args: unknown[]) => getUniverseSkills(...args),
    updateUniverseSkills: (...args: unknown[]) => updateUniverseSkills(...args),
  },
}))

// skillDisplay helpers are used internally — let them pass through.
vi.mock('../../lib/skillDisplay', () => ({
  displaySkillName: (name: string) => name.replace(/-/g, ' '),
  shortDescription: (desc: string) => desc,
}))

function pageTree() {
  return (
    <MemoryRouter initialEntries={[`/universe/${mockRouteParams.universeId}/skills`]}>
      <Routes>
        <Route path="/universe/:universeId/skills" element={<SkillsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderPage(universeId = 'uni-1') {
  mockRouteParams.universeId = universeId
  return render(pageTree())
}

const CATALOGUE = [
  { name: 'dialogue-and-voice', description: 'Checks dialogue clarity.', genre_tags: [], stage: 'craft' },
  { name: 'pacing', description: 'Evaluates scene pacing.', genre_tags: ['thriller'], stage: 'craft' },
  { name: 'continuity-check', description: 'Finds continuity errors.', genre_tags: [], stage: 'editorial' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockRouteParams.universeId = 'uni-1'
  getSkills.mockResolvedValue({ skills: CATALOGUE })
  getUniverseSkills.mockResolvedValue({ skills: [{ universe_id: 'uni-1', skill_name: 'pacing', activated_at: '2024-01-01' }] })
})

describe('SkillsPage', () => {
  it('renders the catalogue with on/off state from the universe skills API', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('skills-groups')).toBeInTheDocument())

    // pacing is active, the others are not
    const pacingCard = screen.getByTestId('skill-card-pacing')
    const dialogueCard = screen.getByTestId('skill-card-dialogue-and-voice')
    expect(within(pacingCard).getByRole('checkbox')).toBeChecked()
    expect(within(dialogueCard).getByRole('checkbox')).not.toBeChecked()
  })

  it('save button is disabled when there are no unsaved changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('skills-groups')).toBeInTheDocument())

    const saveBtn = screen.getByTestId('skills-save-button')
    expect(saveBtn).toBeDisabled()
  })

  it('enables the save button and calls updateUniverseSkills on save', async () => {
    updateUniverseSkills.mockResolvedValue({ skills: [
      { universe_id: 'uni-1', skill_name: 'pacing', activated_at: '2024-01-01' },
      { universe_id: 'uni-1', skill_name: 'dialogue-and-voice', activated_at: '2024-01-01' },
    ]})
    renderPage()
    await waitFor(() => expect(screen.getByTestId('skills-groups')).toBeInTheDocument())

    // Toggle dialogue-and-voice on
    const dialogueCard = screen.getByTestId('skill-card-dialogue-and-voice')
    fireEvent.click(within(dialogueCard).getByRole('checkbox'))

    const saveBtn = screen.getByTestId('skills-save-button')
    expect(saveBtn).not.toBeDisabled()

    fireEvent.click(saveBtn)
    await waitFor(() => expect(updateUniverseSkills).toHaveBeenCalledWith('uni-1', expect.arrayContaining(['pacing', 'dialogue-and-voice'])))
    // getByRole('status') targets the aria-live paragraph "Skill settings saved." specifically,
    // avoiding ambiguity with the button's "Saved ✓" text.
    expect(screen.getByRole('status')).toHaveTextContent(/skill settings saved/i)
  })

  it('shows an error state and retry button when the catalogue fails to load', async () => {
    getSkills.mockRejectedValue(new Error('network failure'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/network failure/i)

    // Retry re-fetches
    getSkills.mockResolvedValue({ skills: CATALOGUE })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByTestId('skills-groups')).toBeInTheDocument())
  })

  it('shows a save error without losing the current selection when the save fails', async () => {
    updateUniverseSkills.mockRejectedValue(new Error('save refused'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('skills-groups')).toBeInTheDocument())

    fireEvent.click(within(screen.getByTestId('skill-card-dialogue-and-voice')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('skills-save-button'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/save refused/i)

    // Checkbox state preserved
    expect(within(screen.getByTestId('skill-card-dialogue-and-voice')).getByRole('checkbox')).toBeChecked()
  })

  it('shows genre tags for skills that have them', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('skill-card-pacing')).toBeInTheDocument())
    expect(screen.getByTestId('skill-card-pacing')).toHaveTextContent('thriller')
  })
})
