// Read the family name (name table, ID 1) from a .ttf/.otf so libass can find the font
export function fontFamily(buf: ArrayBuffer): string | null {
  const v = new DataView(buf), n = v.getUint16(4)
  let off = 0
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16
    if (String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3)) === 'name') { off = v.getUint32(p + 8); break }
  }
  if (!off) return null
  const cnt = v.getUint16(off + 2), so = off + v.getUint16(off + 4)
  for (let i = 0; i < cnt; i++) {
    const r = off + 6 + i * 12
    if (v.getUint16(r + 6) !== 1) continue
    const len = v.getUint16(r + 8), o = so + v.getUint16(r + 10), wide = v.getUint16(r) !== 1
    let s = ''
    for (let k = 0; k < len; k += wide ? 2 : 1) s += String.fromCharCode(wide ? v.getUint16(o + k) : v.getUint8(o + k))
    if (s) return s
  }
  return null
}
