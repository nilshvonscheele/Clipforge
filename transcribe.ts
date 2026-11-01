import { pipeline } from '@huggingface/transformers'
import { getFF, mountFile, unmount } from './ff'
export type Word = { text: string; start: number; end: number }

// Decode + resample to 16 kHz mono in the browser (no upload anywhere)
async function toPcm(file: File): Promise<Float32Array> {
  if (file.size > 100e6) { // big file: ffmpeg.wasm streams the audio out of the mounted file
    const f = await getFF()
    await f.exec(['-i', await mountFile(f, file), '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'a.raw'])
    const d = (await f.readFile('a.raw')) as Uint8Array
    await f.deleteFile('a.raw'); await unmount(f)
    const i16 = new Int16Array(d.buffer, d.byteOffset, d.byteLength >> 1), out = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768
    return out
  }
  const ctx = new AudioContext({ sampleRate: 16000 })
  const audio = await ctx.decodeAudioData(await file.arrayBuffer())
  await ctx.close()
  return audio.getChannelData(0)
}

let asr: any
export async function transcribe(file: File, onStatus: (s: string, pct?: number) => void): Promise<Word[]> {
  onStatus('model')
  asr ??= await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
    progress_callback: (p: any) => p.status === 'progress' && onStatus('model', p.progress),
  })
  onStatus('audio')
  const pcm = await toPcm(file)
  onStatus('transcribe')
  // No language set => Whisper auto-detects (Swedish, English, ...)
  const out = await asr(pcm, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 })
  return (out.chunks as any[]).map(c => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
}
