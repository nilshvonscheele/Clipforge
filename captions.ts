import type { Word } from './transcribe'
export type Preset = { id: string; name: string; size: number; color: string; hi: string; outline: string; ow: number; upper: boolean; box: boolean; pop: boolean }
export type CapOpts = { on: boolean; preset: string; hi: string; pos: 'bottom' | 'middle' | 'top'; scale: number; font?: string }

const P = (id: string, name: string, color: string, hi: string, outline: string, o: Partial<Preset> = {}): Preset =>
  ({ id, name, size: 80, color, hi, outline, ow: 6, upper: false, box: false, pop: false, ...o })
export const PRESETS: Preset[] = [
  P('classic', 'Classic', '#FFFFFF', '#FFE600', '#000000'),
  P('pop', 'Bold Pop', '#FFFFFF', '#00E676', '#000000', { size: 92, upper: true, pop: true, ow: 8 }),
  P('tiktok', 'TikTok', '#FFFFFF', '#25F4EE', '#FE2C55', { pop: true }),
  P('neon', 'Neon', '#FFFFFF', '#FF2BD6', '#2A0040', { upper: true }),
  P('box', 'Box', '#FFFFFF', '#FFE600', '#111111', { box: true, ow: 14 }),
  P('sunset', 'Sunset', '#FFF3E0', '#FF7A00', '#3B1200', { upper: true, pop: true }),
  P('comic', 'Comic', '#FFE600', '#FF3B30', '#000000', { size: 88, ow: 9, pop: true }),
  P('mint', 'Mint', '#FFFFFF', '#3DDC97', '#06281C'),
  P('minimal', 'Minimal', '#FFFFFF', '#B0B0B0', '#000000', { size: 64, ow: 2 }),
]

// Group words into short caption chunks (max 3 words / ~20 chars)
export function chunk(words: Word[]): Word[][] {
  const out: Word[][] = []; let cur: Word[] = []
  words.forEach((w, i) => {
    cur.push(w)
    const gap = (words[i + 1]?.start ?? Infinity) - w.end
    if (cur.length >= 3 || /[.!?,]$/.test(w.text) || gap > 0.6 || cur.map(x => x.text).join(' ').length > 20) { out.push(cur); cur = [] }
  })
  if (cur.length) out.push(cur)
  return out
}

const bgr = (hex: string) => { const h = hex.replace('#', ''); return h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2) }
const col = (hex: string) => `&H${bgr(hex)}&`.toUpperCase()

// Karaoke-style ASS: one event per word, active word recoloured (+ pop scale)
export function buildAss(words: Word[], start: number, end: number, o: CapOpts, d: { w: number; h: number } = { w: 1080, h: 1920 }, ex: { intro?: string; outro?: string; bar?: boolean } = {}): string {
  const p = PRESETS.find(x => x.id === o.preset) ?? PRESETS[0], hi = o.hi || p.hi
  const ws = o.on ? words.filter(w => w.start >= start && w.end <= end + 0.2) : []
  const t = (s: number) => { s = Math.max(0, s - start); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}` }
  const al = o.pos === 'bottom' ? 2 : o.pos === 'top' ? 8 : 5, mv = o.pos === 'middle' ? 0 : Math.round((300 * d.h) / 1920)
  const oc = `&H00${bgr(p.outline)}`.toUpperCase()
  let ev = ''
  for (const c of chunk(ws)) c.forEach((w, i) => {
    const e = c[i + 1] ? c[i + 1].start : Math.min(c.at(-1)!.end + 0.15, end)
    const text = c.map((x, k) => {
      const raw = o.font ? x.text : x.text.replace(/\p{Extended_Pictographic}/gu, ''), tx = p.upper ? raw.toUpperCase() : raw
      return k === i ? `{\\c${col(hi)}${p.pop ? '\\fscx115\\fscy115' : ''}}${tx}{\\c${col(p.color)}\\fscx100\\fscy100}` : tx
    }).join(' ')
    ev += `Dialogue: 0,${t(w.start)},${t(e)},Cap,,0,0,0,,{\\c${col(p.color)}}${text}\n`
  })
  const dur = Math.max(0, end - start)
  if (ex.intro) ev += `Dialogue: 1,${t(start)},${t(start + Math.min(2.2, dur))},Title,,0,0,0,,{\\fad(250,250)}${ex.intro}\n`
  if (ex.outro) ev += `Dialogue: 1,${t(end - Math.min(2.2, dur))},${t(end)},Title,,0,0,0,,{\\fad(250,250)}${ex.outro}\n`
  if (ex.bar) ev += `Dialogue: 2,${t(start)},${t(end)},Title,,0,0,0,,{\\an7\\pos(0,${d.h - 16})\\c${col(hi)}\\bord0\\shad0\\fscx0\\t(0,${Math.round(dur * 1000)},\\fscx100)\\p1}m 0 0 l ${d.w} 0 ${d.w} 16 0 16\n`
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${d.w}\nPlayResY: ${d.h}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Cap,${o.font || 'Arial'},${Math.round(p.size * o.scale)},&H00${bgr(p.color)},&H00${bgr(hi)},${oc},${oc},-1,0,0,0,100,100,0,0,${p.box ? 3 : 1},${p.ow},${p.box ? 0 : 2},${al},60,60,${mv},1\nStyle: Title,${o.font || 'Arial'},96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,8,2,5,80,80,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${ev}`
}
