import { fetchFile } from '@ffmpeg/util'
import JSZip from 'jszip'
import type { Clip } from './highlights'
import type { Word } from './transcribe'
import { buildAss, type CapOpts } from './captions'
import { ffExpr } from './reframe'
import { segments, remap, outWords, total } from './edit'
import { getFF, mountFile, unmount } from './ff'

export type Fmt = '9:16' | '1:1' | '4:5'
export const DIMS: Record<Fmt, { w: number; h: number }> = { '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 } }
export type Reframe = { fmt: Fmt; mode: 'blur' | 'crop'; res?: 720 | 1080 }
export type ExportOpts = { cap: CapOpts; rf: Reframe; sil: boolean; bar: boolean; music?: File; musicVol: number; font?: { name: string; data: Uint8Array }; onProgress: (i: number, pct: number) => void }

// Filter chain from [vc] (edited video) to [vo]; x = face centre expression (0..1)
function reframe(r: Reframe, x: string): string {
  const { w, h } = DIMS[r.fmt]
  if (r.mode === 'crop')
    return `crop=w='min(iw,ih*${w}/${h})':h='min(ih,iw*${h}/${w})':x='min(max(iw*(${x})-ow/2,0),iw-ow)':y='(ih-oh)/2',scale=${w}:${h}`
  return `split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=25[bg];[b]scale=${w}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
}
let fontOk = false

export async function exportClips(file: File, clips: Clip[], words: Word[], o: ExportOpts): Promise<Blob> {
  const f = await getFF(), { cap, rf } = o
  const needFont = cap.on || o.bar || clips.some(c => c.intro || c.outro)
  if (needFont) {
    if (!fontOk) { await f.createDir('/fonts'); await f.writeFile('/fonts/arial.ttf', await fetchFile('https://raw.githubusercontent.com/ffmpegwasm/testdata/master/arial.ttf')); fontOk = true }
    if (o.font) await f.writeFile('/fonts/custom.ttf', o.font.data)
  }
  const src = await mountFile(f, file) // no full copy of the video in memory
  if (o.music) await f.writeFile('music', new Uint8Array(await o.music.arrayBuffer()))
  const zip = new JSZip(), notes: string[] = []
  let cur = 0
  f.on('progress', ({ progress }) => o.onProgress(cur, Math.min(1, Math.max(0, progress))))
  for (let i = 0; i < clips.length; i++) {
    cur = i
    const c = clips[i], segs = segments(words, c, o.sil)
    if (!segs.length) continue
    const rel = (n: number) => (n - c.start).toFixed(3)
    let g = segs.map(([a, b], k) => `[0:v]trim=start=${rel(a)}:end=${rel(b)},setpts=PTS-STARTPTS[v${k}];[0:a]atrim=start=${rel(a)}:end=${rel(b)},asetpts=PTS-STARTPTS[a${k}]`).join(';')
    g += `;${segs.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${segs.length}:v=1:a=1[vc][ac]`
    const trOut = (c.track ?? []).flatMap(p => { const t = remap(segs, p.t); return t === null ? [] : [{ t, x: p.x }] })
    g += `;[vc]${reframe(rf, c.cropX !== undefined ? String(c.cropX) : ffExpr(trOut, 0))}[vo]`
    let out = '[vo]', aud = '[ac]'
    if (cap.on || o.bar || c.intro || c.outro) {
      await f.writeFile('sub.ass', buildAss(outWords(words, c, segs), 0, total(segs), cap, DIMS[rf.fmt], { intro: c.intro, outro: c.outro, bar: o.bar }))
      g += ';[vo]subtitles=sub.ass:fontsdir=/fonts[vs]'; out = '[vs]'
    }
    if (rf.res === 720) { g += `;${out}scale=720:-2[vf]`; out = '[vf]' }
    if (o.music) { g += `;[1:a]volume=${o.musicVol}[mu];[ac][mu]amix=inputs=2:duration=first:dropout_transition=0,volume=2[am]`; aud = '[am]' }
    const inputs = ['-ss', String(c.start), '-i', src, ...(o.music ? ['-stream_loop', '-1', '-i', 'music'] : [])]
    await f.exec([...inputs, '-t', String(c.end - c.start + 0.3), '-filter_complex', g, '-map', out, '-map', aud, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-c:a', 'aac', `clip${i}.mp4`])
    const name = `clip_${i + 1}_score${c.score}.mp4`
    zip.file(name, (await f.readFile(`clip${i}.mp4`)) as Uint8Array)
    if (c.meta) notes.push(`${name}\n${c.meta.title}\n${c.meta.desc}\n${c.meta.tags}\n`)
    await f.deleteFile(`clip${i}.mp4`)
  }
  if (notes.length) zip.file('titles_descriptions.txt', notes.join('\n'))
  await unmount(f)
  return zip.generateAsync({ type: 'blob' })
}
