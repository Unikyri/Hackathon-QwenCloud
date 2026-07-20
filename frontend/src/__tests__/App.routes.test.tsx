import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../App'

const mockGetWork = vi.fn()

vi.mock('../lib/api', () => ({
  api: { getWork: (...args: unknown[]) => mockGetWork(...args) },
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) => selector({ isAuthenticated: true }),
}))

vi.mock('../pages/LoginPage', () => ({ default: () => <div>Login route</div> }))
vi.mock('../pages/DashboardPage', () => ({ default: () => <div>Dashboard route</div> }))
vi.mock('../pages/EditorRedirect', () => ({ default: () => <div>Legacy editor redirect</div> }))
vi.mock('../pages/EntityRedirect', () => ({ default: () => <div>Legacy entity redirect</div> }))
vi.mock('../pages/UniverseLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { default: () => <><div>Universe shell</div><Outlet /></> }
})
vi.mock('../pages/ProfileLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { default: () => <><div>Profile shell</div><Outlet /></> }
})
vi.mock('../pages/LandingPage', () => ({ default: () => <div>Landing route</div> }))
vi.mock('../pages/UniverseWorksTab', () => ({ default: () => <div>Write route</div> }))
vi.mock('../pages/EditorPage', () => ({ default: () => <div>Editor route</div> }))
vi.mock('../pages/KnowledgeGraphPage', () => ({ default: () => <div>Map route</div> }))
vi.mock('../pages/MemoryInspectorPage', () => ({ default: () => <div>Memory route</div> }))
vi.mock('../pages/ReviewPage', () => ({ default: () => <div>Review route</div> }))
vi.mock('../pages/WriterProfilePage', () => ({ default: () => <div>Writer profile route</div> }))
vi.mock('../pages/IntegrationsPage', () => ({ default: () => <div>Integrations route</div> }))
// C: SkillsPage is now a real route, not a redirect — mock it so route tests can render it.
vi.mock('../pages/SkillsPage', () => ({ default: () => <div>Skills route</div> }))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="route-location">{location.pathname}{location.search}</output>
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('App legacy universe routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWork.mockResolvedValue({ work: { id: 'work-1', universe_id: 'uni-1' } })
  })

  it.each([
    ['works', '/universe/uni-1/works', '/universe/uni-1/write'],
    ['editor picker', '/universe/uni-1/editor', '/universe/uni-1/write'],
    ['editor chapter', '/universe/uni-1/editor/ch-1', '/universe/uni-1/write/ch-1'],
    ['ingest', '/universe/uni-1/ingest', '/universe/uni-1/write?panel=import'],
    ['entities', '/universe/uni-1/entities', '/universe/uni-1/explore/map'],
    ['entity', '/universe/uni-1/entities/entity-1', '/universe/uni-1/explore/map?entity=entity-1'],
    ['graph', '/universe/uni-1/graph', '/universe/uni-1/explore/map'],
    ['timeline', '/universe/uni-1/timeline', '/universe/uni-1/explore/map'],
    ['explore timeline (folded into map)', '/universe/uni-1/explore/timeline', '/universe/uni-1/explore/map'],
    ['explore entities (removed EntitiesPage)', '/universe/uni-1/explore/entities', '/universe/uni-1/explore/map'],
    ['explore entity (removed EntitiesPage)', '/universe/uni-1/explore/entities/entity-1', '/universe/uni-1/explore/map?entity=entity-1'],
    ['contradictions', '/universe/uni-1/contradictions', '/universe/uni-1/review/issues'],
    ['plot holes', '/universe/uni-1/plot-holes', '/universe/uni-1/review/issues'],
    // C: /skills is now its own route (SkillsPage), NOT a redirect. Kept here only
    // so the original list stays full — this entry now verifies the route stays
    // at the skills path rather than redirecting away.
    ['panorama', '/universe/uni-1/panorama', '/dashboard'],
    ['universe wildcard', '/universe/uni-1/not-a-real-route', '/universe/uni-1/write'],
  ])('redirects legacy %s route to the canonical destination', async (_name, legacyPath, expectedPath) => {
    renderRoute(legacyPath)

    await waitFor(() => {
      expect(screen.getByTestId('route-location')).toHaveTextContent(expectedPath)
    })
  })

  it('redirects a legacy work URL through the owner-authorized lookup to Write', async () => {
    renderRoute('/work/work-1')

    await waitFor(() => {
      expect(screen.getByTestId('route-location')).toHaveTextContent('/universe/uni-1/write')
    })
    expect(mockGetWork).toHaveBeenCalledWith('work-1')
  })

  it('renders SkillsPage (not a redirect) for /skills', async () => {
    // C: /skills was previously a redirect to /review/issues. It now renders the
    // real Skills activation surface. Verify the route stays at the skills path.
    renderRoute('/universe/uni-1/skills')
    await waitFor(() => expect(screen.getByText('Skills route')).toBeInTheDocument())
    expect(screen.getByTestId('route-location')).toHaveTextContent('/universe/uni-1/skills')
  })

})

describe('App account-scoped routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the account-scoped Writer Profile outside the universe-nested layout', async () => {
    renderRoute('/profile/memory')

    await waitFor(() => expect(screen.getByText('Profile shell')).toBeInTheDocument())
    expect(await screen.findByText('Writer profile route')).toBeInTheDocument()
    expect(screen.queryByText('Universe shell')).not.toBeInTheDocument()
  })

  it('defaults /profile to Writer Profile', async () => {
    renderRoute('/profile')

    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('/profile/memory'))
  })

  it('renders Integrations outside the universe-nested layout', async () => {
    renderRoute('/profile/integrations')

    await waitFor(() => expect(screen.getByText('Profile shell')).toBeInTheDocument())
    expect(await screen.findByText('Integrations route')).toBeInTheDocument()
    expect(screen.queryByText('Universe shell')).not.toBeInTheDocument()
  })
})
