import type { Addressee, Answer, Fact, Lang, Live, Question, QuestionSet, Risk } from '../types'

export const IDLE: Live = { isOn: false, status: '', meeting: null, lines: 0, changedAt: 0, asked: [], current: null, added: [], next: [], deep: {}, looking: [], recent: [], phase: 'idle', pending: [], currentAt: 0, steppedAt: 0 }

const RISKS: readonly Risk[] = ['sourced', 'commitment', 'vague', 'risky']
// Risk classes as stored by 0.8 and earlier, which used German names.
const OLD_RISKS: Record<string, Risk> = { belegt: 'sourced', zusage: 'commitment', vage: 'vague', riskant: 'risky' }

/** A risk class from a model reply or an older stored set; anything unknown counts as vague. */
export const asRisk = (risk: unknown): Risk =>
  RISKS.includes(risk as Risk) ? (risk as Risk) : (OLD_RISKS[String(risk)] ?? 'vague')

/** Questions from state an older version wrote: their risk classes in today's names, their notes and sources text or nothing. */
export const withRisks = (list: Question[]): Question[] => list.map(q => ({ ...q, answers: toAnswers(q.answers) }))

/** A model's free text as the pane draws it: a string, or nothing. An object drawn as text makes the engine refuse every redraw. */
export const asText = (v: unknown) => (typeof v === 'string' ? v : undefined)

const WINDOW_MS = 120_000
const MAX_LINES = 60
const MAX_NEXT = 5

// A line without a source is nobody in particular: labelled Mic, every question in it read as mine and was left out.
const SPEAKERS: Record<string, string> = { system: 'Call', mic: 'Mic' }

type Utterance = { text?: string; timestamp?: string; endRecordingMs?: number; speaker?: { source?: string } }

/**
 * Wispr's live.ndjson: a meta line, then one utterance per line. The tail is the last two minutes of the
 * recording. Names stay out; `system` is call audio, `mic` this machine's microphone (us, or a whole room).
 * Rows from `since` on are new since the last step: their texts are `fresh`, and the tail marks them with `> `.
 */
export const parseTranscript = (ndjson: string, since = 0) => {
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
  const recent = rows
    .map((u, i) => ({ u, isNew: i >= since }))
    .filter(({ u }) => !end || Number(u.endRecordingMs) >= end - WINDOW_MS)
    .slice(-MAX_LINES)

  return {
    lines: rows.length,
    tail: recent
      .map(({ u, isNew }) => `${isNew ? '> ' : ''}[${u.timestamp ?? ''}] ${SPEAKERS[u.speaker?.source ?? ''] ?? 'Unknown'}: ${u.text}`)
      .join('\n'),
    fresh: rows.slice(since).map(u => u.text!),
  }
}

const QUESTION_WORDS = 'wer|was|wann|wo|wie|warum|wieso|weshalb|welche|welcher|welches|wem|wen|wessen|who|what|when|where|why|how|which|whom'
const AUXILIARIES =
  'ist|sind|bist|seid|hast|habt|haben|hat|kannst|könnt|können|könnte|wird|werden|gibt|sollen|sollte|würde|müssen|do|does|did|is|are|was|were|can|could|will|would|should|have|has|shall'
const FILLER = 'yeah|yes|so|okay|ok|uh|um|well|and|alright|ja|also|und|äh|ähm|na|gut'
const OPENER = new RegExp(`^[\\s"'„“(-]*(?:(?:${FILLER})[\\s,.!]+)*(?:${QUESTION_WORDS}|(?:${AUXILIARIES})(?:n['’]t)?)(?!\\p{L})`, 'iu')
// After another word: a lone "Okay." is a reply, not a tag question.
const TAG = /[\p{L}\p{N}][\s,;:–-]+(?:oder|ne|gell|nicht wahr|right|okay|ok|correct)[\s.,!?…]*$/iu
const asWord = (name: string) => new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'iu')

/**
 * Whether new lines may hold a question worth a model step now: a question mark, one of my names, a question word or
 * verb at the start, or a tag such as "oder?" or "right?" at the end. Errs towards yes; the model judges the rest.
 */
// ponytail: word lists for German and English only; another meeting language waits for the STEP_MS fallback
export const isTrigger = (texts: readonly string[], names: readonly string[]) => {
  const mine = names.map(asWord)
  return texts.some(t => t.includes('?') || mine.some(n => n.test(t)) || OPENER.test(t) || TAG.test(t))
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
  'You are listening to a meeting in progress and help me anticipate the questions I will have to answer, and answer them safely. Reply with a JSON object only, no text before or after it.'

/** What I worked on last: what the prepared set says, else my latest commits found while listening. */
export const recentOf = (set: QuestionSet | null, live: Live): Fact[] => (set?.recent?.length ? set.recent : (live.recent ?? []))

/** What the model knows before it reads the transcript; `briefing` is what the repository says is current. */
export const knowledge = (set: QuestionSet | null, live: Live, briefing = '') =>
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
    '',
    'What I worked on most recently, each certainly true:',
    ...recentOf(set, live).map(f => `- ${f.text}${f.source ? ` (source: ${f.source})` : ''}`),
    ...(briefing ? ['', 'Current facts from the repository, newest first (briefing):', briefing] : []),
  ].join('\n')

/** Questions and answers in the meeting's language; who, why and notes stay English for the team. */
export const languageRule = (lang: Lang) =>
  lang === 'de'
    ? 'Write "question" and the answer "text"s in German.'
    : lang === 'en'
      ? 'Write "question" and the answer "text"s in English.'
      : 'Write "question" and the answer "text"s in the language the meeting is held in.'

/**
 * The answer options every live prompt asks for, safest first: one that is true and binds us to nothing always comes,
 * a promise only when the question asks for one. `sourced` says what counts as a source in that prompt.
 */
const answerRules = (sourced: string) => `- "sourced": ${sourced}
- "vague": true and binding us to nothing: what we know, what is still open. When nothing is sourced, the first option is this one.
- "commitment": only when the question asks for a date, an owner or a scope; never a date, name or promise nobody gave in the meeting or the material.
- "risky": at most one, as a warning of what not to say.
Only a "commitment" may promise anything: no "I will send …", "we will check …" or date in any other option.
Every option but "sourced" has a "note".`

/** The first half of a step: which questions were asked, whom they were for, what comes next; no answers, so it is quick. */
export const detectTask = (tail: string, lang: Lang = 'auto', me = '') => `The last two minutes of the transcript. I am the person this pane is for${me ? `: ${me}` : ''}. "Mic" is this computer's microphone: me in a video call, everyone in the room in an on-site meeting. "Call" is audio from the video call: everyone else. "Unknown" is anyone. Lines marked ">" are new since the last look; the others are context.
${tail}

Who a question is for:
- A line from "Mic" is me speaking.
- A question in the line right after my own turn, by the speaker who spoke before me, is probably for me.
- The transcription may mishear my name: a near spelling counts as my name.
- "you", "du" or "Sie" alone is a weak cue.

Task:
1. "asked": numbers of the questions from the question set that were asked, in substance, in this excerpt.
2. "new": questions asked in this excerpt, neither in the question set nor among those already asked (at most 3), whoever they are for.
3. "current": the question from the set or from "new" that was asked last in this excerpt: {"set": number} or {"new": index in "new"}; null only when the excerpt asks none.
4. "next": 2 to 3 questions I will most likely have to answer next, given how the conversation is going and what I worked on recently, also outside the set.
For every question in "new" and "next":
- "to": "me" (asked of me, by name, or about my ticket or my work), "all" (asked of everyone) or "other" (asked of someone else).
- "asker": who asked, as a role or the first name as heard; leave it out when unknown.
- "why": short, tied to the conversation.
- "search": 2 to 4 distinctive words likely to appear in our repository where the answer would be written (product and component names, file names, figures), in the language the repository is most likely written in.
- "relevance" 1 to 5: 5 = addressed to me by name or about my ticket or work; 4 = my topic or area; 3 = asked of everyone; 2 = someone else's topic I could add to; 1 = clearly someone else's.
- "confidence" 1 to 5: how well the material above supports a sourced answer.
No answers: a second step writes them.
Language: ${languageRule(lang)} "why" in English.
Format: {"asked": [], "new": [{"question": "", "to": "me", "asker": "", "why": "", "search": [""], "relevance": 5, "confidence": 2}], "current": null, "next": [{"question": "", "to": "all", "why": "", "search": [""], "relevance": 3, "confidence": 2}]}`

const clamp = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))
const ADDRESSEES: readonly Addressee[] = ['me', 'all', 'other']

/** Answer options from a model reply, a prepared set or older state; every caller's answers pass here before they are drawn. */
export const toAnswers = (raw: unknown): Answer[] =>
  (Array.isArray(raw) ? (raw as Answer[]) : [])
    .filter(a => typeof a?.text === 'string')
    .map(a => ({ text: a.text, risk: asRisk(a.risk), note: asText(a.note), source: asText(a.source) }))

const toQuestions = (raw: unknown, limit: number): Question[] =>
  (Array.isArray(raw) ? (raw as Question[]) : [])
    .filter(q => typeof q?.question === 'string')
    .slice(0, limit)
    .map(q => ({
      question: q.question,
      relevance: clamp(q.relevance),
      confidence: clamp(q.confidence),
      why: asText(q.why),
      to: ADDRESSEES.includes(q.to as Addressee) ? q.to : undefined,
      asker: asText(q.asker)?.trim() || undefined,
      search: Array.isArray(q.search) ? q.search.filter(t => typeof t === 'string' && t.trim()).slice(0, 4) : undefined,
      answers: toAnswers(q.answers),
    }))

/**
 * Folds one model reply into the live state; a reply that is not the asked-for JSON leaves the state as it was.
 * The catalogue only grows: new rows go to the end, a row keeps its wording, nothing is dropped but a prediction.
 * Rows still without answers wait in `pending` for the answer step.
 */
export const applyReply = (live: Live, set: QuestionSet | null, reply: string, now = 0): Live => {
  let data: { asked?: unknown; new?: unknown; current?: { set?: unknown; new?: unknown } | null; next?: unknown }
  try {
    data = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))
  } catch {
    return live
  }
  const questions = set?.questions ?? []
  const isKnown = (q: string, list: Question[]) => list.some(k => isSameQuestion(k.question, q))

  const fresh = toQuestions(data.new, 3).map(q => ({ ...q, heardAt: now }))
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
  // Without a usable pick, the question this reply saw asked last stands in: keeping the old one left it on screen for good.
  const seen = [...added.slice(live.added.length).map(q => q.question), ...[...asked].filter(q => !live.asked.includes(q))].at(-1)
  const current = picked ? asListed(picked) : (seen ?? live.current)
  if (current) asked.add(current)

  // Predictions stay until asked; new ones join at the end, and past MAX_NEXT the oldest not predicted again goes.
  const isAsked = (q: string) => [...asked].some(a => isSameQuestion(a, q)) || isKnown(q, added)
  const predicted = toQuestions(data.next, 3).map(q => ({ ...q, heardAt: now })).filter(q => !isAsked(q.question) && !isKnown(q.question, questions))
  const next = live.next.filter(q => !isAsked(q.question))
  const confirmed = new Set(next.filter(q => isKnown(q.question, predicted)).map(q => q.question))
  for (const q of predicted) if (!isKnown(q.question, next)) next.push(q)
  while (next.length > MAX_NEXT) {
    const stale = next.findIndex(q => !confirmed.has(q.question))
    next.splice(stale === -1 ? 0 : stale, 1)
  }

  const pending = [...added, ...next].filter(q => !q.answers.length).map(q => q.question)
  const currentAt = current !== live.current ? now : live.currentAt
  return { ...live, asked: [...asked], current, added, next, pending, phase: pending.length ? 'answering' : 'ready', currentAt, steppedAt: now }
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

/** The second half of a step: answers for the questions still waiting, from the repository's lines and what the knowledge says. */
export const ground = (items: readonly { question: string; hits: string[] }[], lang: Lang) => `Questions from the meeting, each with lines from our repository (path:line: text):

${items.map((it, i) => `${i}: ${it.question}\n${it.hits.length ? it.hits.join('\n') : 'no lines found'}`).join('\n\n')}

For every question, 2 to 3 answer options, safest first, each with "risk":
${answerRules('only when the lines above, the question set, my recent work or the briefing carry the answer; "source" is the path:line or the source named there.')}
Language: ${languageRule(lang)} "note" in English.
Format: {"answers": {"0": [{"text": "", "risk": "sourced", "source": "path:12", "note": ""}]}}, keyed by the question's number; leave out a question you cannot answer.`

const parse = (reply: string) => JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as { answers?: unknown }

/**
 * Puts the answer step's answers on their rows; a sourced one lifts its confidence. An answered question leaves
 * `pending`; one the model left out stays there for the next step.
 */
export const applyAnswers = (live: Live, questions: readonly string[], reply: string): Live => {
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
  const pending = live.pending.filter(q => !found.has(q))
  return { ...live, added: live.added.map(swap), next: live.next.map(swap), pending, phase: pending.length ? 'answering' : 'ready' }
}

/** The task for a read-only subagent that looks a question up in the repository while the meeting goes on. */
export const lookupPrompt = (question: string, lang: Lang) => `Someone in a meeting just asked us: "${question}"
Find the answer in this repository: search with Grep and Glob, then read what you find. Change nothing.
Reply with a JSON object only: {"answers": [{"text": "", "risk": "sourced", "source": "path:line", "note": ""}]} with 1 to 3 answers, safest first, each with "risk":
${answerRules('only for an answer a file you read carries; "source" is its path:line.')}
${languageRule(lang)} "note" in English.`

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

/** Name and email from `git var GIT_AUTHOR_IDENT`; null when the output is not that. */
export const parseIdent = (out: string | null) => {
  const m = /^(.+?) <([^>]+)>/.exec(out ?? '')
  return m ? { name: m[1]!, email: m[2]! } : null
}

/** My last five commits on any branch, merges left out: what I worked on last, whatever the meeting asks. */
export const logArgs = (email: string) => ['log', '--branches', '--remotes', '--no-merges', '-F', `--author=${email}`, '-n', '5', '--format=%h%x09%as%x09%s']

export const parseLog = (out: string | null): Fact[] =>
  (out ?? '')
    .split('\n')
    .map(line => line.split('\t'))
    .filter(p => p.length >= 3 && p.slice(2).join('\t').trim())
    .map(([sha, date, ...subject]) => ({ text: subject.join('\t').trim(), source: `commit ${sha}, ${date}` }))

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
