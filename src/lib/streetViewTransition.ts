/**
 * 街景“向前穿梭”转场（移植自参考页 街景/index.html）：
 * 当前图朝消失点放大冲出（1x→6x），下一张从深处（0.22x）长到 1x，
 * 叠加径向运动模糊 + 轻微色散 + 中段曝光提亮 + 暗角，easeInOutCubic，1700ms。
 * 后退时把同一段动画倒放（from/to 互换、进度 1→0），即“倒退着走回去”。
 */
export const TRANSITION_MS = 1700
export const REDUCED_MOTION_MS = 400
/** 消失点（uv，y 向上），参考页统一使用 [0.5, 0.56]。 */
export const VANISH_POINT: [number, number] = [0.5, 0.56]

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uProgress;
uniform vec2  uRes;
uniform float uAspectA;
uniform float uAspectB;
uniform vec2  uCenter;
uniform vec2  uParallax;
uniform float uIdle;
uniform float uSimple;   // 1 = 仅交叉淡化（prefers-reduced-motion）
uniform vec3  uBg;

/* contain 适配（保持原 <img object-fit:contain> 的布局），画面外返回 -1 */
vec2 fitUV(vec2 uv, float aspect){
  float viewAspect = uRes.x / uRes.y;
  vec2 s = (viewAspect > aspect) ? vec2(viewAspect / aspect, 1.0) : vec2(1.0, aspect / viewAspect);
  return 0.5 + (uv - 0.5) * s;
}
vec3 sampleFit(sampler2D tex, vec2 p, float aspect, vec2 off){
  vec2 q = fitUV(p, aspect) + off;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return uBg;
  return texture2D(tex, q).rgb;
}
vec3 radialBlur(sampler2D tex, float aspect, vec2 uv, vec2 c, float scale, float amount){
  vec2 dir = uv - c;
  const int N = 14;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float ca = 0.0035 * amount * 60.0;
  for(int i = 0; i < N; i++){
    float k = float(i) / float(N - 1) - 0.5;
    float w = 1.0 - abs(k) * 0.9;
    vec2 p = c + dir * (1.0 / scale + k * amount);
    vec3 col;
    col.r = sampleFit(tex, p, aspect, dir * ca * 0.02).r;
    col.g = sampleFit(tex, p, aspect, vec2(0.0)).g;
    col.b = sampleFit(tex, p, aspect, -dir * ca * 0.02).b;
    acc += col * w;
    wsum += w;
  }
  return acc / wsum;
}
float easeInOutCubic(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }

void main(){
  vec2 uv = vUv + uParallax;
  float t = clamp(uProgress, 0.0, 1.0);
  vec3 col;
  if (uSimple > 0.5) {
    col = mix(sampleFit(uTexA, vUv, uAspectA, vec2(0.0)), sampleFit(uTexB, vUv, uAspectB, vec2(0.0)), t);
  } else {
    float e = easeInOutCubic(t);
    float speed = sin(3.1415926 * t);
    float blurAmt = 0.10 * speed;
    float scaleA = mix(1.0 + uIdle, 6.0, pow(e, 1.55));
    float scaleB = mix(0.22, 1.0, pow(e, 0.72));
    vec3 colA = radialBlur(uTexA, uAspectA, uv, uCenter, scaleA, blurAmt);
    vec3 colB = radialBlur(uTexB, uAspectB, uv, uCenter, scaleB, blurAmt);
    col = mix(colA, colB, smoothstep(0.30, 0.78, e));
    col *= 1.0 + 0.18 * speed;
    vec2 d = vUv - 0.5;
    col *= 1.0 - 0.35 * dot(d, d) * 2.2;
  }
  gl_FragColor = vec4(col, 1.0);
}`

const imageCache = new Map<string, Promise<HTMLImageElement>>()
/** 加载并缓存图片（用于预加载与转场前等待）。失败时从缓存移除以便重试。 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url)
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`街景图片加载失败: ${url}`))
      img.src = url
    })
    p.catch(() => imageCache.delete(url))
    imageCache.set(url, p)
    if (imageCache.size > 24) imageCache.delete(imageCache.keys().next().value!)
  }
  return p
}

type Tex = { tex: WebGLTexture; aspect: number }

export class StreetViewTransitionRenderer {
  private gl: WebGLRenderingContext
  private prog: WebGLProgram
  private buf: WebGLBuffer
  private u: Record<string, WebGLUniformLocation | null> = {}
  private textures = new Map<string, Tex>()
  private raf = 0
  private current: string | null = null
  private anim: { from: string; to: string; start: number; dir: 1 | -1; ms: number; simple: boolean } | null = null
  private parallax = { x: 0, y: 0, tx: 0, ty: 0 }
  private resizeObs: ResizeObserver
  private destroyed = false
  reducedMotion = false

  constructor(private canvas: HTMLCanvasElement, private bg: [number, number, number] = [0x11 / 255, 0x11 / 255, 0x11 / 255]) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG)
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    gl.useProgram(prog)
    this.prog = prog
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    for (const n of ['uTexA', 'uTexB', 'uProgress', 'uRes', 'uAspectA', 'uAspectB', 'uCenter', 'uParallax', 'uIdle', 'uSimple', 'uBg'])
      this.u[n] = gl.getUniformLocation(prog, n)
    gl.uniform1i(this.u.uTexA, 0)
    gl.uniform1i(this.u.uTexB, 1)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(canvas)
    canvas.addEventListener('mousemove', this.onMouse)
    this.resize()
    this.raf = requestAnimationFrame(this.render)
  }

  private onMouse = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect()
    this.parallax.tx = ((e.clientX - r.left) / r.width - 0.5) * -0.012
    this.parallax.ty = ((e.clientY - r.top) / r.height - 0.5) * 0.012
  }

  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  private texture(url: string, img: HTMLImageElement): Tex {
    let t = this.textures.get(url)
    if (t) return t
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
    t = { tex, aspect: img.naturalWidth / img.naturalHeight }
    this.textures.set(url, t)
    return t
  }

  /** 释放不在 keep 中、且当前未被使用的纹理。 */
  prune(keep: string[]) {
    const used = new Set([...keep, this.current, this.anim?.from, this.anim?.to].filter(Boolean) as string[])
    for (const [url, t] of this.textures) if (!used.has(url)) { this.gl.deleteTexture(t.tex); this.textures.delete(url) }
  }

  /** 立即结束进行中的转场（停在目标图）。 */
  finish() {
    if (this.anim) { this.current = this.anim.to; this.anim = null }
  }

  /** 无动画直接显示。 */
  show(url: string, img: HTMLImageElement) {
    this.texture(url, img)
    this.anim = null
    this.current = url
  }

  /** 从当前图转场到 url；dir=-1 为后退（倒放）。 */
  transition(url: string, img: HTMLImageElement, dir: 1 | -1) {
    this.finish()
    this.texture(url, img)
    if (!this.current || this.current === url) return this.show(url, img)
    const simple = this.reducedMotion
    this.anim = { from: this.current, to: url, start: performance.now(), dir, ms: simple ? REDUCED_MOTION_MS : TRANSITION_MS, simple }
  }

  private render = (now: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.render)
    let progress = 0
    if (this.anim) {
      progress = Math.min((now - this.anim.start) / this.anim.ms, 1)
      if (progress >= 1) this.finish()
    }
    const p = this.parallax
    const still = this.reducedMotion
    p.x += ((still ? 0 : p.tx) - p.x) * 0.06
    p.y += ((still ? 0 : p.ty) - p.y) * 0.06
    const a = this.anim
    // 后退：A=目标、B=原图，进度倒放，看起来像沿原路退回。
    const urlA = a ? (a.dir === 1 ? a.from : a.to) : this.current
    const urlB = a ? (a.dir === 1 ? a.to : a.from) : this.current
    const A = urlA ? this.textures.get(urlA) : undefined, B = urlB ? this.textures.get(urlB) : undefined
    const gl = this.gl
    if (!A || !B) { gl.clearColor(...this.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT); return }
    const prog = a ? (a.dir === 1 ? progress : 1 - progress) : 0
    // 空闲时极缓慢的呼吸缩放（周期 8s），与参考页一致
    const idle = a || still ? 0 : 0.0225 * (1 + Math.sin(now / 1000 * Math.PI / 4 - Math.PI / 2)) * 0.5
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.tex)
    gl.uniform1f(this.u.uProgress, prog)
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(this.u.uAspectA, A.aspect)
    gl.uniform1f(this.u.uAspectB, B.aspect)
    gl.uniform2fv(this.u.uCenter, VANISH_POINT)
    gl.uniform2f(this.u.uParallax, p.x, p.y)
    gl.uniform1f(this.u.uIdle, idle)
    gl.uniform1f(this.u.uSimple, a?.simple || (!a && still) ? 1 : 0)
    gl.uniform3fv(this.u.uBg, this.bg)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    this.canvas.removeEventListener('mousemove', this.onMouse)
    const gl = this.gl
    for (const t of this.textures.values()) gl.deleteTexture(t.tex)
    this.textures.clear()
    gl.deleteBuffer(this.buf)
    gl.deleteProgram(this.prog)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
