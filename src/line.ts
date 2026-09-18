import { countDropped, getThrottleSettings, noteTrip } from './state.js'

/**
 * A trip of its own every time: the wander is drawn anew, so nothing arrives on a beat.
 * Exported for games that hook their own transport and want the line's arithmetic without its
 * wrappers — a stream read by hand, a socket, a worker of their own.
 */
export const nextTripMs = () => {
  const { latencyMs, jitterMs } = getThrottleSettings().network
  const trip = Math.max(0, latencyMs + (Math.random() * 2 - 1) * jitterMs)

  noteTrip(trip)

  return trip
}

/** Whether this one is lost on the way, which a line does without telling anybody */
export const isLost = () => {
  const { lossRate } = getThrottleSettings().network
  const lost = lossRate > 0 && Math.random() < lossRate

  if (lost) countDropped()

  return lost
}

/** What a body of this size costs on a line of this width, in milliseconds */
export const drainMs = (bytes: number) => {
  const { kbps } = getThrottleSettings().network

  return kbps > 0 && bytes > 0 ? (bytes * 8) / kbps : 0
}

export const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined)
