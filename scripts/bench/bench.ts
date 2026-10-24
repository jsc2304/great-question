// Measures the detect step on hand-checked transcript excerpts: whom the newest question is for, against the hand label,
// and how long the call takes through the engine. Uses the prompts in hooks/live.ts as they are, so a prompt change can
// be compared before and after. Data stays outside the repository:
//   ~/.claude/great-question/labels/backfill.jsonl  label rows (labelOf), one per detect step
//   ~/.claude/great-question/laya/eval.json         {"rows": [{"i": <row index>, "a": "me" | "all" | "other" | "none"}]}
// node --no-warnings scripts/bench/bench.ts [models, default haiku,sonnet] [runs, default 1]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IDLE, SYSTEM, detectTask, isSaid, knowledge } from '../../hooks/live.ts'

const HOME = process.env.HOME!
const DIR = `${HOME}/.claude/great-question/bench`
const models = (process.argv[2] ?? 'haiku,sonnet').split(',')
const runs = Number(process.argv[3] ?? 1)
const labels = readFileSync(`${HOME}/.claude/great-question/labels/backfill.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const hand = JSON.parse(readFileSync(`${HOME}/.claude/great-question/laya/eval.json`, 'utf8')).rows as { i: number; a: string }[]

const items = hand.flatMap(({ i }) => {
  const row = labels[i]
  const live = { ...IDLE, isOn: true, added: row.added.map((question: string) => ({ question, relevance: 3, confidence: 2, answers: [] })) }
  return models.map(model => ({ i, model, system: SYSTEM, known: knowledge(null, live), task: detectTask(row.tail, 'auto', row.me) }))
})

/** The newest question said in the new lines, and whom the model says it is for; `none` without one. */
const whom = (text: string, said: string[]) => {
  try {
    const d = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    const heard = (d.new ?? []).filter((q: any) => ['me', 'all', 'other'].includes(q.to) && isSaid(q.question, said))
    return heard.length ? heard.at(-1).to : 'none'
  } catch {
    return 'fail'
  }
}

mkdirSync(DIR, { recursive: true })
writeFileSync(`${DIR}/in.json`, JSON.stringify(items))
const answer = new Map(hand.map(r => [r.i, r.a]))
for (let run = 1; run <= runs; run++) {
  execFileSync('claude', ['-p', `/bench ${DIR}`, '--plugin-dir', `${import.meta.dirname}/plugin`, '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'], { stdio: ['ignore', 'ignore', 'inherit'] })
  const out = JSON.parse(readFileSync(`${DIR}/out.json`, 'utf8')) as { i: number; model: string; ms: number; out: number; text: string }[]
  for (const model of models) {
    const rs = out.filter(o => o.model === model).map(o => ({ ...o, a: answer.get(o.i), got: whom(o.text, labels[o.i].tail.split('\n').filter((l: string) => l.startsWith('> '))) }))
    const at = (k: 'ms' | 'out', p: number) => rs.map(r => r[k]).sort((x, y) => x - y)[Math.min(rs.length - 1, Math.floor(p * rs.length))]
    const count = (f: (r: (typeof rs)[number]) => boolean) => rs.filter(f).length
    console.log(`run ${run} ${model}: accuracy ${(count(r => r.got === r.a) / rs.length).toFixed(3)} of ${rs.length}, ` +
      `"me" found ${count(r => r.got === 'me' && r.a === 'me')}/${count(r => r.a === 'me')}, right ${count(r => r.got === 'me' && r.a === 'me')}/${count(r => r.got === 'me')}, ` +
      `no JSON ${count(r => r.got === 'fail')}, ms p50 ${at('ms', 0.5)} p90 ${at('ms', 0.9)}, output tokens p50 ${at('out', 0.5)}`)
  }
}
console.log(`always "none": ${(hand.filter(r => r.a === 'none').length / hand.length).toFixed(3)}`)
