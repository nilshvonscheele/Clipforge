export type Cfg = { provider: 'anthropic' | 'openai'; key: string; model: string }
export const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini' }
export type Meta = { title: string; desc: string; tags: string }

// Calls go straight from the browser to the provider with the user's own key (never to our server: there is none)
async function ask(c: Cfg, system: string, user: string): Promise<string> {
  if (c.provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }) })
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message ?? 'LLM error')
    return d.content[0].text
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
    headers: { Authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
  const d = await r.json(); if (!r.ok) throw new Error(d.error?.message ?? 'LLM error')
  return d.choices[0].message.content
}
const parse = (s: string) => JSON.parse(s.replace(/```json|```/g, '').trim())

export async function rescore(c: Cfg, clips: { text: string }[]): Promise<{ score: number; why: string }[]> {
  const out = parse(await ask(c,
    'You rate candidate clips for TikTok/Reels/Shorts. Score each 0-100 on hook strength, emotional peaks, completeness of the thought and standalone clarity. Reply ONLY with a JSON array [{"i":0,"score":80,"why":"max 12 words, in the clip\'s language"}].',
    clips.map((x, i) => `#${i}: ${x.text.slice(0, 700)}`).join('\n\n')))
  return clips.map((_, i) => out.find((o: any) => o.i === i) ?? { score: 0, why: '' })
}
export async function genMeta(c: Cfg, text: string): Promise<Meta> {
  return parse(await ask(c, 'You write social media metadata for a short vertical video. Reply ONLY with JSON {"title":"max 60 chars","desc":"max 150 chars incl. a call to action","tags":"#a #b #c #d #e"}. Use the transcript\'s language.', text.slice(0, 1500)))
}

const STOP = new Set('och att det som är på av för med till den har de inte om ett men var jag vi du han hon så kan ska vill från eller när hur vad här där också bara mycket the and that this with have for you are was but not they from what about there their would which just like your will been were when them into than then some more very'.split(' '))
export function templateMeta(text: string, lang: 'sv' | 'en'): Meta {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s)
  const sents = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  const title = cut((sents[0] ?? text).replace(/[.!?]+$/, ''), 60)
  const freq = new Map<string, number>()
  text.toLowerCase().match(/\p{L}{5,}/gu)?.forEach(w => { if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1) })
  const tags = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => '#' + w).concat(['#shorts', '#reels', '#fyp']).join(' ')
  return { title: title.charAt(0).toUpperCase() + title.slice(1), desc: cut(sents.slice(0, 2).join(' '), 150) + (lang === 'sv' ? ' Följ för mer!' : ' Follow for more!'), tags }
}
