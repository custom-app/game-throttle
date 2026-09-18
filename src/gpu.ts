import { getThrottleSettings } from './state.js'

/** Past this the sheet is bigger than any screen it stands for, and only the memory grows */
const MOST_PIXELS = 4096

const VERTEX = `
attribute vec2 corner;

void main() {
  gl_Position = vec4(corner, 0.0, 1.0);
}
`

// barely any colour, but read and written all the same: the card pays for every pixel it blends
const FRAGMENT = `
precision lowp float;

void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.004);
}
`

const compile = (gl: WebGLRenderingContext, kind: number, source: string) => {
  const shader = gl.createShader(kind)

  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  return shader
}

/**
 * The load a card can be given from a page, which is fill and nothing else: a sheet the size of the
 * frame, shaded over and over into a canvas nobody ever sees.
 *
 * Its own canvas and its own context on purpose. A game draws too little of the screen to trouble a
 * card — a few sprites over a background — so asking it to draw itself again barely registers,
 * where a full sheet costs a card everything it has. And this way a game gets the knob for nothing:
 * there is one card behind the tab, whoever is drawing on it.
 */
export const startGpuLoad = () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false })

  if (!gl) return () => undefined

  const program = gl.createProgram()
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)

  if (!program || !vertex || !fragment) return () => undefined

  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.useProgram(program)

  // one triangle wide enough to cover the whole of it, which saves a second one and a seam
  const corners = gl.createBuffer()
  const corner = gl.getAttribLocation(program, 'corner')

  gl.bindBuffer(gl.ARRAY_BUFFER, corners)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  let request = requestAnimationFrame(function draw() {
    request = requestAnimationFrame(draw)

    const { fills } = getThrottleSettings().gpu

    if (fills <= 0) return

    // as many pixels as the game is drawn on, so a preset costs here what it would cost there
    const ratio = window.devicePixelRatio || 1
    const width = Math.min(MOST_PIXELS, Math.round(window.innerWidth * ratio))
    const height = Math.min(MOST_PIXELS, Math.round(window.innerHeight * ratio))

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }

    for (let fill = 0; fill < fills; fill += 1) {
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // the work is handed over now rather than whenever the next frame happens to ask for it
    gl.flush()
  })

  return () => {
    cancelAnimationFrame(request)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
