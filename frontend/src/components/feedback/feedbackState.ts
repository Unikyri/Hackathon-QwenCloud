import type { FeedbackEvent, FeedbackEventInput, FeedbackEventUpdate, FeedbackStatus } from './types'

const transitions: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  queued: ['running', 'completed', 'failed', 'offline'],
  running: ['completed', 'failed', 'offline'],
  completed: [],
  failed: ['queued', 'running', 'offline'],
  offline: ['queued', 'running', 'failed'],
}

let feedbackSequence = 0

export function createFeedbackEvent(input: FeedbackEventInput): FeedbackEvent {
  feedbackSequence += 1

  return {
    id: `feedback-${Date.now()}-${feedbackSequence}`,
    scope: input.scope,
    status: input.status,
    message: input.message,
    timestamp: input.timestamp ?? Date.now(),
    retry: input.retry,
  }
}

export function canTransitionFeedback(
  current: FeedbackStatus,
  next: FeedbackStatus,
): boolean {
  return current === next || transitions[current].includes(next)
}

export function updateFeedbackEvent(
  events: readonly FeedbackEvent[],
  id: string,
  patch: FeedbackEventUpdate,
): FeedbackEvent[] {
  let found = false

  const nextEvents = events.map((event) => {
    if (event.id !== id) return event

    found = true
    const nextStatus = patch.status ?? event.status
    if (!canTransitionFeedback(event.status, nextStatus)) {
      throw new Error(`Feedback event "${id}" cannot transition from ${event.status} to ${nextStatus}.`)
    }

    return {
      ...event,
      ...patch,
      timestamp: patch.timestamp ?? Date.now(),
    }
  })

  if (!found) {
    throw new Error(`Feedback event "${id}" does not exist.`)
  }

  return nextEvents
}

export function feedbackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The request could not be completed. Please try again.'
}
