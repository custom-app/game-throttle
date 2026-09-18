import { drainMs, isLost, nextTripMs, wait } from './line.js'
import { countRequest } from './state.js'

/**
 * The same calls, put through the line a tester asked for: held on the way out and on the way back,
 * dragged out by their own size where the line is narrow, and turned down now and then.
 *
 * Wraps whatever it is given rather than reaching for the global one, so a game that already wraps
 * fetch — for tokens, retries, logging — keeps its wrapper and puts this one either side of it.
 *
 * A request is failed after the server has answered rather than before it is sent, because that is
 * the case worth testing: the bet stands, and the player is the only one who does not know it.
 */
export const createThrottledFetch = (inner: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch => {
  return async (input, init) => {
    const trip = nextTripMs()

    countRequest()

    await wait(trip / 2)

    const response = await inner(input, init)
    const length = Number(response.headers.get('content-length'))

    await wait(trip / 2 + drainMs(length))

    if (isLost()) {
      throw new TypeError('Failed to fetch')
    }

    return response
  }
}

/**
 * For games with nowhere to put a wrapper of their own. Takes whatever `fetch` is at that moment,
 * so a wrapper installed before this one is kept, and hands back the way to put it all as it was.
 */
export const installThrottledFetch = () => {
  const before = globalThis.fetch

  globalThis.fetch = createThrottledFetch(before.bind(globalThis))

  return () => {
    globalThis.fetch = before
  }
}
