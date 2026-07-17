import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from '../api'

const API_BASE = '/api/v1'

describe('api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetchResponse(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  }

  // ── New Phase 2a methods ──────────────────────────────────────────────

  describe('getContradictions', () => {
    it('calls GET /universes/:id/contradictions and returns typed shape', async () => {
      const contradictions = [
        { id: 'c1', message: 'Plot hole', severity: 'high', entities: ['e1'] },
      ]
      mockFetchResponse({ contradictions })

      const result = await api.getContradictions('uni-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/contradictions`)
      expect(result.contradictions).toEqual(contradictions)
    })
  })

  describe('getTimeline', () => {
    it('calls GET /universes/:id/timeline and returns typed shape', async () => {
      const events = [
        { id: 'e1', label: 'Birth', timestamp: '2024-01-01', description: 'Born' },
      ]
      mockFetchResponse({ events })

      const result = await api.getTimeline('uni-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/timeline`)
      expect(result.events).toEqual(events)
    })
  })

  describe('getPlotHoles', () => {
    it('calls GET /universes/:id/plot-holes and returns typed shape', async () => {
      const plot_holes = [
        { id: 'p1', description: 'Missing link', severity: 'medium' },
      ]
      mockFetchResponse({ plot_holes })

      const result = await api.getPlotHoles('uni-1')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/plot-holes`)
      expect(result.plot_holes).toEqual(plot_holes)
    })
  })

  describe('plot-hole decisions', () => {
    it('calls the real resolve and dismiss endpoints', async () => {
      mockFetchResponse({})
      await api.resolvePlotHole('uni-1', 'plot-1')
      let [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/plot-holes/plot-1/resolve`)
      expect(init.method).toBe('PUT')

      mockFetchResponse({})
      await api.dismissPlotHole('uni-1', 'plot-1')
      ;[url, init] = fetchMock.mock.calls[1]
      expect(url).toBe(`${API_BASE}/universes/uni-1/plot-holes/plot-1/dismiss`)
      expect(init.method).toBe('PUT')
    })
  })

  describe('recall', () => {
    it('calls POST /universes/:id/recall with query and k in body, returns typed shape', async () => {
      const items = [
        { id: 'r1', fact: 'Alice is a wizard', score: 0.95, entity_id: 'e1' },
      ]
      mockFetchResponse({ items })

      const result = await api.recall('uni-1', 'wizard origin', 5)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/recall`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ query: 'wizard origin', k: 5 })
      expect(result.items).toEqual(items)
    })
  })

  describe('recallExplain', () => {
    it('calls POST /universes/:id/recall/explain with query and k in body, returns typed shape', async () => {
      const responseBody = {
        query: 'wizard origin',
        pipeline_sizes: { vector: 1, graph: 0, recency: 2, keyword: 0, consolidated: 0 },
        items: [
          {
            id: 'r1',
            entity_id: 'e1',
            fact: 'Alice is a wizard',
            rrf_score: 0.0164,
            contributions: [{ pipeline: 'vector', rank: 1, delta: 0.0164 }],
            fit_in_budget: true,
          },
        ],
        budget: {
          max_context_tokens: 8000,
          available: 4000,
          entities_tokens: 1000,
          vector_tokens: 2000,
          tools_tokens: 1000,
          used_percent: 50,
        },
      }
      mockFetchResponse(responseBody)

      const result = await api.recallExplain('uni-1', 'wizard origin', 5)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/universes/uni-1/recall/explain`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ query: 'wizard origin', k: 5 })
      expect(result).toEqual(responseBody)
    })

    it('defaults k to 10 when omitted', async () => {
      mockFetchResponse({
        query: 'q',
        pipeline_sizes: {},
        items: [],
        budget: {
          max_context_tokens: 0,
          available: 0,
          entities_tokens: 0,
          vector_tokens: 0,
          tools_tokens: 0,
          used_percent: 0,
        },
      })

      await api.recallExplain('uni-1', 'q')

      const [, init] = fetchMock.mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ query: 'q', k: 10 })
    })
  })

  describe('demo endpoints', () => {
    it('sends the opaque demo session separately from the bearer token', async () => {
      const bearerToken = 'jwt-bearer-token'
      const sessionID = '8f0a33c4-5b9d-4fb5-a7ef-3ec2bc20e0a1'
      localStorage.setItem('token', bearerToken)
      mockFetchResponse({ status: 'success', universe_id: 'demo-universe', message: 'ready' })

      await api.demoClone(sessionID)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/demo/clone`)
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${bearerToken}`,
        'X-Session-ID': sessionID,
      })
      expect(init.headers['X-Session-ID']).not.toBe(bearerToken)
    })
  })
})
