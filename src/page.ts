import { burnSlowdown } from './burn.js'
import { getThrottleSettings } from './state.js'
import { createStore } from './store.js'

/** How often the count is published, often enough to watch and rarely enough to read */
const REPORT_MS = 500

export interface PageFrames {
  fps: number
  /**
   * The longest a frame took in the last count, which is where jank shows: the average sits at the
   * screen's own pace whatever the page is doing, and says nothing.
   */
  worstMs: number
}

export const pageFramesStore = createStore<PageFrames>({ fps: 0, worstMs: 0 })

/**
 * Holds the page to the pace of a slower machine, and counts how it fares while it is at it.
 *
 * The work of each frame is measured and the rest of it burnt, so a frame with nothing to do costs
 * nothing — which is what a slower processor would have done, and what the browser's own throttling
 * does. Burning a set slice of every frame instead would tax the idle ones just as hard.
 *
 * The measure comes from a message sent down a channel to ourselves: such a message is delivered as
 * a task, and tasks run after the browser has finished styling, laying out and painting the frame.
 * So what lies between the mark and the message is the whole of the frame's work — this loop, the
 * framework, layout, paint. Its own burn is taken back out, or the burn would feed on itself.
 */
export const startPageLoad = () => {
  const channel = new MessageChannel()
  const frame = { startedAt: 0, burntMs: 0, workMs: 0 }

  let counted = { frames: 0, worstMs: 0, since: 0, at: 0 }

  channel.port1.onmessage = () => {
    frame.workMs = Math.max(0, performance.now() - frame.startedAt - frame.burntMs)
  }

  let request = requestAnimationFrame(function burn(now) {
    counted.frames += 1
    counted.worstMs = Math.max(counted.worstMs, counted.at ? now - counted.at : 0)
    counted.since ||= now
    counted.at = now

    const elapsed = now - counted.since

    if (elapsed >= REPORT_MS) {
      pageFramesStore.set({
        fps: Math.round((counted.frames * 1000) / elapsed),
        worstMs: Math.round(counted.worstMs),
      })

      counted = { frames: 0, worstMs: 0, since: now, at: now }
    }

    const startedAt = performance.now()

    frame.startedAt = startedAt
    burnSlowdown(frame.workMs, getThrottleSettings().cpu.pageSlowdown)
    frame.burntMs = performance.now() - startedAt

    // posted after the burn, so the message lands beyond this frame's own rendering
    channel.port2.postMessage(null)

    request = requestAnimationFrame(burn)
  })

  return () => {
    cancelAnimationFrame(request)
    channel.port1.close()
    channel.port2.close()
  }
}
