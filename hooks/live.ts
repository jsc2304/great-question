import type { Answer, Lang, Live, Question, QuestionSet, Risk } from '../types'

export const IDLE: Live = { isOn: false, status: '', meeting: null, lines: 0, changedAt: 0, asked: [], current: null, added: [], next: [], deep: {}, looking: [] }

const RISKS: readonly Risk[] = ['sourced', 'commitment', 'vague', 'risky']
// Risk classes as stored by 0.8 and earlier, which used German names.
const OLD_RISKS: Record<string, Risk> = { belegt: 'sourced', zusage: 'commitment', vage: 'vague', riskant: 'risky' }

/** A risk class from a model reply or an older stored set; anything unknown counts as vague. */
export const asRisk = (risk: unknown): Risk =>
  RISKS.includes(risk as Risk) ? (risk as Risk) : (OLD_RISKS[String(risk)] ?? 'vague')

/** Questions from state an older version wrote: their risk classes in today's names. */
export const withRisks = (list: Question[]): Question[] =>
  list.map(q => ({ ...q, answers: q.answers.map(a => ({ ...a, risk: asRisk(a.risk) })) }))
const WINDOW_MS = 120_000
const MAX_LINES = 60
const MAX_NEXT = 5

type Utterance = { text?: string; timestamp?: string; endRecordingMs?: number; speaker?: { source?: string } }

/**
 * Wispr's live.ndjson: a meta line, then one utterance per line. The tail is the last two minutes of the
 * recording. Names stay out; `system` is call audio, `mic` this machine's microphone (us, or a whole room).
 */
export const parseTranscript = (ndjson: string) => {
  const rows = ndjson
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line) as Utterance
      } catch {
        return null
      }
    })
    .filter((u): u is Utterance => typeof u?.text === 'string')
  const end = Number(rows.at(-1)?.endRecordingMs) || 0
  const recent = rows.filter(u => !end || Number(u.endRecordingMs) >= end - WINDOW_MS).slice(-MAX_LINES)

  return {
    lines: rows.length,
    tail: recent
      .map(u => `[${u.timestamp ?? ''}] ${u.speaker?.source === 'system' ? 'Call' : 'Mic'}: ${u.text}`)
      .join('\n'),
  }
}

/** A row's address, from its text: focus and open state stay with the question when rows around it change. */
export const rowKey = (question: string) => {
  let h = 5381
  for (const c of question) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return `q:${h.toString(36)}`
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2),
  )

// ponytail: word overlap catches the model rewording a question between steps; embeddings if it misses too much
export const isSameQuestion = (a: string, b: string) => {
  if (a.toLowerCase() === b.toLowerCase()) return true
  const x = words(a)
  const y = words(b)
  const shared = [...x].filter(w => y.has(w)).length
  return x.size > 0 && y.size > 0 && shared / (x.size + y.size - shared) >= 0.7
}

export const SYSTEM =
  'You are listening to a meeting in progress and help our team anticipate the other side\'s questions and answer them well. Reply with a JSON object only, no text before or after it.'

export const knowledge = (set: QuestionSet | null, live: Live) =>
  [
    set && set.questions.length
      ? [
          'Prepared question set with sourced answers (number: question | answers with risk):',
          ...set.questions.map(
            (q, i) =>
              `${i}: ${q.question} | ${q.answers.map(a => `[${a.risk}] ${a.text}${a.source ? ` (source: ${a.source})` : ''}`).join(' / ')}`,
          ),
        ].join('\n')
      : 'No prepared question set.',
    '',
    'Questions already asked in the meeting that are not in the set:',
    ...(live.added.length ? live.added.map(q => `- ${q.question}`) : ['- none']),
  ].join('\n')

/** Questions and answers in the meeting's language; who, why and notes stay English for the team. */
export const languageRule = (lang: Lang) =>
  lang === 'de'
    ? 'Write "question" and the answer "text"s in German.'
    : lang === 'en'
      ? 'Write "question" and the answer "text"s in English.'
      : 'Write "question" and the answer "text"s in the language the meeting is held in.'

export const task = (tail: string, lang: Lang = 'auto') => `The last two minutes of the transcript. "Call" is audio from the video call (the other side), "Mic" is this computer's microphone: our team, but in an on-site meeting everyone in the room. Decide who asks from the content, not from the label alone.
${tail}

Task:
1. "asked": numbers of the questions from the question set that were asked, in substance, in this excerpt.
2. "new": questions asked in this excerpt that are neither in the question set nor among those already asked (at most 3).
3. "current": the most recently asked question that is being answered or still open: {"set": number}, {"new": index in "new"} or null.
4. "next": 2 to 3 questions the other side is most likely to ask next, given how the conversation is going, also outside the set.
5. For every question in "new" and "next": "search", 2 to 4 distinctive words likely to appear in our repository where the answer would be written (product and component names, file names, figures), in the language the repository is most likely written in.
Language: ${languageRule(lang)} "why" and "note" in English.
For every question in "new" and "next": relevance and confidence (1 to 5), "why" (short, tied to the conversation) and 2 to 3 answer options with "risk": "sourced" only when the answer is in the question set in substance (then "source" as there); otherwise "vague", "commitment" or "risky", each with a "note".
Format: {"asked": [], "new": [], "current": null, "next": [{"question": "", "relevance": 3, "confidence": 2, "why": "", "search": [""], "answers": [{"text": "", "risk": "vague", "note": ""}]}]}`

const clamp = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))

const toAnswers = (raw: unknown): Answer[] =>
  (Array.isArray(raw) ? (raw as Answer[]) : [])
    .filter(a => typeof a?.text === 'string')
    .map(a => ({ text: a.text, risk: asRisk(a.risk), note: a.note, source: a.source }))

const toQuestions = (raw: unknown, limit: number): Question[] =>
  (Array.isArray(raw) ? (raw as Question[]) : [])
    .filter(q => typeof q?.question === 'string')
    .slice(0, limit)
    .map(q => ({
      question: q.question,
      relevance: clamp(q.relevance),
      confidence: clamp(q.confidence),
      why: typeof q.why === 'string' ? q.why : undefined,
      search: Array.isArray(q.search) ? q.search.filter(t => typeof t === 'string' && t.trim()).slice(0, 4) : undefined,
      answers: toAnswers(q.answers),
    }))

/**
 * Folds one model reply into the live state; a reply that is not the asked-for JSON leaves the state as it was.
 * The catalogue only grows: new rows go to the end, a row keeps its wording, nothing is dropped but a prediction.
 */
export const applyReply = (live: Live, set: QuestionSet | null, reply: string): Live => {
  let data: { asked?: unknown; new?: unknown; current?: { set?: unknown; new?: unknown } | null; next?: unknown }
  try {
    data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
  } catch {
    return live
  }
  const questions = set?.questions ?? []
  const isKnown = (q: string, list: Question[]) => list.some(k => isSameQuestion(k.question, q))

  const fresh = toQuestions(data.new, 3)
  const added = [...live.added]
  for (const q of fresh) if (!isKnown(q.question, [...questions, ...added])) added.push(q)

  const asked = new Set(live.asked)
  for (const n of Array.isArray(data.asked) ? data.asked : []) {
    const q = questions[Number(n)]
    if (q) asked.add(q.question)
  }

  const pick = data.current
  // A new question matched to one already listed takes that row's wording, so it points at a row on screen.
  const asListed = (q: string) => [...questions, ...added].find(k => isSameQuestion(k.question, q))?.question ?? q
  const picked =
    (pick && typeof pick.set === 'number' && questions[pick.set]?.question) ||
    (pick && typeof pick.new === 'number' && fresh[pick.new]?.question) ||
    null
  const current = picked ? asListed(picked) : live.current
  if (current) asked.add(current)

  // Predictions stay until asked; new ones join at the end, and past MAX_NEXT the oldest not predicted again goes.
  const isAsked = (q: string) => [...asked].some(a => isSameQuestion(a, q)) || isKnown(q, added)
  const predicted = toQuestions(data.next, 3).filter(q => !isAsked(q.question) && !isKnown(q.question, questions))
  const next = live.next.filter(q => !isAsked(q.question))
  const confirmed = new Set(next.filter(q => isKnown(q.question, predicted)).map(q => q.question))
  for (const q of predicted) if (!isKnown(q.question, next)) next.push(q)
  while (next.length > MAX_NEXT) {
    const stale = next.findIndex(q => !confirmed.has(q.question))
    next.splice(stale === -1 ? 0 : stale, 1)
  }

  return { ...live, asked: [...asked], current, added, next }
}

const MAX_HITS = 8

/** git grep for a question's words in the session's repository; this mod's exports stay out, they hold earlier answers. */
export const grepArgs = (terms: readonly string[]) => [
  'git', 'grep', '-n', '-I', '-i', '-F', '--max-count=3',
  ...terms.flatMap(t => ['-e', t]),
  '--', '.', ':(exclude)question-sets', ':(exclude)fragensets',
]

/** The matching lines as `path:line: text`, files that hit the most words first, cut so a prompt stays small. */
export const topHits = (stdout: string, terms: readonly string[]) => {
  const byFile = new Map<string, string[]>()
  for (const line of stdout.split('\n')) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line)
    if (!m) continue
    byFile.set(m[1]!, [...(byFile.get(m[1]!) ?? []), `${m[1]}:${m[2]}: ${m[3]!.trim().slice(0, 200)}`])
  }
  const words = (lines: string[]) => terms.filter(t => lines.some(l => l.toLowerCase().includes(t.toLowerCase()))).length
  return [...byFile.values()].sort((a, b) => words(b) - words(a)).flat().slice(0, MAX_HITS)
}

export const GROUND_SYSTEM = 'You answer questions from a meeting with lines from our repository. Reply with a JSON object only, no text before or after it.'

export const ground = (items: readonly { question: string; hits: string[] }[], lang: Lang) => `Questions from the meeting, each with lines from our repository (path:line: text):

${items.map((it, i) => `${i}: ${it.question}\n${it.hits.join('\n')}`).join('\n\n')}

For every question, 2 to 3 answer options, each with "risk": "sourced" only when the lines above carry the answer, then "source" is the path:line it rests on; otherwise "vague", "commitment" or "risky", each with a "note".
Language: ${languageRule(lang)} "note" in English.
Format: {"answers": {"0": [{"text": "", "risk": "sourced", "source": "path:12", "note": ""}]}}, keyed by the question's number; leave out a question you cannot answer.`

const parse = (reply: string) => JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as { answers?: unknown }

/** Puts the answers a repository search grounded in place of a live question's own; a sourced one lifts its confidence. */
export const applyGrounding = (live: Live, questions: readonly string[], reply: string): Live => {
  let lists: Record<string, unknown>
  try {
    const raw = parse(reply).answers
    // A list by position only counts when it holds one entry per question: a short one would shift answers onto the wrong row.
    lists = Array.isArray(raw) ? (raw.length === questions.length ? { ...raw } : {}) : raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  } catch {
    return live
  }
  const found = new Map(questions.map((q, i) => [q, toAnswers(lists[i])] as const).filter(([, a]) => a.length > 0))
  const swap = (q: Question): Question => {
    const answers = found.get(q.question)
    if (!answers) return q
    const isSourced = answers.some(a => a.risk === 'sourced')
    return { ...q, answers, confidence: isSourced ? Math.max(q.confidence ?? 1, 4) : q.confidence }
  }
  return { ...live, added: live.added.map(swap), next: live.next.map(swap) }
}

/** The task for a read-only subagent that looks a question up in the repository while the meeting goes on. */
export const lookupPrompt = (question: string, lang: Lang) => `Someone in a meeting just asked us: "${question}"
Find the answer in this repository: search with Grep and Glob, then read what you find. Change nothing.
Reply with a JSON object only: {"answers": [{"text": "", "risk": "sourced", "source": "path:line", "note": ""}]} with 1 to 3 answers. "sourced" only for an answer a file you read carries, with its path and line; otherwise "vague", "commitment" or "risky", each with a "note". ${languageRule(lang)} "note" in English.`

/** The answers in a subagent's reply; nothing when it is not the asked-for JSON. */
export const parseAnswers = (reply: string): Answer[] => {
  try {
    return toAnswers(parse(reply).answers)
  } catch {
    return []
  }
}

/** A finished lookup: no longer running, and its answers, if any, stand in for the question's own. */
export const settleLookup = (live: Live, question: string, reply: string | null): Live => {
  const answers = reply === null ? [] : parseAnswers(reply)
  return {
    ...live,
    looking: live.looking.filter(q => q !== question),
    deep: answers.length ? { ...live.deep, [question]: answers } : live.deep,
  }
}

/** GitHub's https address of a repository from its origin remote; null for any other remote. */
export const githubBase = (remote: string | null) => {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote ?? '')
  return m ? `https://github.com/${m[1]}/${m[2]}` : null
}

/** What a source label points at: a URL, an issue in a named or the session's repository, or a file with its line. */
export type SourceRef = { url: string } | { repo: string; issue: string } | { issue: string } | { path: string; line?: string }

export const parseSource = (label: string): SourceRef | null => {
  const url = /https:\/\/[^\s)]+/.exec(label)
  if (url) return { url: url[0].replace(/[.,;]+$/, '') }
  const ticket = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/.exec(label)
  if (ticket) return { repo: ticket[1]!, issue: ticket[2]! }
  const own = /(?:^|\s)#(\d+)\b/.exec(label)
  if (own) return { issue: own[1]! }
  const file = /(?:^|[\s(])((?:[\w.-]+\/)*[\w-][\w.-]*\.[a-z]{1,6})(?::(\d+))?\b/i.exec(label)
  return file ? { path: file[1]!, line: file[2] } : null
}
