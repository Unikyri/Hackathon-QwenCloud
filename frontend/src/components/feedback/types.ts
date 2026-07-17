export const FEEDBACK_STATUSES = ['queued', 'running', 'completed', 'failed', 'offline'] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export type FeedbackScope =
  | 'analysis'
  | 'autosave'
  | 'connection'
  | 'demo'
  | 'explore'
  | 'home'
  | 'memory'
  | 'request'
  | 'review'
  | 'write'

/**
 * A retry must explicitly report whether the underlying operation succeeded.
 * Callers that handle their own errors return `false`; uncaught errors are
 * handled by the provider and shown as failed feedback.
 */
export type FeedbackRetryAction = () => boolean | Promise<boolean>

export interface FeedbackEvent {
  id: string
  scope: FeedbackScope
  status: FeedbackStatus
  message: string
  timestamp: number
  retry?: FeedbackRetryAction
}

export interface FeedbackEventInput {
  scope: FeedbackScope
  status: FeedbackStatus
  message: string
  timestamp?: number
  retry?: FeedbackRetryAction
}

export interface FeedbackEventUpdate {
  scope?: FeedbackScope
  status?: FeedbackStatus
  message?: string
  timestamp?: number
  retry?: FeedbackRetryAction
}
