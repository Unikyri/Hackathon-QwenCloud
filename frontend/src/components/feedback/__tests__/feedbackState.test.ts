import { describe, expect, it } from 'vitest'
import {
  canTransitionFeedback,
  createFeedbackEvent,
  feedbackErrorMessage,
  updateFeedbackEvent,
} from '../feedbackState'

describe('feedback state machine', () => {
  it('moves a request through queued, running, and completed states', () => {
    const event = createFeedbackEvent({
      scope: 'request',
      status: 'queued',
      message: 'Preparing request.',
      timestamp: 1,
    })

    const running = updateFeedbackEvent([event], event.id, { status: 'running', timestamp: 2 })
    const completed = updateFeedbackEvent(running, event.id, { status: 'completed', timestamp: 3 })

    expect(completed[0]).toMatchObject({ status: 'completed', timestamp: 3 })
    expect(canTransitionFeedback('failed', 'running')).toBe(true)
  })

  it('rejects impossible transitions instead of hiding a failure', () => {
    const event = createFeedbackEvent({ scope: 'request', status: 'completed', message: 'Done.' })

    expect(() => updateFeedbackEvent([event], event.id, { status: 'running' }))
      .toThrow('cannot transition from completed to running')
    expect(feedbackErrorMessage(new Error('Service unavailable'))).toBe('Service unavailable')
  })
})
