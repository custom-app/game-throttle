/**
 * Spends the milliseconds asked of it and nothing else. A slower processor is a thing a page cannot
 * ask for, so the time one would have taken is taken here instead — on whichever thread calls this.
 */
export const burnMs = (ms: number) => {
  if (ms <= 0) return

  const until = performance.now() + ms

  // the clock is read every turn, which is what keeps the loop from being optimised away
  while (performance.now() < until) {
    // burning time is the whole of the work
  }
}

/** However badly a frame's own cost is read, nothing is ever held longer than this */
export const MOST_BURN_MS = 200

/**
 * The rest of the time a machine that many times slower would have spent on the same frame.
 * Measured rather than set, so a frame with nothing to do costs nothing, as it would there.
 */
export const burnSlowdown = (workMs: number, slowdown: number) => {
  burnMs(Math.min(MOST_BURN_MS, Math.max(0, (slowdown - 1) * workMs)))
}
