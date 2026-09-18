import { connectPanel } from './bridge.js'
import { startGpuLoad } from './gpu.js'
import { startPageLoad } from './page.js'
import type { ThrottleStats } from './protocol.js'
import type { ThrottleSettings } from './settings.js'
import { settingsStore } from './state.js'

export interface StartThrottleOptions {
  /**
   * What the game does with settings it alone can apply: the pace of its own render thread, the
   * pixels it draws at. Called with everything, whenever any of it changes.
   */
  onSettings?: (settings: ThrottleSettings) => void
  /** What the game says of its own drawing, if it counts it. Shown beside what this library counts */
  getRenderFrames?: () => ThrottleStats['render']
  /** Left on unless a game would rather hold its page and its card itself */
  load?: {
    page?: boolean
    gpu?: boolean
  }
}

/**
 * Puts the game under a tester's hand: the load is held, the panel is answered, and whatever only
 * the game can do with the settings is handed back to it.
 *
 * Returns the way to stop, which also takes the load off. Meant to be called once, behind whatever
 * flag keeps the tester's tools out of a public build — and behind a dynamic import with it, or
 * the bundler will keep this in the build whether the flag lets it run or not.
 */
export const startThrottle = ({ onSettings, getRenderFrames, load }: StartThrottleOptions = {}) => {
  const stops = [
    load?.page === false ? undefined : startPageLoad(),
    load?.gpu === false ? undefined : startGpuLoad(),
    connectPanel({ getRenderFrames }),
    onSettings && settingsStore.subscribe(onSettings),
  ]

  onSettings?.(settingsStore.get())

  return () => stops.forEach((stop) => stop?.())
}

export { burnMs, burnSlowdown, MOST_BURN_MS } from './burn.js'
export { connectPanel, type BridgeOptions } from './bridge.js'
export { createThrottledEventSource, installThrottledEventSource } from './events.js'
export { createThrottledFetch, installThrottledFetch } from './fetch.js'
export { startGpuLoad } from './gpu.js'
export { drainMs, isLost, nextTripMs } from './line.js'
export { pageFramesStore, startPageLoad, type PageFrames } from './page.js'
export * from './protocol.js'
export * from './settings.js'
export { getThrottleSettings, setThrottleSettings, settingsStore, tallyStore, type ThrottleTally } from './state.js'
export { createStore, type Store } from './store.js'
