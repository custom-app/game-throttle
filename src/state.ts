import { THROTTLE_OFF, type ThrottleSettings } from './settings.js'
import { createStore } from './store.js'

/**
 * The one set of settings a page runs under. Held at module scope rather than handed about: a page
 * is one game under one load, and every part that reads them — the burning loop, the wrappers
 * around fetch and the stream — would otherwise have to be threaded the same object by hand.
 */
export const settingsStore = createStore<ThrottleSettings>(THROTTLE_OFF)

export const setThrottleSettings = (settings: ThrottleSettings) => settingsStore.set(settings)

export const getThrottleSettings = () => settingsStore.get()

export interface ThrottleTally {
  requests: number
  dropped: number
  events: number
  lastTripMs: number
}

/**
 * What the line has done since the page opened. A delay laid evenly over a stream is all but
 * invisible — the game simply lives a moment behind — so this is what tells a tester the settings
 * are live at all.
 *
 * A store like the settings, for all that it is only read when the stats go out: one kind of state
 * is easier to follow than two, and telling nobody costs nothing.
 */
export const tallyStore = createStore<ThrottleTally>({ requests: 0, dropped: 0, events: 0, lastTripMs: 0 })

const count = (what: 'requests' | 'dropped' | 'events') => {
  const tally = tallyStore.get()

  tallyStore.set({ ...tally, [what]: tally[what] + 1 })
}

export const countRequest = () => count('requests')

export const countDropped = () => count('dropped')

export const countEvent = () => count('events')

export const noteTrip = (ms: number) => tallyStore.set({ ...tallyStore.get(), lastTripMs: Math.round(ms) })
