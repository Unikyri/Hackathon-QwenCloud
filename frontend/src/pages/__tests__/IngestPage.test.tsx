import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import IngestPage from '../IngestPage'

vi.mock('../IngestPage.module.css', () => ({ default: new Proxy({}, { get: (_, k) => k }) }))

const mockRouteParams = vi.hoisted(() => ({ universeId: 'uni-1' }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useParams: () => mockRouteParams }
})

const mockPublish = vi.fn(() => 'feedback-id')
const mockUpdate = vi.fn()
vi.mock('../../components/feedback', () => ({
  useFeedback: () => ({ publish: mockPublish, update: mockUpdate }),
}))

const mockIngestDocument = vi.fn()
const mockListIngestionJobs = vi.fn()
vi.mock('../../lib/api', () => ({
  api: {
    ingestDocument: (...args: unknown[]) => mockIngestDocument(...args),
    listIngestionJobs: (...args: unknown[]) => mockListIngestionJobs(...args),
  },
}))

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
let mockIngestionProgress: Record<string, unknown> = {}

vi.mock('../../stores/wsStore', () => ({
  useWSStore: (selector: (s: unknown) => unknown) => {
    const state = { ingestionProgress: mockIngestionProgress, status: 'open', connect: mockConnect, disconnect: mockDisconnect }
    return selector ? selector(state) : state
  },
}))

vi.mock('../../hooks/useWS', () => ({
  useWS: () => ({ status: 'open' }),
}))

function pageTree() {
  return (
    <MemoryRouter initialEntries={[`/universe/${mockRouteParams.universeId}/ingest`]}>
      <Routes>
        <Route path="/universe/:universeId/ingest" element={<IngestPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderPage(universeId = 'uni-1') {
  mockRouteParams.universeId = universeId
  return render(pageTree())
}

describe('IngestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteParams.universeId = 'uni-1'
    mockIngestionProgress = {}
    mockListIngestionJobs.mockResolvedValue({ jobs: [] })
  })

  it('renders the dropzone', async () => {
    renderPage()
    expect(await screen.findByText('Choose a manuscript or drop it here')).toBeInTheDocument()
  })

  it('rejects unsupported file types without calling the API', async () => {
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['binary'], 'cover.png', { type: 'image/png' })

    const user = userEvent.setup()
    await user.upload(input, file)

    expect(mockIngestDocument).not.toHaveBeenCalled()
    expect(await screen.findByText('Only .md, .txt, .pdf, and .docx files are supported.')).toBeInTheDocument()
  })

  it('rejects legacy .doc files without calling the API', async () => {
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['binary'], 'manuscript.doc', { type: 'application/msword' })

    const user = userEvent.setup()
    await user.upload(input, file)

    expect(mockIngestDocument).not.toHaveBeenCalled()
    expect(await screen.findByText('Only .md, .txt, .pdf, and .docx files are supported.')).toBeInTheDocument()
  })

  it('uploads an accepted file and lists it as a job', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-1', status: 'accepted' })
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'manuscript.md', { type: 'text/markdown' })

    const user = userEvent.setup()
    await user.upload(input, file)

    await waitFor(() => {
      expect(mockIngestDocument).toHaveBeenCalledWith('uni-1', file)
      expect(screen.getByText('manuscript.md')).toBeInTheDocument()
      expect(screen.getByText('Queued')).toBeInTheDocument()
    })
  })

  it('hydrates persisted jobs from the GET endpoint on mount', async () => {
    mockListIngestionJobs.mockResolvedValue({
      jobs: [
        {
          id: 'job-9',
          universe_id: 'uni-1',
          work_id: 'work-1',
          filename: 'persisted.md',
          status: 'completed',
          total_chapters_detected: 3,
          chapters_processed: 3,
          entities_extracted: 12,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(mockListIngestionJobs).toHaveBeenCalledWith('uni-1')
      expect(screen.getByText('persisted.md')).toBeInTheDocument()
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('displays the backend error message for a failed job', async () => {
    mockListIngestionJobs.mockResolvedValue({
      jobs: [
        {
          id: 'job-fail',
          universe_id: 'uni-1',
          work_id: 'work-1',
          filename: 'broken.md',
          status: 'failed',
          error_message: 'document contains no text',
          total_chapters_detected: 0,
          chapters_processed: 0,
          entities_extracted: 0,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.getByText('document contains no text')).toBeInTheDocument()
    })
  })

  it('does not render an error line when a failed job has no error message', async () => {
    mockListIngestionJobs.mockResolvedValue({
      jobs: [
        {
          id: 'job-fail',
          universe_id: 'uni-1',
          work_id: 'work-1',
          filename: 'broken.md',
          status: 'failed',
          total_chapters_detected: 0,
          chapters_processed: 0,
          entities_extracted: 0,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
    expect(screen.queryByText(/document contains no text/)).not.toBeInTheDocument()
  })

  it('shows the existing job instead of a new card on a duplicate upload', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-9', status: 'duplicate' })
    renderPage()
    await waitFor(() => expect(mockListIngestionJobs).toHaveBeenCalledTimes(1))

    mockListIngestionJobs.mockResolvedValue({
      jobs: [
        {
          id: 'job-9',
          universe_id: 'uni-1',
          work_id: 'work-1',
          filename: 'manuscript.md',
          status: 'completed',
          total_chapters_detected: 3,
          chapters_processed: 3,
          entities_extracted: 12,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })

    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'manuscript.md', { type: 'text/markdown' })
    const user = userEvent.setup()
    await user.upload(input, file)

    await waitFor(() => {
      expect(mockListIngestionJobs).toHaveBeenCalledTimes(2)
      expect(screen.getAllByText('manuscript.md')).toHaveLength(1)
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('shows live action and ETA from ingestion_progress WS state without static steps', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-1', status: 'accepted' })
    mockIngestionProgress = {
      'job-1': { job_id: 'job-1', status: 'running', chapters_processed: 2, total_chapters: 4, action: 'Extracting entities from chapter 2…', eta_seconds: 18 },
    }
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'manuscript.md', { type: 'text/markdown' })

    const user = userEvent.setup()
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('Processing…')).toBeInTheDocument()
      expect(screen.getByText(/Extracting entities from chapter 2/)).toBeInTheDocument()
      expect(screen.getByText(/18s remaining/)).toBeInTheDocument()
      expect(screen.queryByText('Split chapters')).not.toBeInTheDocument()
    })
  })

  it('marks the job Completed when the terminal WS status arrives', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-1', status: 'accepted' })
    mockIngestionProgress = {
      'job-1': { job_id: 'job-1', status: 'completed', chapters_processed: 4, total_chapters: 4 },
    }
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'manuscript.md', { type: 'text/markdown' })

    const user = userEvent.setup()
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('marks an empty-document job (total_chapters: 0) Completed on the terminal WS status', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-1', status: 'accepted' })
    mockIngestionProgress = {
      'job-1': { job_id: 'job-1', status: 'completed', chapters_processed: 0, total_chapters: 0 },
    }
    renderPage()
    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File([''], 'empty.md', { type: 'text/markdown' })

    const user = userEvent.setup()
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('keeps a just-uploaded job current when the initial fetch resolves late', async () => {
    let resolveFetch!: (v: { jobs: unknown[] }) => void
    mockListIngestionJobs.mockReturnValue(new Promise((r) => { resolveFetch = r }))
    mockIngestDocument.mockResolvedValue({ job_id: 'job-new', status: 'accepted' })
    renderPage()

    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'fresh.md', { type: 'text/markdown' })
    const user = userEvent.setup()
    await user.upload(input, file)
    await waitFor(() => expect(screen.getByText('fresh.md')).toBeInTheDocument())

    resolveFetch({
      jobs: [
        {
          id: 'job-old',
          universe_id: 'uni-1',
          work_id: 'work-1',
          filename: 'old.md',
          status: 'completed',
          total_chapters_detected: 1,
          chapters_processed: 1,
          entities_extracted: 2,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })

    await waitFor(() => {
      // The active upload remains the single visible status even after the
      // historical list arrives late.
      expect(screen.getByText('fresh.md')).toBeInTheDocument()
    })
  })

  it('offers a "Check status" fallback for a job stuck Processing, which re-fetches the job list', async () => {
    mockIngestDocument.mockResolvedValue({ job_id: 'job-1', status: 'accepted' })
    mockIngestionProgress = {
      'job-1': { job_id: 'job-1', status: 'running', chapters_processed: 2, total_chapters: 4 },
    }
    renderPage()
    await waitFor(() => expect(mockListIngestionJobs).toHaveBeenCalledTimes(1))

    const input = await screen.findByTestId('ingest-file-input') as HTMLInputElement
    const file = new File(['# Chapter 1'], 'manuscript.md', { type: 'text/markdown' })

    const user = userEvent.setup()
    await user.upload(input, file)

    const checkStatusBtn = await screen.findByText('Check status')
    await user.click(checkStatusBtn)

    expect(mockListIngestionJobs).toHaveBeenCalledTimes(2)
  })

  it('ignores a deferred A job list after the route changes to B', async () => {
    let resolveA!: (value: { jobs: unknown[] }) => void
    let resolveB!: (value: { jobs: unknown[] }) => void
    mockListIngestionJobs.mockImplementation((universeId: string) => new Promise((resolve) => {
      if (universeId === 'uni-a') resolveA = resolve
      else resolveB = resolve
    }))

    const view = renderPage('uni-a')
    await waitFor(() => expect(mockListIngestionJobs).toHaveBeenCalledWith('uni-a'))

    mockRouteParams.universeId = 'uni-b'
    view.rerender(pageTree())
    await waitFor(() => expect(mockListIngestionJobs).toHaveBeenCalledWith('uni-b'))

    resolveB({
      jobs: [{
        id: 'job-b', universe_id: 'uni-b', work_id: 'work-b', filename: 'universe-b.md', status: 'completed',
        total_chapters_detected: 1, chapters_processed: 1,
      }],
    })
    await waitFor(() => expect(screen.getByText('universe-b.md')).toBeInTheDocument())

    resolveA({
      jobs: [{
        id: 'job-a', universe_id: 'uni-a', work_id: 'work-a', filename: 'universe-a.md', status: 'completed',
        total_chapters_detected: 1, chapters_processed: 1,
      }],
    })
    await waitFor(() => expect(screen.getByText('universe-b.md')).toBeInTheDocument())
    expect(screen.queryByText('universe-a.md')).not.toBeInTheDocument()
  })
})
