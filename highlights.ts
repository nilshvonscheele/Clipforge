import type { Word } from './transcribe'
import type { Track } from './reframe'
export type Clip = { start: number; end: number; score: number; why: string; text: string; selected: boolean; track?: Track; cropX?: number; del?: number[]; intro?: string; outro?: string; meta?: { title: string; desc: string; tags: string } }

const HOOK = /^(why|how|what|did|do|never|stop|the secret|here'?s|aldrig|varför|hur|vad|visste|hemligheten|så)/i
const END = /[.!?…]$/
type Sent = { words: Word[]; start: number; end: number }

function sentences(words: Word[]): Sent[] {
  const out: Sent[] = []; let cur: Word[] = []
  words.forEach((w, i) => {
    cur.push(w)
    const gap = (words[i + 1]?.start ?? Infinity) - w.end
    if (END.test(w.text) || gap > 0.8) { out.push({ words: cur, start: cur[0].start, end: w.end }); cur = [] }
  })
  if (cur.length) out.push({ words: cur, start: cur[0].start, end: cur.at(-1)!.end })
  return out
}

// Local heuristic: hook, pace, pauses, completeness, keyword density
export function findClips(words: Word[], min = 15, max = 90, top = 10): Clip[] {
  const S = sentences(words), cands: Clip[] = []
  for (let i = 0; i < S.length; i++) {
    for (let j = i; j < S.length; j++) {
      const dur = S[j].end - S[i].start
      if (dur > max) break
      if (dur < min) continue
      const ws = S.slice(i, j + 1).flatMap(s => s.words)
      const text = ws.map(w => w.text).join(' ')
      const first = S[i].words.map(w => w.text).join(' ')
      const hook = HOOK.test(first) || first.endsWith('?') ? 25 : /\d/.test(first) ? 15 : 5
      const wps = ws.length / dur
      const pace = Math.max(0, 25 - Math.abs(wps - 2.8) * 12)
      const pauses = ws.slice(1).filter((w, k) => w.start - ws[k].end > 1).length / ws.length
      const calm = Math.max(0, 20 - pauses * 300)
      const done = END.test(ws.at(-1)!.text) ? 15 : 0
      const long = ws.filter(w => w.text.length > 6).map(w => w.text.toLowerCase())
      const kw = Math.min(15, (new Set(long).size / ws.length) * 60)
      const score = Math.round(Math.min(100, hook + pace + calm + done + kw))
      const why = [hook >= 15 && 'stark inledning / strong hook', pace > 18 && 'bra tempo / good pace', calm > 15 && 'få pauser / few pauses', done && 'avslutad tanke / complete thought', kw > 9 && 'innehållsrikt / rich content'].filter(Boolean).join(', ')
      cands.push({ start: S[i].start, end: S[j].end, score, why, text, selected: false })
    }
  }
  cands.sort((a, b) => b.score - a.score)
  const picked: Clip[] = []
  for (const c of cands) {
    if (picked.every(p => c.end <= p.start || c.start >= p.end)) picked.push(c)
    if (picked.length >= top) break
  }
  picked.slice(0, 3).forEach(c => (c.selected = true))
  return picked
}
