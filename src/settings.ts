/**
 * What a game is asked to put itself through. None of it slows the machine down — a page is given
 * no way to do that — so the game burdens itself instead: it spends every frame's work over again,
 * shades sheets nobody sees, and holds its own requests back.
 */
export interface ThrottleSettings {
  cpu: {
    /**
     * How many times over a thread is made to spend what it spent. The work of each frame is
     * measured and the rest of it burnt, so an idle frame stays free the way a slower machine's
     * would. 1 leaves the thread alone.
     *
     * `page` is the thread the interface lives on; `render` the one a game draws from, where it
     * draws in a worker of its own. Games that draw on the page itself can ignore the second.
     */
    pageSlowdown: number
    renderSlowdown: number
  }
  gpu: {
    /** Sheets the size of the frame, shaded into a texture nobody sees, every frame */
    fills: number
  }
  /** What a game draws at against what the screen asks for. Not a burden of its own, a setting */
  resolution: number
  network: {
    /** Added to the round trip of every request, and to every event of a stream */
    latencyMs: number
    /** How far that wanders either way, so nothing arrives on a beat */
    jitterMs: number
    /** The share of requests and events lost on the way, 0 to 1 */
    lossRate: number
    /** A ceiling on throughput, holding an answer back by however long its own size takes. 0 is none */
    kbps: number
  }
}

/** Every knob at rest: the game left to run as the machine allows */
export const THROTTLE_OFF: ThrottleSettings = {
  cpu: { pageSlowdown: 1, renderSlowdown: 1 },
  gpu: { fills: 0 },
  resolution: 1,
  network: { latencyMs: 0, jitterMs: 0, lossRate: 0, kbps: 0 },
}

export interface ThrottleCpuPreset {
  name: string
  cpu: ThrottleSettings['cpu']
}

/** The browser's own language for this, and the same arithmetic: the work of a frame, N times over */
export const CPU_PRESETS: ThrottleCpuPreset[] = [
  { name: 'No load', cpu: { pageSlowdown: 1, renderSlowdown: 1 } },
  { name: 'Slower device 2x', cpu: { pageSlowdown: 2, renderSlowdown: 2 } },
  { name: 'Slower device 4x', cpu: { pageSlowdown: 4, renderSlowdown: 4 } },
  { name: 'Slower device 6x', cpu: { pageSlowdown: 6, renderSlowdown: 6 } },
]

export interface ThrottleGpuPreset {
  name: string
  gpu: ThrottleSettings['gpu']
}

/**
 * A guess at a middling laptop, and the further a card stands from one the less it means: cards
 * differ by tens of times, and only measuring this one would say what these numbers cost it
 */
export const GPU_PRESETS: ThrottleGpuPreset[] = [
  { name: 'No load', gpu: { fills: 0 } },
  { name: 'Light', gpu: { fills: 100 } },
  { name: 'Heavy', gpu: { fills: 250 } },
  { name: 'Very heavy', gpu: { fills: 400 } },
]

export interface ThrottleNetworkPreset {
  name: string
  network: ThrottleSettings['network']
}

/** A line to be on. The steady ones carry the browser's own numbers; the unstable ones are ours */
const line = (kbps: number, latencyMs: number, isUnstable = false): ThrottleSettings['network'] => ({
  kbps,
  latencyMs,
  jitterMs: isUnstable ? Math.max(100, latencyMs * 2) : 0,
  lossRate: isUnstable ? 0.1 : 0,
})

export const NETWORK_PRESETS: ThrottleNetworkPreset[] = [
  { name: 'No limits', network: line(0, 0) },
  { name: 'Fast 4G', network: line(9000, 40) },
  { name: 'Fast 4G (unstable)', network: line(9000, 40, true) },
  { name: 'Slow 4G', network: line(1600, 150) },
  { name: 'Slow 4G (unstable)', network: line(1600, 150, true) },
  { name: '3G', network: line(400, 400) },
  { name: '3G (unstable)', network: line(400, 400, true) },
  { name: 'Offline', network: { ...line(0, 0), lossRate: 1 } },
]

export interface ThrottlePresets {
  cpu: ThrottleCpuPreset[]
  gpu: ThrottleGpuPreset[]
  network: ThrottleNetworkPreset[]
}

export const THROTTLE_PRESETS: ThrottlePresets = {
  cpu: CPU_PRESETS,
  gpu: GPU_PRESETS,
  network: NETWORK_PRESETS,
}
