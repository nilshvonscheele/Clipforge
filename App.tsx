import { create } from 'zustand'
import { transcribe, type Word } from './lib/transcribe'
import { findClips, type Clip } from './lib/highlights'
import { exportClips, DIMS, type Fmt, type Reframe } from './lib/export'
import { trackFaces, fx } from './lib/reframe'
import { segments, isFiller, inClip, total } from './lib/edit'
import { rescore, genMeta, templateMeta, DEFAULT_MODEL, type Cfg } from './lib/llm'
import { fontFamily } from './lib/font'
import { putProject, listProjects, putFile, getFile, delProject, type Saved } from './lib/db'
import { PRESETS, chunk, type CapOpts } from './lib/captions'
import { useEffect, useMemo, useRef, useState } from 'react'

const L = {
  sv: { sub: 'Gör långa videor till korta klipp. Gratis, utan konto och vattenmärke.', drop: 'Släpp en video här eller klicka för att välja', warn: 'Allt körs i din webbläsare. Rekommenderat: under ca 500 MB / 60 min.', s: ['Ladda upp', 'Granska klipp', 'Exportera'], model: 'Laddar AI-modell', audio: 'Avkodar ljud', transcribe: 'Transkriberar (kan ta en stund)', exp: 'Exportera valda (ZIP)', rendering: 'Renderar klipp', score: 'Viralpoäng', cap: 'Undertexter', style: 'Stil', color: 'Markeringsfärg', pos: 'Position', size: 'Storlek', top: 'Topp', middle: 'Mitten', bottom: 'Botten', prev: 'Förhandsvisning', fmt: 'Format', blur: 'Blurrad bakgrund', crop: 'Smart beskärning', manual: 'Manuell beskärning', tr: 'Spårar ansikten', edit: 'Redigera', del: 'Ta bort ord', ts: 'Start här', te: 'Slut här', filler: 'Ta bort fyllnadsord', sil: 'Klipp tystnader', reset: 'Återställ', len: 'Längd', saved: '✓ Sparas automatiskt', projects: 'Sparade projekt', open: 'Öppna', delp: 'Ta bort', newp: 'Nytt projekt', nosave: 'Videon kunde inte sparas i webbläsaren (för stor). Projektet sparas, men du måste välja videon igen efter omladdning.', relink: 'Videon saknas: välj samma videofil igen för att fortsätta', split: 'Dela', intro: 'Introtext', outro: 'Outrotext', bar: 'Förloppsindikator', music: 'Bakgrundsmusik', mvol: 'Musikvolym', res: 'Upplösning', txt: 'Redigera text', ai: 'Avancerat (AI, valfritt)', keynote: 'Nyckeln sparas bara i din webbläsare och skickas bara till vald leverantör.', apikey: 'API-nyckel', model: 'Modell', aiscore: 'Förbättra poäng med AI', gen: 'Generera titel/beskrivning/taggar', genall: 'Generera för alla valda', font: 'Eget typsnitt (.ttf/.otf)', title: 'Titel', desc: 'Beskrivning', tags: 'Hashtags' },
  en: { sub: 'Turn long videos into short clips. Free, no login, no watermark.', drop: 'Drop a video here or click to choose', warn: 'Everything runs in your browser. Recommended: under ~500 MB / 60 min.', s: ['Upload', 'Review clips', 'Export'], model: 'Loading AI model', audio: 'Decoding audio', transcribe: 'Transcribing (may take a while)', exp: 'Export selected (ZIP)', rendering: 'Rendering clip', score: 'Virality score', cap: 'Captions', style: 'Style', color: 'Highlight color', pos: 'Position', size: 'Size', top: 'Top', middle: 'Middle', bottom: 'Bottom', prev: 'Preview', fmt: 'Format', blur: 'Blurred background', crop: 'Smart crop', manual: 'Manual crop', tr: 'Tracking faces', edit: 'Edit', del: 'Delete words', ts: 'Start here', te: 'End here', filler: 'Remove filler words', sil: 'Cut silences', reset: 'Reset', len: 'Length', saved: '✓ Autosaved', projects: 'Saved projects', open: 'Open', delp: 'Delete', newp: 'New project', nosave: 'The video could not be stored in the browser (too large). The project is saved, but you must pick the video again after a reload.', relink: 'Video missing: choose the same video file again to continue', split: 'Split', intro: 'Intro text', outro: 'Outro text', bar: 'Progress bar', music: 'Background music', mvol: 'Music volume', res: 'Resolution', txt: 'Edit text', ai: 'Advanced (AI, optional)', keynote: 'The key is stored only in your browser and sent only to the chosen provider.', apikey: 'API key', model: 'Model', aiscore: 'Improve scores with AI', gen: 'Generate title/description/tags', genall: 'Generate for all selected', font: 'Custom font (.ttf/.otf)', title: 'Title', desc: 'Description', tags: 'Hashtags' },
}
type St = { lang: 'sv' | 'en'; step: number; file?: File; url?: string; words: Word[]; clips: Clip[]; busy: string; pct: number; err: string; cap: CapOpts; rf: Reframe; sil: boolean; id?: string; fname: string; ov: { bar: boolean; vol: number }; music?: File; font?: { name: string; data: Uint8Array }; set: (p: Partial<St>) => void }
const useS = create<St>(set => ({ lang: 'sv', step: 0, words: [], clips: [], busy: '', pct: 0, err: '', cap: { on: true, preset: 'pop', hi: '', pos: 'bottom', scale: 1 }, rf: { fmt: '9:16', mode: 'blur', res: 1080 }, sil: false, fname: '', ov: { bar: false, vol: 0.15 }, set: p => set(p) }))
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function App() {
  const s = useS(), t = L[s.lang]

  const vref = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [act, setAct] = useState<number | null>(null)
  const chunks = useMemo(() => { const d = new Set(s.clips[act ?? 0]?.del ?? []); return chunk(s.words.filter((_, i) => !d.has(i))) }, [s.words, s.clips, act])
  useEffect(() => {
    let id = 0
    const loop = () => {
      const v = vref.current
      if (v) {
        setTime(prev => (Math.abs(prev - v.currentTime) > 0.03 ? v.currentTime : prev))
        if (act !== null && !v.paused && s.clips[act]) { // skip cut parts while previewing
          const sg = segments(s.words, s.clips[act], s.sil), t0 = v.currentTime
          if (!sg.some(([a, b]) => t0 >= a && t0 <= b)) { const nx = sg.find(([a]) => a > t0); if (nx) v.currentTime = nx[0]; else v.pause() }
        }
      }
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [act, s.clips, s.words, s.sil])
  const pr = PRESETS.find(x => x.id === s.cap.preset)!, hi = s.cap.hi || pr.hi, K = (400 / DIMS[s.rf.fmt].h) * s.cap.scale
  const cur = (() => {
    if (!s.cap.on) return null
    const ch = chunks.find(c => time >= c[0].start && time <= c.at(-1)!.end + 0.15)
    if (!ch) return null
    return { ch, ai: ch.findIndex((w, i) => time >= w.start && (i === ch.length - 1 || time < ch[i + 1].start)) }
  })()
  const setCap = (p: Partial<CapOpts>) => s.set({ cap: { ...s.cap, ...p } })
  const splitAt = (i: number) => {
    const c = s.clips[i], t0 = vref.current?.currentTime ?? 0
    if (t0 <= c.start + 1 || t0 >= c.end - 1) return
    s.set({ clips: [...s.clips.slice(0, i), { ...c, end: t0, track: undefined }, { ...c, start: t0, track: undefined }, ...s.clips.slice(i + 1)] })
  }
  const move = (i: number, d: number) => {
    if (i + d < 0 || i + d >= s.clips.length) return
    const a = [...s.clips]; [a[i], a[i + d]] = [a[i + d], a[i]]
    s.set({ clips: a }); setEd(null); setAct(null)
  }
  const play = (i: number) => { const v = vref.current!; setAct(i); v.currentTime = s.clips[i].start; v.play() }

  const [va, setVa] = useState(16 / 9)
  const [ed, setEd] = useState<number | null>(null)
  const [em, setEm] = useState<'del' | 'start' | 'end' | 'text'>('del')
  const wclick = (ci: number, gi: number) => {
    const c = s.clips[ci], w = s.words[gi]
    if (em === 'del') { const d = new Set(c.del ?? []); if (d.has(gi)) d.delete(gi); else d.add(gi); upd(ci, { del: [...d] }) }
    else if (em === 'start' && w.start < c.end - 1) upd(ci, { start: w.start, track: undefined })
    else if (em === 'end' && w.end > c.start + 1) upd(ci, { end: w.end, track: undefined })
    else if (em === 'text') { const v = prompt('', w.text); if (v !== null) s.set({ words: s.words.map((x, k) => (k === gi ? { ...x, text: v.trim() } : x)) }) }
  }
  const fillers = (ci: number) => { const c = s.clips[ci], d = new Set(c.del ?? []); s.words.forEach((w, i) => { if (inClip(w, c) && isFiller(w)) d.add(i) }); upd(ci, { del: [...d] }) }
  const D = DIMS[s.rf.fmt], PW = (400 * D.w) / D.h
  const ac = s.clips[act ?? 0]
  const fxv = s.rf.mode === 'crop' && ac ? ac.cropX ?? fx(ac.track ?? [], time) : 0.5
  const vw = 400 * va, left = vw <= PW ? (PW - vw) / 2 : -Math.min(Math.max(fxv * vw - PW / 2, 0), vw - PW)

  const [projects, setProjects] = useState<Saved[]>([])
  const [savedAt, setSavedAt] = useState(0)
  const refresh = () => listProjects().then(setProjects).catch(() => {})
  useEffect(() => { if (s.step === 0) refresh() }, [s.step])
  useEffect(() => { // debounced autosave of project state (video is stored once, separately)
    if (!s.id || s.step < 1) return
    const h = setTimeout(() => {
      const { words, clips, cap, rf, sil, lang, step, fname, ov } = useS.getState()
      putProject({ id: s.id!, name: fname, savedAt: Date.now(), state: { words, clips, cap, rf, sil, lang, step, ov } }).then(() => setSavedAt(Date.now())).catch(() => {})
    }, 1000)
    return () => clearTimeout(h)
  }, [s.id, s.words, s.clips, s.cap, s.rf, s.sil, s.lang, s.step, s.ov])
  async function openProject(p: Saved) {
    const file = await getFile(p.id).catch(() => undefined)
    s.set({ ...p.state, id: p.id, fname: p.name, file, url: file ? URL.createObjectURL(file) : undefined, err: '' })
    setAct(null); setEd(null)
  }
  function newProject() {
    s.set({ step: 0, file: undefined, url: undefined, words: [], clips: [], id: undefined, fname: '', err: '' })
    setAct(null); setEd(null); setSavedAt(0)
  }

  const [cfg, setCfg] = useState<Cfg>(() => { try { return JSON.parse(localStorage.getItem('cf-llm') ?? '') } catch { return { provider: 'anthropic', key: '', model: DEFAULT_MODEL.anthropic } } })
  useEffect(() => { try { localStorage.setItem('cf-llm', JSON.stringify(cfg)) } catch {} }, [cfg])
  const llmOk = !!cfg.key.trim()
  const patch = (i: number, p: Partial<Clip>) => useS.setState(x => ({ clips: x.clips.map((k, j) => (j === i ? { ...k, ...p } : k)) }))
  const clipText = (c: Clip) => { const d = new Set(c.del ?? []); return useS.getState().words.filter((w, gi) => inClip(w, c) && !d.has(gi)).map(w => w.text).join(' ') }
  async function aiScore() {
    useS.setState({ busy: 'AI…', pct: 50, err: '' })
    try {
      const r = await rescore(cfg, useS.getState().clips.map(c => ({ text: clipText(c) })))
      useS.setState(x => ({ clips: x.clips.map((c, j) => (r[j]?.why ? { ...c, score: Math.round(Math.max(0, Math.min(100, r[j].score))), why: r[j].why } : c)) }))
    } catch (e: any) { useS.setState({ err: String(e?.message ?? e) }) }
    useS.setState({ busy: '' })
  }
  async function genFor(i: number) {
    try { patch(i, { meta: llmOk ? await genMeta(cfg, clipText(useS.getState().clips[i])) : templateMeta(clipText(useS.getState().clips[i]), s.lang) }) }
    catch (e: any) { useS.setState({ err: String(e?.message ?? e) }) }
  }
  async function genAll() {
    useS.setState({ busy: 'AI…', pct: 50 })
    for (let i = 0; i < useS.getState().clips.length; i++) if (useS.getState().clips[i].selected) await genFor(i)
    useS.setState({ busy: '' })
  }
  async function onFont(e: any) {
    const f: File | undefined = e.target.files?.[0]; if (!f) return
    const buf = await f.arrayBuffer(), name = fontFamily(buf)
    if (!name) { s.set({ err: 'Kunde inte läsa typsnittet / could not read font (.ttf/.otf)' }); return }
    document.fonts.add(await new FontFace(name, buf).load())
    s.set({ font: { name, data: new Uint8Array(buf) }, cap: { ...s.cap, font: name } })
  }

  async function track() {
    const st = useS.getState()
    for (let i = 0; i < st.clips.length; i++) {
      const c = useS.getState().clips[i]
      if (!c.selected || c.track || c.cropX !== undefined) continue
      useS.setState({ busy: `${t.tr} ${i + 1}/${st.clips.length}`, pct: (i / st.clips.length) * 100 })
      try {
        const tr = await trackFaces(st.url!, c.start, c.end)
        useS.setState(x => ({ clips: x.clips.map((k, j) => (j === i ? { ...k, track: tr } : k)) }))
      } catch (e: any) { useS.setState({ err: String(e?.message ?? e) }) }
    }
    useS.setState({ busy: '' })
  }

  async function onFile(file: File) {
    try {
      s.set({ file, url: URL.createObjectURL(file), err: '', busy: 'model', pct: 0 })
      const words = await transcribe(file, (b, p) => useS.getState().set({ busy: b, pct: p ?? 0 }))
      const id = crypto.randomUUID()
      putFile(id, file).catch(() => useS.getState().set({ err: t.nosave }))
      s.set({ words, clips: findClips(words), step: 1, busy: '', id, fname: file.name })
      if (cfg.key.trim()) setTimeout(aiScore, 0)
    } catch (e: any) { s.set({ busy: '', err: String(e?.message ?? e) }) }
  }
  async function doExport() {
    try {
      if (s.rf.mode === 'crop') await track()
      const sel = useS.getState().clips.filter(c => c.selected)
      const blob = await exportClips(s.file!, sel, s.words, { cap: s.cap, rf: s.rf, sil: s.sil, bar: s.ov.bar, music: s.music, musicVol: s.ov.vol, font: s.font, onProgress: (i, p) => useS.getState().set({ busy: `${t.rendering} ${i + 1}/${sel.length}`, pct: p * 100 }) })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'clipforge-clips.zip'; a.click()
      s.set({ busy: '', step: 2 })
    } catch (e: any) { s.set({ busy: '', err: String(e?.message ?? e) }) }
  }
  const upd = (i: number, p: Partial<Clip>) => s.set({ clips: s.clips.map((c, k) => (k === i ? { ...c, ...p } : c)) })
  const busyLabel = (t as any)[s.busy] ?? s.busy

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clip<span className="text-violet-400">Forge</span></h1>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {s.step >= 1 && savedAt > 0 && <span>{t.saved}</span>}
          {s.step >= 1 && <button className="px-3 py-1 rounded bg-zinc-800 text-zinc-200" onClick={newProject}>{t.newp}</button>}
          <button className="text-sm px-3 py-1 rounded bg-zinc-800 text-zinc-100" onClick={() => s.set({ lang: s.lang === 'sv' ? 'en' : 'sv' })}>{s.lang === 'sv' ? 'English' : 'Svenska'}</button>
        </div>
      </header>
      <ol className="flex gap-2 mb-6 text-sm">{t.s.map((x, i) => <li key={x} className={`px-3 py-1 rounded-full ${i <= s.step ? 'bg-violet-600' : 'bg-zinc-800 text-zinc-400'}`}>{i + 1}. {x}</li>)}</ol>
      {s.err && <p className="mb-4 p-3 rounded bg-red-950 text-red-300 text-sm">{s.err}</p>}
      {s.busy && <div className="mb-4"><p className="text-sm mb-1">{busyLabel}</p><div className="h-2 bg-zinc-800 rounded"><div className="h-2 bg-violet-500 rounded transition-all" style={{ width: `${s.pct}%` }} /></div></div>}

      {s.step === 0 && !s.busy && (
        <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]) }}
          className="block border-2 border-dashed border-zinc-700 rounded-2xl p-12 text-center cursor-pointer hover:border-violet-500">
          <p className="text-lg mb-2">{t.drop}</p><p className="text-zinc-400 text-sm mb-1">{t.sub}</p><p className="text-amber-400 text-xs">{t.warn}</p>
          <input type="file" accept=".mp4,.mov,.webm,.m4v,video/*" hidden onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}

      {s.step === 0 && !s.busy && projects.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm text-zinc-400 mb-2">{t.projects}</h2>
          <ul className="space-y-2">{[...projects].sort((a, b) => b.savedAt - a.savedAt).map(p => (
            <li key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 text-sm">
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-xs text-zinc-500">{new Date(p.savedAt).toLocaleString()}</span>
              <button className="text-violet-400" onClick={() => openProject(p)}>{t.open}</button>
              <button className="text-red-400" onClick={async () => { await delProject(p.id); refresh() }}>{t.delp}</button>
            </li>))}</ul>
        </div>
      )}
      {s.step >= 1 && !s.file && (
        <label className="block mb-4 p-3 rounded-xl border border-amber-500 text-sm cursor-pointer text-amber-300">{t.relink}
          <input type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { s.set({ file: f, url: URL.createObjectURL(f), err: '' }); if (s.id) putFile(s.id, f).catch(() => {}) } }} />
        </label>
      )}
      {s.step >= 1 && (
        <div className="grid md:grid-cols-[1fr_420px] gap-6">
          <div className="space-y-3 order-2 md:order-1">
            {s.clips.map((c, i) => (
              <div key={i} className={`p-4 rounded-xl border ${c.selected ? 'border-violet-500 bg-zinc-900' : 'border-zinc-800'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <input type="checkbox" checked={c.selected} onChange={e => upd(i, { selected: e.target.checked })} />
                  <span className="font-mono text-sm">{fmt(c.start)}–{fmt(c.end)}</span>
                  <span className="ml-auto text-sm bg-violet-600 rounded-full px-2">{t.score} {c.score}</span>
                </div>
                <p className="text-sm text-zinc-300 line-clamp-3">{c.text}</p>
                <p className="text-xs text-zinc-500 mt-1">{c.why}</p>
                {s.rf.mode === 'crop' && (
                  <label className="flex items-center gap-2 text-xs mt-2">
                    <input type="checkbox" checked={c.cropX !== undefined} onChange={e => upd(i, { cropX: e.target.checked ? 0.5 : undefined })} />{t.manual}
                    {c.cropX !== undefined && <input type="range" min="0" max="1" step="0.01" value={c.cropX} onChange={e => { upd(i, { cropX: +e.target.value }); setAct(i) }} className="flex-1" />}
                  </label>
                )}
                <div className="flex gap-4 mt-2 text-xs">
                  <button className="text-violet-400" onClick={() => play(i)}>▶ Preview</button>
                  <button className="text-violet-400" onClick={() => setEd(ed === i ? null : i)}>✎ {t.edit}</button>
                  <button className="text-violet-400" onClick={() => splitAt(i)}>✂ {t.split}</button>
                  <button className="text-zinc-400" onClick={() => move(i, -1)}>▲</button><button className="text-zinc-400" onClick={() => move(i, 1)}>▼</button>
                  <span className="ml-auto text-zinc-500">{t.len} {fmt(total(segments(s.words, c, s.sil)))}</span>
                </div>
                {ed === i && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-1 text-xs">
                      {(['del', 'start', 'end', 'text'] as const).map(m => <button key={m} onClick={() => setEm(m)} className={`px-2 py-1 rounded ${em === m ? 'bg-violet-600' : 'bg-zinc-800'}`}>{m === 'del' ? t.del : m === 'start' ? t.ts : m === 'end' ? t.te : t.txt}</button>)}
                      <button className="px-2 py-1 rounded bg-zinc-800" onClick={() => fillers(i)}>{t.filler}</button>
                      <button className="px-2 py-1 rounded bg-zinc-800" onClick={() => upd(i, { del: [] })}>{t.reset}</button>
                    </div>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.sil} onChange={e => s.set({ sil: e.target.checked })} />{t.sil}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="bg-zinc-800 rounded px-2 py-1 text-xs" placeholder={t.intro} value={c.intro ?? ''} onChange={e => upd(i, { intro: e.target.value || undefined })} />
                      <input className="bg-zinc-800 rounded px-2 py-1 text-xs" placeholder={t.outro} value={c.outro ?? ''} onChange={e => upd(i, { outro: e.target.value || undefined })} />
                    </div>
                    <button className="text-xs text-violet-400" onClick={() => genFor(i)}>✦ {t.gen}</button>
                    {c.meta && (['title', 'desc', 'tags'] as const).map(k => <input key={k} className="w-full bg-zinc-800 rounded px-2 py-1 text-xs" placeholder={t[k]} value={c.meta![k]} onChange={e => patch(i, { meta: { ...c.meta!, [k]: e.target.value } })} />)}
                    <p className="text-sm leading-7 max-h-48 overflow-auto">
                      {s.words.map((w, gi) => w.start >= c.start - 15 && w.end <= c.end + 15 ? (
                        <span key={gi} onClick={() => wclick(i, gi)} className={`cursor-pointer rounded px-0.5 hover:bg-zinc-700 ${inClip(w, c) ? '' : 'opacity-40'} ${c.del?.includes(gi) ? 'line-through text-red-400' : ''}`}>{w.text} </span>
                      ) : null)}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <button disabled={!!s.busy || !s.clips.some(c => c.selected)} onClick={doExport} className="w-full py-3 rounded-xl bg-violet-600 disabled:opacity-40 font-semibold">{t.exp}</button>
          </div>
          <div className="order-1 md:order-2 md:sticky md:top-4 self-start space-y-3">
            <p className="text-xs text-zinc-500">{t.prev}</p>
            <div className="relative bg-black rounded-xl overflow-hidden mx-auto" style={{ width: PW, height: 400 }}
              onClick={() => s.rf.mode === 'crop' && (vref.current!.paused ? vref.current!.play() : vref.current!.pause())}>
              <video ref={vref} src={s.url} controls={s.rf.mode === 'blur'} onLoadedMetadata={e => setVa(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
                className={s.rf.mode === 'blur' ? 'absolute inset-0 w-full h-full object-contain' : 'absolute max-w-none'}
                style={s.rf.mode === 'crop' ? { height: 400, width: vw, left, top: 0 } : undefined} />
              {cur && (
                <div className="absolute inset-x-0 px-3 text-center pointer-events-none leading-tight font-bold"
                  style={{ [s.cap.pos === 'bottom' ? 'bottom' : 'top']: s.cap.pos === 'middle' ? '45%' : (300 * 400) / D.h, fontSize: pr.size * K, color: pr.color, fontFamily: s.cap.font ? `"${s.cap.font}", Arial` : 'Arial' }}>
                  <span style={pr.box ? { background: pr.outline, padding: '0 6px', boxDecorationBreak: 'clone' } : { WebkitTextStroke: `${pr.ow * 2 * (400 / D.h)}px ${pr.outline}`, paintOrder: 'stroke fill' }}>
                    {cur.ch.map((w, k) => <span key={k} style={k === cur.ai ? { color: hi, display: 'inline-block', transform: pr.pop ? 'scale(1.15)' : undefined } : undefined}>{pr.upper ? w.text.toUpperCase() : w.text}{' '}</span>)}
                  </span>
                </div>
              )}
            </div>
            <details className="p-3 rounded-xl bg-zinc-900 text-sm space-y-2">
              <summary className="cursor-pointer text-zinc-300">{t.ai}</summary>
              <p className="text-xs text-zinc-500">{t.keynote}</p>
              <div className="flex gap-1">
                <select className="bg-zinc-800 rounded px-1" value={cfg.provider} onChange={e => { const p = e.target.value as Cfg['provider']; setCfg({ ...cfg, provider: p, model: DEFAULT_MODEL[p] }) }}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
                <input className="flex-1 min-w-0 bg-zinc-800 rounded px-2" placeholder={t.model} value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })} />
              </div>
              <input type="password" className="w-full bg-zinc-800 rounded px-2 py-1" placeholder={t.apikey} value={cfg.key} onChange={e => setCfg({ ...cfg, key: e.target.value })} />
              <button disabled={!llmOk || !!s.busy} className="w-full py-1 rounded bg-zinc-800 disabled:opacity-40" onClick={aiScore}>{t.aiscore}</button>
              <button disabled={!!s.busy} className="w-full py-1 rounded bg-zinc-800" onClick={genAll}>{t.genall}</button>
              <label className="block text-xs text-zinc-400">{t.font}: <span className="text-zinc-200">{s.cap.font ?? 'Arial'}</span><input type="file" accept=".ttf,.otf" className="block w-full text-xs mt-1" onChange={onFont} /></label>
            </details>
            <div className="p-3 rounded-xl bg-zinc-900 space-y-3 text-sm">
              <div className="flex gap-1">{(['9:16', '1:1', '4:5'] as Fmt[]).map(x => <button key={x} onClick={() => s.set({ rf: { ...s.rf, fmt: x } })} className={`flex-1 text-xs py-1 rounded ${s.rf.fmt === x ? 'bg-violet-600' : 'bg-zinc-800'}`}>{x}</button>)}</div>
              <div className="flex gap-1">{(['blur', 'crop'] as const).map(x => <button key={x} onClick={() => { s.set({ rf: { ...s.rf, mode: x } }); if (x === 'crop') track() }} className={`flex-1 text-xs py-1 rounded ${s.rf.mode === x ? 'bg-violet-600' : 'bg-zinc-800'}`}>{t[x]}</button>)}</div>
              <div className="flex items-center gap-1"><span className="text-xs text-zinc-400 mr-1">{t.res}</span>{([720, 1080] as const).map(x => <button key={x} onClick={() => s.set({ rf: { ...s.rf, res: x } })} className={`flex-1 text-xs py-1 rounded ${(s.rf.res ?? 1080) === x ? 'bg-violet-600' : 'bg-zinc-800'}`}>{x}p</button>)}</div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.ov.bar} onChange={e => s.set({ ov: { ...s.ov, bar: e.target.checked } })} />{t.bar}</label>
              <label className="block text-xs text-zinc-400">{t.music}: <span className="text-zinc-200">{s.music?.name ?? '–'}</span>
                <input type="file" accept="audio/*" className="block w-full text-xs mt-1" onChange={e => s.set({ music: e.target.files?.[0] })} /></label>
              {s.music && <label className="flex items-center justify-between gap-3">{t.mvol}<input type="range" min="0" max="1" step="0.05" value={s.ov.vol} onChange={e => s.set({ ov: { ...s.ov, vol: +e.target.value } })} /></label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.cap.on} onChange={e => setCap({ on: e.target.checked })} />{t.cap}</label>
              <div className="grid grid-cols-3 gap-1">{PRESETS.map(x => <button key={x.id} onClick={() => setCap({ preset: x.id, hi: '' })} className={`text-xs py-1 rounded ${s.cap.preset === x.id ? 'bg-violet-600' : 'bg-zinc-800'}`}>{x.name}</button>)}</div>
              <label className="flex items-center justify-between">{t.color}<input type="color" value={hi} onChange={e => setCap({ hi: e.target.value })} /></label>
              <label className="flex items-center justify-between">{t.pos}
                <select className="bg-zinc-800 rounded px-1" value={s.cap.pos} onChange={e => setCap({ pos: e.target.value as CapOpts['pos'] })}>{(['top', 'middle', 'bottom'] as const).map(x => <option key={x} value={x}>{t[x]}</option>)}</select></label>
              <label className="flex items-center justify-between gap-3">{t.size}<input type="range" min="0.7" max="1.4" step="0.05" value={s.cap.scale} onChange={e => setCap({ scale: +e.target.value })} /></label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
