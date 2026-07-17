import { useEffect } from 'react'
import { useWSStore, type WSStatus } from '../stores/wsStore'
import { useAuthStore } from '../stores/authStore'

let activeConsumers = 0

/**
 * Opens a WebSocket connection on mount using the auth token,
 * and closes it on unmount.
 */
export function useWS(): { status: WSStatus } {
  const status = useWSStore((s) => s.status)
  const connect = useWSStore((s) => s.connect)
  const disconnect = useWSStore((s) => s.disconnect)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!token) return
    activeConsumers += 1
    if (activeConsumers === 1) connect(token)
    return () => {
      activeConsumers -= 1
      if (activeConsumers === 0) disconnect()
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return { status }
}
