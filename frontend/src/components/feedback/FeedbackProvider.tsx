import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Toaster, toast } from 'sonner'
import { createFeedbackEvent, feedbackErrorMessage, updateFeedbackEvent } from './feedbackState'
import styles from './FeedbackProvider.module.css'
import type { FeedbackEvent, FeedbackEventInput, FeedbackEventUpdate } from './types'

interface FeedbackContextValue {
  events: readonly FeedbackEvent[]
  publish: (event: FeedbackEventInput) => string
  update: (id: string, patch: FeedbackEventUpdate) => void
  dismiss: (id: string) => void
  retry: (id: string) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

function announcement(event: FeedbackEvent | undefined): string {
  if (!event) return ''
  return `${event.scope}: ${event.message}`
}

function toastDuration(event: FeedbackEvent): number | typeof Infinity {
  return event.status === 'failed' || event.status === 'offline' ? Infinity : 5_000
}

function isNonBlockingToast(event: FeedbackEvent): boolean {
  return event.status === 'queued' || event.status === 'running' || event.status === 'completed'
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<FeedbackEvent[]>([])
  const eventsRef = useRef<FeedbackEvent[]>([])
  const retryRef = useRef<(id: string) => Promise<boolean>>(async () => false)

  const replaceEvents = useCallback((nextEvents: FeedbackEvent[]) => {
    eventsRef.current = nextEvents
    setEvents(nextEvents)
  }, [])

  const showToast = useCallback((event: FeedbackEvent) => {
    const action = event.retry && (event.status === 'failed' || event.status === 'offline')
      ? { label: 'Retry', onClick: () => { void retryRef.current(event.id) } }
      : undefined
    const options = {
      id: event.id,
      description: event.scope,
      duration: toastDuration(event),
      action,
      className: isNonBlockingToast(event) ? styles.nonBlockingToast : undefined,
    }

    switch (event.status) {
      case 'queued':
        toast.message(event.message, options)
        break
      case 'running':
        toast.loading(event.message, options)
        break
      case 'completed':
        toast.success(event.message, options)
        break
      case 'failed':
        toast.error(event.message, options)
        break
      case 'offline':
        toast.warning(event.message, options)
        break
    }
  }, [])

  const publish = useCallback((input: FeedbackEventInput): string => {
    const event = createFeedbackEvent(input)
    replaceEvents([event, ...eventsRef.current])
    showToast(event)
    return event.id
  }, [replaceEvents, showToast])

  const update = useCallback((id: string, patch: FeedbackEventUpdate) => {
    const nextEvents = updateFeedbackEvent(eventsRef.current, id, patch)
    const updated = nextEvents.find((event) => event.id === id)
    if (!updated) throw new Error(`Feedback event "${id}" does not exist.`)

    replaceEvents([updated, ...nextEvents.filter((event) => event.id !== id)])
    showToast(updated)
  }, [replaceEvents, showToast])

  const dismiss = useCallback((id: string) => {
    replaceEvents(eventsRef.current.filter((event) => event.id !== id))
    toast.dismiss(id)
  }, [replaceEvents])

  const retry = useCallback(async (id: string) => {
    const event = eventsRef.current.find((candidate) => candidate.id === id)
    if (!event) throw new Error(`Feedback event "${id}" does not exist.`)
    if (!event.retry) return false

    update(id, { status: 'running', message: `Retrying: ${event.message}` })
    try {
      const succeeded = await event.retry()
      if (!succeeded) {
        update(id, { status: 'failed', message: 'Retry did not complete. Please try again.' })
        return false
      }
      update(id, { status: 'completed', message: 'Retry completed.' })
      return true
    } catch (error) {
      update(id, { status: 'failed', message: feedbackErrorMessage(error) })
      return false
    }
  }, [update])

  retryRef.current = retry

  const value = useMemo<FeedbackContextValue>(() => ({
    events,
    publish,
    update,
    dismiss,
    retry,
  }), [dismiss, events, publish, retry, update])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className={styles.announcer} role="status" aria-label="Feedback announcements">
        {announcement(events[0])}
      </div>
      <Toaster closeButton position="bottom-right" theme="light" visibleToasts={3} />
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext)
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider.')
  }
  return context
}
