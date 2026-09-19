# @custom-app/game-throttle

Заставляет браузерную игру вести себя так, будто под ней машина похуже, и позволяет крутить эти
ручки снаружи — из окна, в которое игра встроена.

Нужно тестировщикам: вместо того чтобы лезть в DevTools, выбирать там степень замедления процессора
и профиль сети и обнаруживать, что для видеокарты варианта нет вовсе, они жмут одну кнопку в админке
и двигают ползунки.

[Read in English](./README.md)

## Чем это не является

Это не троттлинг: страница не может замедлить машину, на которой работает. Средства браузера живут
за протоколом отладки, а **видеокарту не троттлит вообще ничто** — этот процесс общий с интерфейсом
самого браузера, поэтому такой опции в DevTools никогда и не было. Поэтому игра нагружает себя сама.

| Ручка | Что происходит |
| --- | --- |
| Замедление CPU | Работа кадра измеряется, и `(N − 1) ×` от неё прожигается пустым циклом. Пустой кадр остаётся бесплатным. |
| Заливки GPU | Свой канвас закрашивает лист размером с кадр, снова и снова, в текстуру, которую никто не видит. |
| Разрешение | Передаётся игре, она рисует в большем или меньшем числе пикселей. |
| Сеть | Запросы и события потока задерживаются, растягиваются по своему размеру, часть теряется. |

Границы честные: замедление CPU растягивает только то, что внутри кадра, но не разбор, сборку мусора
и вёрстку вне его. Заливки GPU стоят столько, сколько стоят на **этой** карте: одна и та же
настройка на M1 и на офисном ноутбуке ощущается по-разному.

## Инструкция

### Шаг 1. Поставить

```bash
npm i git+ssh://git@github.com/custom-app/game-throttle.git#v0.1.0
```

```bash
yarn add git+ssh://git@github.com/custom-app/game-throttle.git#v0.1.0
```

Собирается при установке: `prepare` для npm, `prepack` для yarn.

Две точки входа:

- `@custom-app/game-throttle` — всё, что нужно игре;
- `@custom-app/game-throttle/protocol` — только описания сообщений, для панели на том конце. Без
  DOM, без побочных эффектов, ничего не нагружает.

Потребителю нужен `moduleResolution: "bundler"` или `"node16"` — иначе подпуть не разрешится.

### Шаг 2. Запустить в игре

`startThrottle` вызывается **один раз на главном потоке** — там, где живёт интерфейс игры (React,
Svelte, ванильный код), — после того как создано всё, чем она рисует: из настроек надо будет
достучаться до рендера.

Пример на React — отдельный компонент, который ничего не рисует, только запускает:

```tsx
// src/app/GameThrottle.tsx — пример на React
import { useEffect } from 'react'

export function GameThrottle() {
  useEffect(() => {
    let stop: (() => void) | undefined
    let isGone = false

    // импорт динамический: обычный бандлер утащит библиотеку в прод,
    // даже если ветка под флагом там недостижима
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

Флаг — любой, каким проект отличает свои внутренние сборки от публичной.

Этого уже достаточно: библиотека нагружает поток страницы, нагружает видеокарту, считает кадры и
отвечает панели. Ручки «замедление рендера» и «разрешение» пока ничего не делают — их применяет сама
игра, об этом следующий шаг.

### Шаг 3. Подключить рендер игры

Речь про то, чем игра рисует, — например Pixi-сцену в отдельном воркере. Библиотека до неё не
дотянется: только сама игра знает, где у неё кадр начинается и заканчивается.

Сначала сцена:

```ts
// scene.ts — живёт в воркере, рисует игру
import { burnSlowdown } from '@custom-app/game-throttle'
import { Application, UPDATE_PRIORITY } from 'pixi.js'

/** Как часто сцена сообщает, как справляется */
const REPORT_MS = 500

export class Scene {
  // последнее, что пришло из панели; 1 значит «не замедлять»
  private slowdown = 1

  private startedAt = 0
  private counted = { frames: 0, cpuMs: 0, since: 0 }

  /** То, что покажет панель: кадры сцены и её собственное время на кадр */
  frames = { fps: 0, cpuMs: 0 }

  setSlowdown(slowdown: number) {
    this.slowdown = slowdown
  }

  /** Начало кадра: ставим отметку времени и двигаем сцену */
  private tick() {
    this.startedAt = performance.now()

    // ...
  }

  /** Конец кадра: отрисовка уже отдана, можно мерить и дожигать */
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
    // самым низким приоритетом, чтобы попасть после отрисовки
    app.ticker.add(() => this.afterRender(), undefined, UPDATE_PRIORITY.UTILITY)
  }
}
```

`cpuMs` меряется **вместе с прожигом** — это настоящая стоимость кадра, её и показываем.
`burnSlowdown` при этом считает от чистой работы, без него.

Теперь главный поток (React, Svelte, ванильный код) — он получает настройки и передаёт их сцене
сообщениями. Тот же компонент, что в шаге 2, только с двумя полями и ссылкой на воркер:

```tsx
// src/app/GameThrottle.tsx — пример на React
import { useEffect, useRef } from 'react'

export function GameThrottle({ worker }: { worker: Worker }) {
  // последние показания сцены: она присылает их раз в полсекунды
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
          // во сколько раз растянуть кадр сцены
          worker.postMessage({ kind: 'throttle', slowdown: settings.cpu.renderSlowdown })

          // множитель к devicePixelRatio: 1 — как просит экран, 2 — вчетверо больше пикселей
          worker.postMessage({ kind: 'viewport', resolution: devicePixelRatio * settings.resolution })
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

Если игра рисует прямо на странице, а не в воркере, шаг можно пропустить: поток страницы библиотека
замедляет сама.

### Шаг 4. Сеть

Библиотека ничего не перехватывает сама, а какой из двух способов выбрать — зависит от одного:
спрятана ли библиотека за флагом, как в шаге 2.

#### За флагом: подменять глобали

Игра, которая прячет библиотеку за флагом, не может упоминать её больше нигде. Клиент, который
собирает запросы, — обычный код, уезжающий всем, и простой импорт в нём утащит библиотеку в
публичную сборку, независимо от флага.

Поэтому вместо обёрток подменяются глобали, из того же дев-места, откуда вызван `startThrottle`:

```ts
import { installThrottledFetch, installThrottledEventSource } from '@custom-app/game-throttle'

const undo = [installThrottledFetch(), installThrottledEventSource()]

// вернуть всё как было
undo.forEach((restore) => restore())
```

Установщик берёт **текущее** значение глобали и оборачивает его. Поэтому если до нас глобальный
`fetch` уже подменила другая библиотека, её подмена сохранится — мы встанем поверх, а не вместо.
Остальной код игры при этом не меняется: её собственные вызовы `fetch` и `new EventSource(…)` пойдут
через нашу обёртку как есть.

Это же единственный способ дотянуться до запросов из чужого кода: SDK платёжки, аналитики,
загрузчика ассетов внутри движка.

#### Всегда в сборке: оборачивать самому

Если библиотека и так едет с игрой — стенд, отдельная сборка, дев-модуль транспорта, — обёртку
можно отдать прямо тому, кто делает запросы:

```ts
import { createThrottledFetch } from '@custom-app/game-throttle'

// без аргумента оборачивается глобальный fetch
const api = new Api({ customFetch: createThrottledFetch() })
```

Если у игры **уже есть** своя обёртка над `fetch` — скажем, `fetchWithTokens`, которая подставляет
заголовок авторизации, — её надо передать внутрь, а не выбрасывать. Тогда получится цепочка: наша
задержка снаружи, подстановка токена внутри, настоящий `fetch` в конце.

```ts
const api = new Api({ customFetch: createThrottledFetch(fetchWithTokens) })
```

Поток событий — так же. `createThrottledEventSource()` возвращает **класс**, наследник переданного
(по умолчанию — браузерного `EventSource`, но и полифил обернётся не хуже):

```ts
import { createThrottledEventSource } from '@custom-app/game-throttle'

const ThrottledEventSource = createThrottledEventSource()
const stream = new ThrottledEventSource('/api/events/subscribe?session_id=123')

stream.onmessage = (event) => handle(JSON.parse(event.data))
```

#### Чего сеть не покрывает

Загрузку самой игры: бандл, картинки, спрайты, шрифты, спайн-анимации. Всё это браузер и воркеры
тянут в обход наших обёрток, обычно ещё до того, как библиотека запустилась. Задержки видны на том,
что игра запрашивает во время работы: ставки, история, поток событий.

#### Если транспорт свой

Если поток открывается не просто `new EventSource(...)`, а внутри своей функции подписки — с
переподключением, сторожевым таймером и прочим, — обёртку-класс подставлять некуда. Тогда примитивы
применяются прямо в обработчике:

```ts
import { isLost, nextTripMs } from '@custom-app/game-throttle'

const source = new EventSource(url)

source.onmessage = (message) => {
  // потерянное сообщение просто не доходит: сторожевой таймер игры сработает,
  // как при настоящем обрыве, — поэтому сбрасывать его надо после этой проверки
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

### Шаг 5. Панель

Панель — то окно, куда встроена игра. Она ничего не знает заранее: и настройки, и пресеты приходят
от игры.

Сторона панели — `connectGame`: принимает элемент iframe и два колбэка, фреймворк ей не нужен.
Знакомство тоже на ней — какое бы из двух окон ни поднялось первым, второе его услышит, так что
подгадывать момент панели не нужно.

Примеры на React.

```tsx
// пример на React
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

  // пока пусто — игра не ответила, значит настроек она не принимает
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

  // перезагруженная игра забывает панель и может вообще перестать принимать настройки
  const greet = () => {
    setOffer(null)
    setStats(null)
    connectionRef.current?.hello()
  }

  // отправляем настройки целиком и сразу показываем их у себя
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
            page: {stats ? `${stats.page.fps} fps, худший кадр ${stats.page.worstMs} мс` : '—'}
            <br />
            render: {stats?.render ? `${stats.render.fps} fps, ${stats.render.cpuMs} мс на кадр` : '—'}
            <br />
            line:{' '}
            {stats
              ? `${stats.line.requests} запросов, ${stats.line.dropped} потеряно, ${stats.line.events} задержано, последняя +${stats.line.lastTripMs} мс`
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
            label="Замедление страницы"
            value={settings.cpu.pageSlowdown}
            min={1}
            max={10}
            step={0.5}
            onChange={(pageSlowdown) => apply({ ...settings, cpu: { ...settings.cpu, pageSlowdown } })}
          />
          <Knob
            label="Замедление рендера"
            value={settings.cpu.renderSlowdown}
            min={1}
            max={10}
            step={0.5}
            onChange={(renderSlowdown) => apply({ ...settings, cpu: { ...settings.cpu, renderSlowdown } })}
          />
          <Knob
            label="Заливки GPU"
            value={settings.gpu.fills}
            min={0}
            max={600}
            step={10}
            onChange={(fills) => apply({ ...settings, gpu: { ...settings.gpu, fills } })}
          />
          <Knob
            label="Разрешение"
            value={settings.resolution}
            min={0.25}
            max={3}
            step={0.25}
            onChange={(resolution) => apply({ ...settings, resolution })}
          />
          <Knob
            label="Задержка, мс"
            value={settings.network.latencyMs}
            min={0}
            max={3000}
            step={50}
            onChange={(latencyMs) => apply({ ...settings, network: { ...settings.network, latencyMs } })}
          />
          <Knob
            label="Разброс, мс"
            value={settings.network.jitterMs}
            min={0}
            max={1000}
            step={50}
            onChange={(jitterMs) => apply({ ...settings, network: { ...settings.network, jitterMs } })}
          />
          <Knob
            label="Потери, %"
            value={Math.round(settings.network.lossRate * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(share) => apply({ ...settings, network: { ...settings.network, lossRate: share / 100 } })}
          />
          <Knob
            label="Полоса, кбит/с"
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
            Сбросить
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

Кнопку, открывающую панель, держите заблокированной, пока `offer` пуст.

Разговор целиком:

| Сообщение | Кто шлёт | Когда | Что внутри |
| --- | --- | --- | --- |
| `ready` | игра | при старте и в ответ на `hello` | версия, текущие настройки, «выключенное» состояние, пресеты и `isGreeted` — дошёл ли до игры `hello` |
| `stats` | игра | дважды в секунду, после `hello` | кадры страницы, кадры игры, счётчик сети |
| `hello` | панель | при подключении, при каждой загрузке фрейма и в ответ на `ready` с `isGreeted: false` | ничего |
| `set` | панель | при каждом изменении | настройки целиком |

## Пресеты

Приходят от игры в `ready`, поэтому числа живут в одном месте.

- **CPU** — `No load`, `Slower device 2x / 4x / 6x`.
- **GPU** — `No load`, `Light`, `Heavy`, `Very heavy`, прикинуты под средний ноутбук.
- **Network** — `Fast 4G`, `Slow 4G`, `3G`, у каждого близнец `(unstable)` с разбросом задержки и
  потерей десятой части, плюс `Offline`. Ровные числа — браузерные.

## Разработка

```bash
npm run build     # tsc в dist: ESM и .d.ts
npm run lint
npm run format
```

Зависимостей во время работы — ноль, и пусть так и остаётся: библиотеку подключают игры на разных
стеках, и тащить в них чужой стор или фреймворк нельзя.

### Две версии, которые легко перепутать

**Версия пакета** (`package.json`) и тег — как потребители фиксируют, что ставят. Поднимать при
любом изменении, которое стоит забрать.

**Версия разговора** (`THROTTLE_VERSION` в `src/protocol.ts`) — про то, понимают ли друг друга игра
и панель. Поднимать **только** при ломающем изменении:

- переименовали или убрали поле в `ThrottleSettings`;
- поменяли смысл существующего поля (например, `fills` стал означать другое);
- убрали вид сообщения или сделали поле в нём обязательным.

Добавили **необязательное** поле или новый пресет — версия разговора прежняя: старая панель просто
не заметит нового.

Почему это важно: игры и панель обновляются вразнобой. Через месяц на стенде окажется игра со старой
версией пакета, а панель уже с новой. Без метки это выглядит как молча сломанная панель; с меткой
панель скажет, что игра говорит на версии 2, а она знает 1.

### Если меняете протокол

`src/protocol.ts` общий для обеих сторон, менять его надо с оглядкой на обе. Порядок: правим типы,
при необходимости поднимаем `THROTTLE_VERSION`, собираем, обновляем зависимость в игре и в панели,
проверяем вместе.
