import type { ThrottlePresets, ThrottleSettings } from './settings.js'

export type { ThrottlePresets, ThrottleSettings } from './settings.js'

/**
 * Stamped on every message, so nothing else the two windows say to each other is taken for ours —
 * postMessage is a shared pipe, with dev servers, extensions and integrations all talking through
 * it. Named for the trade rather than for one game: a panel that knows this word drives any of them.
 */
export const THROTTLE_CHANNEL = 'game:throttle'

/**
 * The version of the conversation, not of the package. A game sends it and a panel checks it, so a
 * mismatch is something either side can say out loud instead of quietly drawing the wrong thing.
 * Raised only by a change that would break an older panel — a field renamed, a meaning changed, a
 * kind of message dropped. Adding an optional field leaves it where it is.
 */
export const THROTTLE_VERSION = 1

/** Everything a panel needs to draw itself, sent by the one side that knows: the game */
export interface ThrottleOffer {
  version: number
  settings: ThrottleSettings
  /** What asking for nothing looks like, so a panel keeps no copy of the game's own zeroes */
  off: ThrottleSettings
  presets: ThrottlePresets
}

/** How the game is faring under it all */
export interface ThrottleStats {
  /** The thread the interface lives on, counted by the loop that burdens it */
  page: { fps: number; worstMs: number }
  /** What a game says of its own drawing, where it says anything */
  render: { fps: number; cpuMs: number } | null
  /** What the line has done to it since the page opened */
  line: { requests: number; dropped: number; events: number; lastTripMs: number }
}

export type ThrottleToPanel =
  | ({ channel: typeof THROTTLE_CHANNEL; kind: 'ready' } & ThrottleOffer)
  | ({ channel: typeof THROTTLE_CHANNEL; kind: 'stats' } & ThrottleStats)

export type ThrottleFromPanel =
  | { channel: typeof THROTTLE_CHANNEL; kind: 'hello' }
  | { channel: typeof THROTTLE_CHANNEL; kind: 'set'; settings: ThrottleSettings }

export type ThrottleMessage = ThrottleToPanel | ThrottleFromPanel

/** Whether this is ours at all. What kind of ours it is, the caller reads off `kind` */
export const isThrottleMessage = (data: unknown): data is ThrottleMessage =>
  typeof data === 'object' && data !== null && (data as ThrottleMessage).channel === THROTTLE_CHANNEL

/**
 * Which preset a part of the settings stands at, and nothing where a knob has been turned by hand.
 * Compared by value, presets being plain numbers either way
 */
export const findPreset = <Values>(presets: { name: string; values: Values }[], current: Values) =>
  presets.find((preset) => JSON.stringify(preset.values) === JSON.stringify(current))
