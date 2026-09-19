# @custom-app/game-throttle

Makes a browser game act as if the machine under it were poorer, and lets whoever embedded the game
turn those knobs from outside.

Meant for testers: instead of opening DevTools, picking a CPU rate and a network profile, and
finding there is no GPU option at all, they press one button in the admin and drag sliders.

[Читать по-русски](./README.ru.md)

## What this is not

It is not throttling. A page cannot slow down the machine it runs on: the browser's own tools live
behind the debugging protocol, and **nothing anywhere throttles a GPU** — that process is shared
with the browser's own interface, which is why DevTools has never offered it. So the game burdens
itself instead.

| Knob | What actually happens |
| --- | --- |
| CPU slowdown | The work of each frame is measured, and `(N − 1) ×` of it burnt in a busy loop. An idle frame stays free. |
| GPU fills | A canvas of our own shades a sheet the size of the frame, over and over, into a texture nobody sees. |
| Resolution | Handed to the game, which draws at more or fewer pixels. |
| Network | Requests and stream events are held back, dragged out by their own size, and a share of them lost. |

The limits are honest: CPU slowdown stretches only what happens inside a frame, not parsing,
garbage collection or layout outside it. GPU fills cost what they cost on **this** card, so one
setting bites differently on an M1 and on an office laptop.

## Guide

### Step 1. Install

```bash
npm i git+ssh://git@github.com/custom-app/game-throttle.git#v0.1.0
```

```bash
yarn add git+ssh://git@github.com/custom-app/game-throttle.git#v0.1.0
```

Built on install: `prepare` for npm, `prepack` for yarn.

Two entry points:

- `@custom-app/game-throttle` — everything a game needs.
- `@custom-app/game-throttle/protocol` — the messages alone, for the panel at the other end. No DOM,
  no side effects, nothing that burdens anything.

The consumer needs `moduleResolution: "bundler"` or `"node16"`, subpaths being what they are.

### Step 2. Start it in the game

`startThrottle` is called **once on the main thread** — where the game's interface lives (React,
Svelte, plain code) — after whatever it draws with has been made, since the settings will have to
reach the renderer.

A React example: a component that draws nothing and only starts it.

```tsx
// src/app/GameThrottle.tsx — a React example
import { useEffect } from 'react'

export function GameThrottle() {
  useEffect(() => {
    let stop: (() => void) | undefined
    let isGone = false

    // imported dynamically: a plain import is kept in the production build by the bundler,
    // even where the flag never lets the branch run
    import('@custom-app/game-throttle').then(({ startThrottle }) => {
      if (isGone) return

      stop = startThrottle()
    })

    return () => {
      isGone = true
      stop?.()
    }
  }, [])

  return null
}
```

```tsx
// src/app/App.tsx
export function App() {
  return (
    <>
      {/* ... */}
      {import.meta.env.DEV_MODE && <GameThrottle />}
    </>
  )
}
```

The flag is whatever the project uses to tell its own builds from the public one.

That much is already enough: the library holds the page's thread, loads the card, counts frames and
answers the panel. Render slowdown and resolution still do nothing — the game applies those itself,
which is the next step.

### Step 3. Wire the game's renderer

This is about whatever the game draws with — a Pixi scene in a worker of its own, say. The library
cannot reach it: only the game knows where its frame begins and ends.

The scene first:

```ts
// scene.ts — lives in a worker, draws the game
import { burnSlowdown } from '@custom-app/game-throttle'
import { Application, UPDATE_PRIORITY } from 'pixi.js'

/** How often the scene says how it is coping */
const REPORT_MS = 500

export class Scene {
  // the last thing the panel asked for; 1 means leave it alone
  private slowdown = 1

  private startedAt = 0
  private counted = { frames: 0, cpuMs: 0, since: 0 }

  /** What the panel shows: the scene's frames and its own time in each */
  frames = { fps: 0, cpuMs: 0 }

  setSlowdown(slowdown: number) {
    this.slowdown = slowdown
  }

  /** The frame opens: the clock is marked and the scene moved on */
  private tick() {
    this.startedAt = performance.now()

    // ...
  }

  /** The frame closes, the drawing handed over: now it can be measured and made up for */
  private afterRender() {
    const workMs = performance.now() - this.startedAt

    burnSlowdown(workMs, this.slowdown)

    this.counted.frames += 1
    this.counted.cpuMs += performance.now() - this.startedAt
    this.counted.since ||= performance.now()

    const elapsed = performance.now() - this.counted.since

    if (elapsed < REPORT_MS) return

    this.frames = {
      fps: Math.round((this.counted.frames * 1000) / elapsed),
      cpuMs: Number((this.counted.cpuMs / this.counted.frames).toFixed(1)),
    }

    this.counted = { frames: 0, cpuMs: 0, since: performance.now() }
  }

  start(app: Application) {
    // ...

    app.ticker.add(() => this.tick())
    // last of all, so it runs after the drawing
    app.ticker.add(() => this.afterRender(), undefined, UPDATE_PRIORITY.UTILITY)
  }
}
```

`cpuMs` is measured **with the burn in it** — that is what the frame really costs, and what the
panel should show. `burnSlowdown` works off the plain work, without it.

Then the main thread (React, Svelte, plain code), which takes the settings and passes them on.
The same component as in step 2, with two fields and a worker to talk to:

```tsx
// src/app/GameThrottle.tsx — a React example
import { useEffect, useRef } from 'react'

export function GameThrottle({ worker }: { worker: Worker }) {
  // the scene's last word about itself, sent every half a second
  const sceneFrames = useRef({ fps: 0, cpuMs: 0 })

  useEffect(() => {
    const onMessage = ({ data }: MessageEvent) => {
      if (data.kind === 'frames') sceneFrames.current = data.frames
    }

    worker.addEventListener('message', onMessage)

    return () => worker.removeEventListener('message', onMessage)
  }, [worker])

  useEffect(() => {
    let stop: (() => void) | undefined
    let isGone = false

    import('@custom-app/game-throttle').then(({ startThrottle }) => {
      if (isGone) return

      stop = startThrottle({
        onSettings: (settings) => {
          // how many times over the scene is to spend its frame
          worker.postMessage({ kind: 'throttle', slowdown: settings.cpu.renderSlowdown })

          // the resolution itself, or the screen's own where none is asked for
          worker.postMessage({ kind: 'viewport', resolution: settings.resolution ?? devicePixelRatio })
        },

        getRenderFrames: () => sceneFrames.current,
      })
    })

    return () => {
      isGone = true
      stop?.()
    }
  }, [worker])

  return null
}
```

A game that draws on the page itself can skip this step: the page's thread is held by the library.

### Step 4. The network

Nothing is intercepted on its own, and which of the two ways to reach for depends on one thing:
whether the library is kept behind a flag, as step 2 has it.

#### Behind a flag: take the globals

A game that hides the library behind a flag cannot mention it anywhere else. The client that builds
its requests is ordinary code, shipped to everybody, and a plain import there would carry the whole
library into the public build, flag or no flag.

So the globals are taken instead, from the same dev-only place that called `startThrottle`:

```ts
import { installThrottledFetch, installThrottledEventSource } from '@custom-app/game-throttle'

const undo = [installThrottledFetch(), installThrottledEventSource()]

// put it all back
undo.forEach((restore) => restore())
```

An installer takes the **current** value of the global and wraps that, so a wrapper another library
put there before is kept: we stand on top of it rather than in place of it. Nothing else in the game
has to change — its own `fetch` calls and `new EventSource(…)` go through these as they are.

This is also the only way to reach requests leaving code you do not own: a payment SDK, analytics,
an asset loader inside an engine.

#### Always in the build: wrap it yourself

Where the library ships with the game anyway — a harness, a build of its own, a transport module
that is dev-only already — the wrapper can be handed straight to whatever makes the requests:

```ts
import { createThrottledFetch } from '@custom-app/game-throttle'

// with no argument it wraps the global fetch
const api = new Api({ customFetch: createThrottledFetch() })
```

Where the game **already** wraps `fetch` — say a `fetchWithTokens` that adds an authorisation header
— hand that in rather than throw it away. The chain then reads: our delay outside, the token inside,
the real `fetch` at the end.

```ts
const api = new Api({ customFetch: createThrottledFetch(fetchWithTokens) })
```

A stream works the same way. `createThrottledEventSource()` returns a **class**, extending the one
it was given — the browser's own by default, a polyfill as readily:

```ts
import { createThrottledEventSource } from '@custom-app/game-throttle'

const ThrottledEventSource = createThrottledEventSource()
const stream = new ThrottledEventSource('/api/events/subscribe?session_id=123')

stream.onmessage = (event) => handle(JSON.parse(event.data))
```

#### What the network does not cover

The loading of the game itself: the bundle, images, sprites, fonts, spine animations. The browser
and the workers fetch all of it past these wrappers, usually before any of this is even running.
The delays show on what the game asks for while it plays: bets, history, the stream of events.

#### Where the transport is the game's own

Where a stream is opened inside a subscribe function of its own — with reconnects, a silence timer
and the rest — there is nowhere to put the wrapping class. The line's own arithmetic is exported for
exactly that:

```ts
import { isLost, nextTripMs } from '@custom-app/game-throttle'

const source = new EventSource(url)

source.onmessage = (message) => {
  // a lost message is one that never arrived, so the game's silence timer fires as it would on a
  // line gone quiet — which is why it is reset only after this check
  if (isLost()) return

  // ...

  const event = JSON.parse(message.data)
  const trip = nextTripMs()

  if (trip <= 0) {
    onEvent(event)

    return
  }

  setTimeout(() => onEvent(event), trip)
}
```

### Step 5. The panel

The panel is whatever window the game is embedded in. It knows nothing in advance: the settings and
the presets both come from the game.

The panel's side of the conversation is `connectGame`: it takes the iframe element and two callbacks,
and needs no framework. The greeting is its business too — whichever of the two windows comes up
first, the other is heard, so a panel never has to time it.

The examples are React.

```tsx
// a React example
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  connectGame,
  type GameConnection,
  type ThrottleOffer,
  type ThrottleSettings,
  type ThrottleStats,
} from '@custom-app/game-throttle/protocol'

export function GameFrame({ gameUrl }: { gameUrl: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const connectionRef = useRef<GameConnection>(null)

  // empty until the game has spoken, and a game that has not spoken takes no settings
  const [offer, setOffer] = useState<ThrottleOffer | null>(null)
  const [stats, setStats] = useState<ThrottleStats | null>(null)

  useEffect(() => {
    const frame = frameRef.current

    if (!frame) return

    const connection = connectGame({ frame, onOffer: setOffer, onStats: setStats })

    connectionRef.current = connection

    return () => {
      connectionRef.current = null
      connection.stop()
    }
  }, [])

  // a reloaded game forgets the panel, and may no longer take the settings at all
  const greet = () => {
    setOffer(null)
    setStats(null)
    connectionRef.current?.hello()
  }

  // the whole of the settings goes over, and is shown here at once
  const apply = (settings: ThrottleSettings) => {
    setOffer((current) => (current ? { ...current, settings } : current))
    connectionRef.current?.set(settings)
  }

  const settings = offer?.settings

  return (
    <>
      <iframe ref={frameRef} src={gameUrl} onLoad={greet} />

      {offer && settings && (
        <form onSubmit={(event) => event.preventDefault()}>
          <p>
            page: {stats ? `${stats.page.fps} fps, worst frame ${stats.page.worstMs} ms` : '—'}
            <br />
            render: {stats?.render ? `${stats.render.fps} fps, ${stats.render.cpuMs} ms a frame` : '—'}
            <br />
            line:{' '}
            {stats
              ? `${stats.line.requests} calls, ${stats.line.dropped} dropped, ${stats.line.events} held, last +${stats.line.lastTripMs} ms`
              : '—'}
          </p>

          <Preset
            label="CPU"
            names={offer.presets.cpu.map(({ name }) => name)}
            onPick={(name) => {
              const preset = offer.presets.cpu.find((item) => item.name === name)

              if (preset) apply({ ...settings, cpu: preset.cpu })
            }}
          />
          <Preset
            label="GPU"
            names={offer.presets.gpu.map(({ name }) => name)}
            onPick={(name) => {
              const preset = offer.presets.gpu.find((item) => item.name === name)

              if (preset) apply({ ...settings, gpu: preset.gpu })
            }}
          />
          <Preset
            label="Network"
            names={offer.presets.network.map(({ name }) => name)}
            onPick={(name) => {
              const preset = offer.presets.network.find((item) => item.name === name)

              if (preset) apply({ ...settings, network: preset.network })
            }}
          />

          <Knob
            label="Page slowdown"
            value={settings.cpu.pageSlowdown}
            min={1}
            max={10}
            step={0.5}
            onChange={(pageSlowdown) => apply({ ...settings, cpu: { ...settings.cpu, pageSlowdown } })}
          />
          <Knob
            label="Render slowdown"
            value={settings.cpu.renderSlowdown}
            min={1}
            max={10}
            step={0.5}
            onChange={(renderSlowdown) => apply({ ...settings, cpu: { ...settings.cpu, renderSlowdown } })}
          />
          <Knob
            label="GPU fills"
            value={settings.gpu.fills}
            min={0}
            max={600}
            step={10}
            onChange={(fills) => apply({ ...settings, gpu: { ...settings.gpu, fills } })}
          />
          <Knob
            label="Resolution"
            // null is the screen's own, and the frame shares the screen with the panel
            value={settings.resolution ?? devicePixelRatio}
            min={0.25}
            max={3}
            step={0.25}
            onChange={(resolution) => apply({ ...settings, resolution })}
          />
          <Knob
            label="Latency, ms"
            value={settings.network.latencyMs}
            min={0}
            max={3000}
            step={50}
            onChange={(latencyMs) => apply({ ...settings, network: { ...settings.network, latencyMs } })}
          />
          <Knob
            label="Jitter, ms"
            value={settings.network.jitterMs}
            min={0}
            max={1000}
            step={50}
            onChange={(jitterMs) => apply({ ...settings, network: { ...settings.network, jitterMs } })}
          />
          <Knob
            label="Lost, %"
            value={Math.round(settings.network.lossRate * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(share) => apply({ ...settings, network: { ...settings.network, lossRate: share / 100 } })}
          />
          <Knob
            label="Bandwidth, kbps"
            value={settings.network.kbps}
            min={0}
            max={5000}
            step={100}
            onChange={(kbps) => apply({ ...settings, network: { ...settings.network, kbps } })}
          />

          <button
            type="button"
            onClick={() => apply(offer.off)}
          >
            Reset
          </button>
        </form>
      )}
    </>
  )
}

function Preset({ label, names, onPick }: { label: string; names: string[]; onPick: (name: string) => void }) {
  return (
    <label>
      {label}
      <select onChange={(event) => onPick(event.target.value)}>
        {names.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </label>
  )
}

function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label>
      {label}: {value}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
```

Keep whatever opens the panel disabled while `offer` is empty.

The conversation in full:

| Message | Sent by | When | What it carries |
| --- | --- | --- | --- |
| `ready` | game | at start, and in answer to `hello` | the version, the settings, what "off" looks like, the presets, and `isGreeted` — whether a hello has reached the game yet |
| `stats` | game | twice a second, once a panel has said hello | the page's frames, the game's frames, the line's tally |
| `hello` | panel | on connecting, on every load of the frame, and in answer to a `ready` with `isGreeted: false` | nothing |
| `set` | panel | on every change | the whole of the settings |

## Presets

Come from the game in `ready`, so the numbers live in one place.

- **CPU** — `No load`, `Slower device 2x / 4x / 6x`.
- **GPU** — `No load`, `Light`, `Heavy`, `Very heavy`, guessed at a middling laptop.
- **Network** — `Fast 4G`, `Slow 4G`, `3G`, each with an `(unstable)` twin that adds a wander and
  loses a tenth of what is sent, plus `Offline`. The steady numbers are the browser's own.

## Development

```bash
npm run build     # tsc into dist: ESM and .d.ts
npm run lint
npm run format
```

No runtime dependencies, and it should stay that way: games on different stacks install this, and
none of them should have to carry somebody else's store or framework because of it.

### Two versions, easily confused

**The package version** (`package.json`) and its tag are how consumers pin what they install. Raise
it on any change worth pulling.

**The conversation's version** (`THROTTLE_VERSION` in `src/protocol.ts`) is about a game and a panel
still understanding each other. Raise it **only** for a breaking change:

- a field of `ThrottleSettings` renamed or removed;
- the meaning of an existing field changed (`fills` coming to stand for something else, say);
- a kind of message dropped, or a field of one made required.

Adding an **optional** field or another preset leaves it where it is: an older panel simply will not
notice the new thing.

Why it matters: games and panels are updated at different times. A month from now a stand will have
a game on an old version of this package and a panel on a new one. Without the marker that looks
like a panel quietly broken; with it, the panel can say the game speaks version 2 where it knows 1.

### Changing the protocol

`src/protocol.ts` is shared by both sides, so it is changed with both in mind. In order: change the
types, raise `THROTTLE_VERSION` if the change breaks anything, build, update the dependency in the
game and in the panel, and try them together.
