import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
let ff: FFmpeg | null = null
export async function getFF() {
  if (ff) return ff
  ff = new FFmpeg()
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
  await ff.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm') })
  return ff
}
// Mount the File lazily (WORKERFS): ffmpeg reads it in pieces, so big videos are never copied into memory
export async function mountFile(f: FFmpeg, file: File) {
  await f.createDir('/work').catch(() => {})
  await f.mount('WORKERFS' as any, { files: [new File([file], 'input.mp4')] }, '/work')
  return '/work/input.mp4'
}
export const unmount = (f: FFmpeg) => f.unmount('/work').catch(() => {})
