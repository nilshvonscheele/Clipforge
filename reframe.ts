import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
export type Track = { t: number; x: number }[] // t = video time (s), x = face centre 0..1

let det: FaceDetector | null = null
async function getDet() {
  if (det) return det
  const fs = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm')
  det = await FaceDetector.createFromOptions(fs, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
    runningMode: 'IMAGE',
  })
  return det
}

// Sample the clip every `step` s, follow the largest face, ignore small movements (steady "camera")
export async function trackFaces(url: string, start: number, end: number, step = 0.75): Promise<Track> {
  const d = await getDet()
  const v = document.createElement('video')
  v.src = url; v.muted = true; v.preload = 'auto'
  await new Promise<void>(r => { v.onloadeddata = () => r() })
  const raw: Track = []
  for (let t = start; t <= end; t += step) {
    await new Promise<void>(r => { v.onseeked = () => r(); v.currentTime = t })
    const faces = d.detect(v).detections.filter(f => f.boundingBox)
    if (!faces.length) continue
    const b = faces.sort((a, c) => c.boundingBox!.width * c.boundingBox!.height - a.boundingBox!.width * a.boundingBox!.height)[0].boundingBox!
    raw.push({ t, x: (b.originX + b.width / 2) / v.videoWidth })
  }
  if (!raw.length) return []
  let cur = raw[0].x
  return raw.map(p => { if (Math.abs(p.x - cur) > 0.04) cur += (p.x - cur) * 0.5; return { t: p.t, x: cur } })
}

export function fx(tr: Track, t: number): number {
  if (!tr.length) return 0.5
  if (t <= tr[0].t) return tr[0].x
  for (let i = 1; i < tr.length; i++) if (t <= tr[i].t) { const a = tr[i - 1], b = tr[i]; return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t) }
  return tr.at(-1)!.x
}

// ffmpeg expression for the face centre over clip-relative time t (≤ ~40 keyframes)
export function ffExpr(tr: Track, start: number): string {
  if (!tr.length) return '0.5'
  const step = Math.max(1, Math.ceil(tr.length / 40))
  const k = tr.filter((_, i) => i % step === 0 || i === tr.length - 1).map(p => ({ t: +(p.t - start).toFixed(2), x: +p.x.toFixed(4) }))
  let e = String(k.at(-1)!.x)
  for (let i = k.length - 1; i > 0; i--) {
    const a = k[i - 1], b = k[i]
    e = `if(lt(t,${b.t}),${a.x}+(${(b.x - a.x).toFixed(4)})*(t-${a.t})/${Math.max(0.01, b.t - a.t).toFixed(2)},${e})`
  }
  return `if(lt(t,${k[0].t}),${k[0].x},${e})`
}
