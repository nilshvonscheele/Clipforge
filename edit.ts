import type { Word } from './transcribe'
import type { Clip } from './highlights'
export type Seg = [number, number]

export const isFiller = (w: Word) => /^(um+|uh+|uhm+|eh+|ehm+|öh+|öhm+|hm+|mm+|liksom|asså)$/i.test(w.text.replace(/[^\p{L}]/gu, ''))
export const inClip = (w: Word, c: Clip) => w.start >= c.start - 0.01 && w.end <= c.end + 0.05
const PAD = 0.08, GAP = 0.6

// Keep-segments of a clip: deleted words split it; optional silence cutting (gaps > 0.6 s)
export function segments(words: Word[], c: Clip, sil: boolean): Seg[] {
  const del = new Set(c.del ?? []), segs: Seg[] = []
  let cur: Seg | null = null
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!inClip(w, c)) continue
    if (del.has(i)) { if (cur) segs.push(cur); cur = null; continue }
    if (cur && sil && w.start - cur[1] > GAP) { segs.push(cur); cur = null }
    if (cur) cur[1] = w.end + PAD
    else cur = [Math.max(c.start, w.start - PAD), w.end + PAD]
  }
  if (cur) segs.push(cur)
  return segs.filter(s => s[1] - s[0] > 0.15)
}

export const total = (segs: Seg[]) => segs.reduce((n, [a, b]) => n + b - a, 0)

// source time -> time on the edited timeline (null if the moment was cut)
export function remap(segs: Seg[], t: number): number | null {
  let off = 0
  for (const [a, b] of segs) { if (t >= a - 1e-6 && t <= b + 1e-6) return off + (t - a); off += b - a }
  return null
}

// Kept words on the edited timeline (for captions)
export function outWords(words: Word[], c: Clip, segs: Seg[]): Word[] {
  const del = new Set(c.del ?? []), o: Word[] = []
  words.forEach((w, i) => {
    if (!inClip(w, c) || del.has(i)) return
    const s = remap(segs, w.start), e = remap(segs, w.end)
    if (s !== null && e !== null) o.push({ text: w.text, start: s, end: e })
  })
  return o
}
