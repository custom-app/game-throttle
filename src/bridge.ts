import { pageFramesStore } from './page.js'
import {
  isThrottleMessage,
  THROTTLE_CHANNEL,
  THROTTLE_VERSION,
  type ThrottleStats,
  type ThrottleToPanel,
} from './protocol.js'
import { THROTTLE_OFF, THROTTLE_PRESETS } from './settings.js'
import { getThrottleSettings, setThrottleSettings, tallyStore } from './state.js'

/** How often the game says how it is faring, which is as often as it counts it */
const STATS_MS = 500

export interface BridgeOptions {
  /** What the game says of its own drawing, asked for every time the stats go out */
  getRenderFrames?: () => ThrottleStats['render']
}

/**
 * The game's half of a panel that lives in whatever window opened it. The game speaks first — a
 * panel already waiting hears that the settings are supported and lets its button be pressed — and
 * answers again when asked, for a panel that came up too late to hear the first word. The first word
 * says no hello has been heard, since one sent before this was listening is lost for good.
 *
 * Nothing else is sent until the panel says hello: a game is embedded by casinos too, and none of
 * them asked to be told how its frames are going.
 */
export const connectPanel = ({ getRenderFrames }: BridgeOptions = {}) => {
  const parent = window.parent

  if (parent === window) return () => undefined

  let panelOrigin: string | null = null

  const offer = (): ThrottleToPanel => ({
    channel: THROTTLE_CHANNEL,
    kind: 'ready',
    isGreeted: panelOrigin !== null,
    version: THROTTLE_VERSION,
    settings: getThrottleSettings(),
    off: THROTTLE_OFF,
    presets: THROTTLE_PRESETS,
  })

  const onMessage = ({ data, source, origin }: MessageEvent<unknown>) => {
    if (source !== parent || !isThrottleMessage(data)) return

    if (data.kind === 'hello') {
      panelOrigin = origin
      parent.postMessage(offer(), origin)

      return
    }

    if (data.kind === 'set') {
      setThrottleSettings(data.settings)
    }
  }

  window.addEventListener('message', onMessage)

  // the first word carries nothing worth hiding — that the game takes these settings, and where
  // they stand — and the window it goes to cannot be read from in here to be named
  parent.postMessage(offer(), '*')

  const stats = setInterval(() => {
    if (!panelOrigin) return

    parent.postMessage(
      {
        channel: THROTTLE_CHANNEL,
        kind: 'stats',
        page: pageFramesStore.get(),
        render: getRenderFrames?.() ?? null,
        line: tallyStore.get(),
      } satisfies ThrottleToPanel,
      panelOrigin,
    )
  }, STATS_MS)

  return () => {
    window.removeEventListener('message', onMessage)
    clearInterval(stats)
  }
}
