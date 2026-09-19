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
  | ({
      channel: typeof THROTTLE_CHANNEL
      kind: 'ready'
      /**
       * Whether a panel's hello has reached the game yet. One that went out before the game was
       * listening is lost, and this is how the panel learns to say it again
       */
      isGreeted: boolean
    } & ThrottleOffer)
  | ({ channel: typeof THROTTLE_CHANNEL; kind: 'stats' } & ThrottleStats)

export type ThrottleFromPanel =
  | { channel: typeof THROTTLE_CHANNEL; kind: 'hello' }
  | { channel: typeof THROTTLE_CHANNEL; kind: 'set'; settings: ThrottleSettings }

export type ThrottleMessage = ThrottleToPanel | ThrottleFromPanel

/** Whether this is ours at all. What kind of ours it is, the caller reads off `kind` */
export const isThrottleMessage = (data: unknown): data is ThrottleMessage =>
  typeof data === 'object' && data !== null && (data as ThrottleMessage).channel === THROTTLE_CHANNEL

export interface GameConnectionOptions {
  /** Its window is looked up on every message, a reload of the frame bringing a new one */
  frame: HTMLIFrameElement
  /** At the game's start, and in answer to every hello */
  onOffer: (offer: ThrottleOffer) => void
  onStats: (stats: ThrottleStats) => void
}

export interface GameConnection {
  /** Worth sending on every load of the frame, so a game already up is heard from again */
  hello: () => void
  set: (settings: ThrottleSettings) => void
  stop: () => void
}

/**
 * The panel's half of the conversation. Either side may come up first: a game that spoke before the
 * panel was listening hears the hello said here at once, and a hello that went out before the game
 * was listening is said again when the game announces it never got one.
 */
export const connectGame = ({ frame, onOffer, onStats }: GameConnectionOptions): GameConnection => {
  // unknown until the game speaks, and a hello carries nothing worth keeping from anyone
  let gameOrigin = '*'

  const post = (message: ThrottleFromPanel) => frame.contentWindow?.postMessage(message, gameOrigin)

  const hello = () => post({ channel: THROTTLE_CHANNEL, kind: 'hello' })

  const onMessage = ({ data, source, origin }: MessageEvent<unknown>) => {
    if (source !== frame.contentWindow || !isThrottleMessage(data)) return

    if (data.kind === 'ready') {
      const { version, settings, off, presets } = data

      gameOrigin = origin
      onOffer({ version, settings, off, presets })

      // strictly false: a game older than the flag sends none, and answering each of its replies
      // with another hello would never end
      if (data.isGreeted === false) hello()

      return
    }

    if (data.kind === 'stats') {
      const { page, render, line } = data

      onStats({ page, render, line })
    }
  }

  window.addEventListener('message', onMessage)
  hello()

  return {
    hello,
    set: (settings) => post({ channel: THROTTLE_CHANNEL, kind: 'set', settings }),
    stop: () => window.removeEventListener('message', onMessage),
  }
}

/**
 * Which preset a part of the settings stands at, and nothing where a knob has been turned by hand.
 * Compared by value, presets being plain numbers either way
 */
export const findPreset = <Values>(presets: { name: string; values: Values }[], current: Values) =>
  presets.find((preset) => JSON.stringify(preset.values) === JSON.stringify(current))
