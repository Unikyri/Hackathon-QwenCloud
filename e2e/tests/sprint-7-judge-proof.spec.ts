import AxeBuilder from '../../frontend/node_modules/@axe-core/playwright'
import { expect, test, type Page } from '../../frontend/node_modules/@playwright/test'

const universeID = '7c3a7d21-1c32-4de6-a6b4-111111111111'
const workID = '4ab58c64-1a6c-4c7a-92e3-222222222222'
const chapterID = '9df3d5c1-9c17-45ec-a14e-333333333333'
const maraID = 'c2c0d70c-1e93-4e9c-aec3-444444444444'
const archiveID = 'c3c0d70c-1e93-4e9c-aec3-555555555555'

const universe = {
  id: universeID,
  name: 'The Glass Archive',
  description: 'A city preserves every oath in luminous glass.',
  genre_tags: ['fantasy', 'mystery'],
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
}

const graph = {
  nodes: [
    {
      id: maraID,
      labels: ['character'],
      properties: {
        raw: `{"entity_id":"${maraID}","name":"Mara Venn","label":"character","status":"active","relevance_score":0.92}`,
      },
    },
    {
      id: archiveID,
      labels: ['place'],
      properties: {
        raw: `{"entity_id":"${archiveID}","name":"The Glass Archive","label":"place","status":"active","relevance_score":0.87}`,
      },
    },
  ],
  edges: [
    { id: 'edge-mara-archive', source: maraID, target: archiveID, type: 'protects' },
  ],
  truncated: false,
  limits: {
    hops: 1,
    max_hops: 2,
    node_limit: 96,
    edge_limit: 160,
    result_limit: 256,
  },
}

const recall = {
  query: 'Why does Mara protect the archive?',
  pipeline_sizes: { vector: 1, graph: 1, recency: 1, keyword: 1, consolidated: 0 },
  items: [
    {
      id: 'memory-mara-oath',
      entity_id: maraID,
      fact: 'Mara protects the archive because her oath is stored in its oldest glass panel.',
      rrf_score: 0.041,
      contributions: [
        { pipeline: 'vector', rank: 1, delta: 0.016 },
        { pipeline: 'graph', rank: 1, delta: 0.016 },
      ],
      fit_in_budget: true,
    },
  ],
  budget: {
    max_context_tokens: 4096,
    available: 3072,
    entities_tokens: 128,
    vector_tokens: 256,
    tools_tokens: 128,
    used_percent: 17,
    vector_tokens_used: 256,
  },
}

type StubOptions = {
  demoCloneFailures?: number
  recallFailures?: number
}

function response(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  }
}

async function stubApi(page: Page, options: StubOptions = {}) {
  let remainingDemoCloneFailures = options.demoCloneFailures ?? 0
  let remainingRecallFailures = options.recallFailures ?? 0

  await page.addInitScript(() => {
    localStorage.setItem('token', 'judge-proof-token')
  })

  // Keep the browser-side contract open without asking Vite's development
  // proxy to reach an unavailable backend WebSocket during deterministic UI proof.
  await page.routeWebSocket('**/api/v1/ws', () => {})

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/api/v1/auth/me') {
      await route.fulfill(response({ user: { id: 'judge-proof-user', email: 'judge@quill.local', display_name: 'Judge Proof' } }))
      return
    }

    if (path === '/api/v1/universes' && method === 'GET') {
      await route.fulfill(response({ universes: [universe], pagination: { page: 1, limit: 20, total: 1 } }))
      return
    }

    if (path === '/api/v1/demo/clone' && method === 'POST') {
      if (remainingDemoCloneFailures > 0) {
        remainingDemoCloneFailures -= 1
        await route.fulfill(response({ error: { message: 'Demo setup is temporarily unavailable.' } }, 503))
        return
      }

      await route.fulfill(response({ status: 'success', universe_id: universeID, message: 'Demo is ready.' }))
      return
    }

    if (path === `/api/v1/universes/${universeID}` && method === 'GET') {
      await route.fulfill(response({ universe }))
      return
    }

    if (path === `/api/v1/universes/${universeID}/works` && method === 'GET') {
      await route.fulfill(response({
        works: [{
          id: workID,
          universe_id: universeID,
          title: 'The Oathkeeper',
          type: 'novel',
          synopsis: 'Mara keeps the archive intact.',
          created_at: '2026-07-01T12:00:00Z',
          updated_at: '2026-07-01T12:00:00Z',
        }],
      }))
      return
    }

    if (path === `/api/v1/works/${workID}/chapters` && method === 'GET') {
      await route.fulfill(response({ chapters: [{
        id: chapterID,
        work_id: workID,
        title: 'The First Oath',
        order_index: 1,
        word_count: 42,
        created_at: '2026-07-01T12:00:00Z',
        updated_at: '2026-07-01T12:00:00Z',
      }] }))
      return
    }

    if (path === `/api/v1/universes/${universeID}/entities` && method === 'GET') {
      await route.fulfill(response({
        entities: [{ id: maraID, name: 'Mara Venn', type: 'character', status: 'active' }],
        counts_by_type: { character: 1 },
        pagination: { page: 1, limit: 8, total: 1 },
      }))
      return
    }

    if (path === `/api/v1/entities/${maraID}/neighbors` && method === 'GET') {
      await route.fulfill(response(graph))
      return
    }

    if (path === `/api/v1/universes/${universeID}/recall/explain` && method === 'POST') {
      if (remainingRecallFailures > 0) {
        remainingRecallFailures -= 1
        await route.fulfill(response({ error: { message: 'Memory evidence is temporarily unavailable.' } }, 503))
        return
      }

      await route.fulfill(response(recall))
      return
    }

    if (path === `/api/v1/universes/${universeID}/contradictions` && method === 'GET') {
      await route.fulfill(response({ contradictions: [{
        id: 'contradiction-oath',
        title: 'Mara’s oath changes between chapters',
        description: 'The wording of the oath conflicts with the archive record.',
        severity: 'high',
        evidence_a: 'Mara swore never to enter the archive.',
        evidence_b: 'Mara guards the archive every night.',
        status: 'open',
      }] }))
      return
    }

    if (path === `/api/v1/universes/${universeID}/plot-holes` && method === 'GET') {
      await route.fulfill(response({ plot_holes: [] }))
      return
    }

    if (path === `/api/v1/universes/${universeID}/candidates` && method === 'GET') {
      await route.fulfill(response({ candidates: [] }))
      return
    }

    await route.fulfill(response({ error: { message: `Unmocked browser request: ${method} ${path}` } }, 404))
  })
}

async function startGuidedDemo(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'commit' })
  await expect(page.getByRole('heading', { name: 'Your writing worlds', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clone demo universe' }).click()
  await expect(page.getByRole('button', { name: 'Start guided demo' })).toBeVisible()
  await page.getByRole('button', { name: 'Start guided demo' }).click()
  await expect(page).toHaveURL(new RegExp(`/universe/${universeID}/write$`))
  await expect(page.getByRole('heading', { name: 'Six steps, only real progress', exact: true })).toBeVisible()
}

async function expectNoA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(results.violations, `${label}: ${results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('; ')}`).toEqual([])
}

test('Sprint 7: guided demo uses real routes at desktop and mobile widths', async ({ page }, testInfo) => {
  await stubApi(page)
  await startGuidedDemo(page)

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (testInfo.project.name === 'mobile-chromium') {
    expect(viewport?.width).toBeLessThanOrEqual(500)
  } else {
    expect(viewport?.width).toBeGreaterThanOrEqual(1200)
  }

  await page.getByRole('link', { name: 'Open map' }).click()
  await expect(page).toHaveURL(new RegExp(`/universe/${universeID}/explore/map$`))
  await expect(page.getByRole('heading', { name: 'Relationship map', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entities and relationships', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Mara Venn\s*character$/ })).toBeVisible()

  await page.getByRole('link', { name: 'Open Memory' }).click()
  await expect(page.getByRole('heading', { name: 'What does Quill remember?', exact: true })).toBeVisible()
  await page.getByLabel('Ask about your story').fill(recall.query)
  await page.getByRole('button', { name: 'Recall' }).click()
  await expect(page.getByTestId('fused-item-memory-mara-oath')).toBeVisible()

  await page.getByRole('link', { name: 'Open Review' }).click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The wording of the oath conflicts with the archive record.', exact: true })).toBeVisible()
})

test('Sprint 7: failures are announced and retry stays in the real demo flow', async ({ page }) => {
  await stubApi(page, { demoCloneFailures: 1, recallFailures: 1 })
  await page.goto('/dashboard', { waitUntil: 'commit' })

  await page.getByRole('button', { name: 'Clone demo universe' }).click()
  await expect(page.getByLabel('See a living story world').getByRole('alert')).toContainText('Demo setup is temporarily unavailable.')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Start guided demo' })).toBeVisible()

  await page.getByRole('button', { name: 'Start guided demo' }).click()
  await page.getByRole('link', { name: 'Open Memory' }).click()
  await page.getByLabel('Ask about your story').fill(recall.query)
  await page.getByRole('button', { name: 'Recall' }).click()
  const memoryQuestion = page.getByRole('region', { name: 'What does Quill remember?' })
  await expect(memoryQuestion.getByRole('alert')).toContainText('Memory evidence is temporarily unavailable.')
  await memoryQuestion.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('fused-item-memory-mara-oath')).toBeVisible()
})

test('Sprint 7: keyboard navigation exposes focus and honors reduced motion', async ({ page }) => {
  await stubApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startGuidedDemo(page)

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Skip to content' })
  await expect(skipLink).toBeFocused()
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
  })
  expect(focusStyle.outlineStyle).toBe('solid')
  expect(focusStyle.outlineWidth).not.toBe('0px')

  await page.keyboard.press('Enter')
  await expect(page.locator('#universe-main')).toBeFocused()

  const motion = await skipLink.evaluate((element) => ({
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }))
  expect(motion.reduced).toBe(true)
  expect(parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001)

  await page.keyboard.press('Alt+4')
  await expect(page).toHaveURL(new RegExp(`/universe/${universeID}/memory$`))
})

test('Sprint 7: axe detects no WCAG A/AA violations on home and guided write', async ({ page }) => {
  await stubApi(page)
  await page.goto('/dashboard', { waitUntil: 'commit' })
  await expect(page.getByRole('heading', { name: 'Your writing worlds', exact: true })).toBeVisible()
  await expectNoA11yViolations(page, 'Dashboard')

  await startGuidedDemo(page)
  await expectNoA11yViolations(page, 'Guided write')
})

test('Sprint 7: the relationship map module stays lazy until its route is opened', async ({ page }) => {
  await stubApi(page)
  await startGuidedDemo(page)

  const hasGraphModule = () => page.evaluate(() => performance.getEntriesByType('resource')
    .some((entry) => /KnowledgeGraphPage(?:\.tsx|-[\w-]+\.js)/.test(entry.name)))

  expect(await hasGraphModule()).toBe(false)
  await page.getByRole('link', { name: 'Open map' }).click()
  await expect(page.getByRole('heading', { name: 'Relationship map', exact: true })).toBeVisible()
  await expect.poll(hasGraphModule).toBe(true)
})
