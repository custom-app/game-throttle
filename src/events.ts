import { isLost, nextTripMs } from './line.js'
import { countEvent } from './state.js'

/**
 * A stream put through the same line: every message held back by the trip of the moment, and a
 * share of them never delivered at all.
 *
 * The real message is stopped where it arrives and a copy of it is let through later, or not at
 * all. Stopping it rather than wrapping every listener means nothing has to be known about who is
 * listening — `onmessage`, listeners added later, several at once, all are served alike. The
 * listener doing the stopping is added in the constructor, so it is always the first in line.
 *
 * A lost message is one that never arrived: the socket stays open, and the game finds out the way
 * it would on a line gone quiet, by its own silence timer. Nothing but `message` is touched — the
 * stream's own opening and errors are its business.
 *
 * Extends whatever class it is given, so a polyfilled EventSource — one that carries headers, say —
 * is wrapped as readily as the browser's own.
 */
export const createThrottledEventSource = (Inner: typeof EventSource = globalThis.EventSource): typeof EventSource => {
  const copies = new WeakSet<MessageEvent>()

  return class ThrottledEventSource extends Inner {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init)

      this.addEventListener('message', (event) => {
        const message = event as MessageEvent

        // our own copy, on its way to everybody else
        if (copies.has(message)) return

        event.stopImmediatePropagation()

        if (isLost()) return

        const copy = new MessageEvent('message', {
          data: message.data,
          lastEventId: message.lastEventId,
          origin: message.origin,
        })

        copies.add(copy)

        const trip = nextTripMs()

        if (trip <= 0) {
          this.dispatchEvent(copy)

          return
        }

        countEvent()
        setTimeout(() => this.dispatchEvent(copy), trip)
      })
    }
  }
}

/**
 * For games that open the stream somewhere out of reach. Takes whatever `EventSource` is there at
 * that moment, so a polyfill installed before this one is kept, and hands back the way to undo it.
 */
export const installThrottledEventSource = () => {
  const before = globalThis.EventSource

  globalThis.EventSource = createThrottledEventSource(before)

  return () => {
    globalThis.EventSource = before
  }
}
