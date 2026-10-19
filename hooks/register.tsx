import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Addressee, Answer, Fact, Lang, Quality, Live, Question, QuestionSet, Risk, Source, SourceKind } from '../types'
import {
  GROUND_SYSTEM,
  IDLE,
  SYSTEM,
  applyAnswers,
  applyReply,
  asText,
  detectTask,
  githubBase,
  grepArgs,
  ground,
  isTrigger,
  knowledge,
  languageRule,
  logArgs,
  lookupPrompt,
  parseIdent,
  parseLog,
  parseTranscript,
  recentOf,
  rowKey,
  parseSource,
  settleLookup,
  toAnswers,
  topHits,
  withRisks,
} from './live'

const PANE = 'great-question'
const TOOL = 'mcp__great-question__show_questions'
const current = atom({ plugin: 'great-question', key: 'set' } as const, null)
// Keyed by question text, so a row keeps its state while predictions and groups reshuffle around it.
const opened = atom({ plugin: 'great-question', key: 'open' } as const, [])
// While a row is open the live sections stand still; new rows wait behind the "take new" button.
const held = atom({ plugin: 'great-question', key: 'held' } as const, null)
const more = atom({ plugin: 'great-question', key: 'more' } as const, false)
// A background agent is finding likely questions: since when, for which occasion. `tick` drives its spinner.
const preparing = atom({ plugin: 'great-question', key: 'preparing' } as const, null)
const tick = atom({ plugin: 'great-question', key: 'tick' } as const, 0)
// Where sources point, by label, worked out with git when questions arrive; '' for nowhere. Read while drawing.
const links = atom({ plugin: 'great-question', key: 'links' } as const, {})
// meeting: surest answers first, to answer from; practice: weakest first, to practise.
const view = atom({ plugin: 'great-question', key: 'view' } as const, 'meeting')
const live = atom({ plugin: 'great-question', key: 'live' } as const, IDLE)
// confidence: grouped by answer confidence; likelihood: grouped by how likely the question comes. Relevance leads inside a group.
const sortBy = atom({ plugin: 'great-question', key: 'sortBy' } as const, 'confidence')
// Language of new questions and answers; nothing already shown is translated.
const lang = atom({ plugin: 'great-question', key: 'lang' } as const, 'auto')
const LANGS: Lang[] = ['auto', 'de', 'en']
const version = atom({ plugin: 'great-question', key: 'version' } as const, '')
// Sections folded the other way round from their default; see `isUnfolded` in the pane.
const toggled = atom({ plugin: 'great-question', key: 'toggled' } as const, [])

// How often listening looks at the transcript; Wispr writes a line about a second after it was said.
const TICK_MS = 3_000
// New lines without a question mark, my name or a question's opening wait this long for a model step.
const STEP_MS = 12_000
const LINK_MS = 20_000
const BRIEF_MS = 60_000
// A step whose model call failed waits this long before the same lines try again.
const RETRY_MS = 6_000
// A recording counts as running while Wispr wrote its live transcript this recently.
const FRESH_MS = 3 * 60_000
const quality = atom({ plugin: 'great-question', key: 'quality' } as const, 'fast')
// Who answers live and how hard it thinks. A slower level answers later: a step still running when the next is due skips it.
// A completion has no time limit of its own: one that never answered held the listening step, and every later one, for good.
const QUALITY: Record<Quality, { label: string; model: string; effort?: 'low' | 'high'; timeoutMs: number }> = {
  fast: { label: 'Fast (Haiku)', model: 'haiku', timeoutMs: 30_000 },
  balanced: { label: 'Balanced (Sonnet, low)', model: 'sonnet', effort: 'low', timeoutMs: 45_000 },
  thorough: { label: 'Thorough (Sonnet, high)', model: 'sonnet', effort: 'high', timeoutMs: 90_000 },
}
const QUALITIES = Object.keys(QUALITY) as Quality[]
// Reads that come from an older version or a hand edit fall back to the fast level.
const levelOf = async ($: EngineInterface) => QUALITY[await read($, quality)] ?? QUALITY.fast

// Display order: safest first, so the answer to give leads and the warning closes. A thin answer that binds us to
// nothing comes before a promise: a closed row's one-line answer is never a commitment while a safer one exists.
// `action` says what to do with the answer in the room; `label` is the risk class.
const RISKS: Record<Risk, { mark: string; label: string; action: string; color: string }> = {
  sourced: { mark: '●', label: 'sourced', action: 'SAY IT', color: 'success' },
  vague: { mark: '○', label: 'vague', action: 'WEAK', color: 'inactive' },
  commitment: { mark: '▲', label: 'commitment', action: 'ONLY IF COVERED', color: 'warning' },
  risky: { mark: '✖', label: 'risky', action: "DON'T SAY", color: 'error' },
}
const ORDER = Object.keys(RISKS) as Risk[]
// The card's label by who the question is for; unknown reads ASKED NOW.
const TO: Record<Addressee, string> = { me: 'ASKED OF YOU', all: 'ASKED · EVERYONE', other: 'ASKED · SOMEONE ELSE' }
// UP NEXT draws this many; more would bury the next one.
const MAX_SHOWN_NEXT = 3

// Grouped by answer confidence, surest first; relevance breaks ties.
const GROUPS = [
  { label: 'Safe to answer', min: 5 },
  { label: 'Well sourced', min: 4 },
  { label: 'Partly sourced', min: 3 },
  { label: 'Unsure', min: 1 },
]

// Sets stored before `confidence` existed: a sourced answer counts as well covered.
const LIKELY_GROUPS = [
  { label: 'Very likely', min: 5 },
  { label: 'Likely', min: 4 },
  { label: 'Possible', min: 3 },
  { label: 'Rather rare', min: 1 },
]

const confidenceOf = (q: Question) => q.confidence ?? (q.answers.some(a => a.risk === 'sourced') ? 4 : 2)
const bySurest = (a: Question, b: Question) => confidenceOf(b) - confidenceOf(a) || b.relevance - a.relevance

const SCHEMA = {
  type: 'object',
  required: ['title', 'mode', 'questions'],
  properties: {
    title: { type: 'string', description: 'Occasion, e.g. "Customer pitch, 14.10." or "Daily 13.10."' },
    language: { type: 'string', enum: ['de', 'en'], description: 'Language the questions and answers are written in' },
    mode: { type: 'string', enum: ['pitch', 'meeting', 'standup'] },
    sources: {
      type: 'array',
      description: 'Sources read, each with its origin',
      items: {
        type: 'object',
        required: ['kind', 'label'],
        properties: {
          kind: {
            type: 'string',
            enum: ['meeting', 'repo', 'ticket', 'doc', 'calendar', 'other'],
            description: 'meeting: meeting notes and transcripts; repo: files in the repository; ticket: issues, pull requests, Jira; doc: documents outside the repository (Drive, offer, mail); calendar: appointments; other: the rest',
          },
          label: { type: 'string', description: 'What exactly, e.g. file path, meeting with date, ticket number' },
        },
      },
    },
    recent: {
      type: 'array',
      description: 'What I (the person preparing) worked on most recently, newest first: each one sentence that is certainly true and can be said in any meeting',
      items: {
        type: 'object',
        required: ['text', 'source'],
        properties: {
          text: { type: 'string' },
          source: { type: 'string', description: 'The commit, pull request, ticket or meeting with date that shows it' },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'relevance', 'confidence', 'answers'],
        properties: {
          question: { type: 'string' },
          relevance: { type: 'integer', minimum: 1, maximum: 5, description: 'Likelihood × weight, 5 = highest' },
          confidence: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: 'Answer confidence: how well the documents support a sourced answer; 5 = firm, sourced answer, 1 = no reliable answer',
          },
          who: { type: 'string', description: 'Who on the other side is likely to ask, as a role without names' },
          why: { type: 'string', description: 'Why we expect the question: trigger or evidence (slide, gap, objection, earlier meeting)' },
          answerer: {
            type: 'string',
            description: 'Who on our side answers, per briefing, speaker plan or responsibility; leave out when the documents name nobody',
          },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'risk'],
              properties: {
                text: { type: 'string' },
                risk: { type: 'string', enum: ['sourced', 'vague', 'commitment', 'risky'] },
                note: { type: 'string', description: 'What to watch out for' },
                source: { type: 'string', description: 'Evidence (slide, document, figure)' },
              },
            },
          },
        },
      },
    },
  },
}

// How the prepared questions come back: from a background agent as its reply, from the session through the tool.
const REPLY_AS_JSON = `Reply with one JSON object only, no text before or after it, in this shape (JSON Schema): ${JSON.stringify(SCHEMA)}`
const CALL_THE_TOOL = `Load the tool ${TOOL} with ToolSearch and call it with the result. Afterwards, only one line in the chat.`

const prepPrompt = (occasion: string, language: Lang, finish: string) => `Great Question: find the likely questions${occasion ? ` for: ${occasion}` : ''}.

Language: ${language === 'auto' ? 'Write "question" and the answer "text"s in the language the meeting is held in (invitation, slides, earlier transcripts with the other side); if unsure, German.' : languageRule(language)} who, why, answerer, note and title in English. Return the language used as "language".

1. Choose the mode. Is a pitch, presentation or meeting coming up (slides, pitch preparation, agenda, calendar entry, occasion above)? Then "pitch" or "meeting". Otherwise "standup": daily stand-up preparation from the commits and pull requests of the last working days, open and own issues/tickets, blockers.
2. Gather context, only from sources you read in this session: README, slides and speaker notes, Q&A/FAQ preparation, offer, decisions, open risks, issues; connected sources (Jira, Drive) where they fit the occasion. Project rules (AGENTS.md, CLAUDE.md) apply.
   Meeting transcripts from Wispr Flow, if connected: find matching meetings with search_meetings (title, attendees, period; the search only matches title and summary, not the transcript), then read get_meeting with view_transcript, not just the notes. What matters: earlier meetings with the other side (which questions and objections came up, what was promised) and internal preparation rounds (open points, agreements). Find the upcoming meeting and its attendees with list_upcoming_meetings. For "standup", the meetings since the last working day. If the other side asked a question before, its relevance rises; name the meeting and date in why.
3. 8 to 15 questions the other side is most likely to ask, with relevance 1 to 5 (likelihood × weight) and confidence 1 to 5 (how well our documents support a sourced answer; 5 = firm, sourced answer, 1 = no reliable answer, open points lower it). Per question: who (who on the other side asks, as a role, no names of customer people), why (why we expect the question), answerer (who on our side answers, only when a briefing, speaker plan or responsibility names them), 2 to 4 answer options, each with a risk:
   - sourced: well founded, source in "source" (slide, document, figure); low risk
   - vague: harmless and shallow; low risk, but weak
   - commitment: binds us (date, price, scope, people); only when the documents cover it
   - risky: unsupported, contradicts the documents or is attackable; as a warning of what not to say
   Optional "note": what to watch out for.
4. "recent": 3 to 6 things I (the person preparing: the git user, my own tickets) did most recently, newest first, in the language of the answers. Each one sentence I can say in any meeting whatever is asked, and certainly true: only what a commit, pull request, ticket or meeting you read shows, with it as "source".
5. ${finish}`

const storeKey = async ($: EngineInterface) => `set:${await $.session.cwd()}`

/** One git command's output, trimmed; null when git says no. A command that cannot run at all throws. */
const git = async ($: EngineInterface, args: readonly string[], cwd: string) => {
  const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
  return ran.exitCode === 0 ? ran.stdout.trim() : null
}

/**
 * A source's https address: a URL as is, an issue, or a file that exists here and in its repository's default branch
 * on GitHub, at its line. A label's path is relative to the session's folder, which need not be a repository's root.
 */
const resolveLink = async ($: EngineInterface, label: string, cwd: string): Promise<string | null> => {
  const ref = parseSource(label)
  if (!ref) return null
  if ('url' in ref) return ref.url
  if ('repo' in ref) return `https://github.com/${ref.repo}/issues/${ref.issue}`
  if ('issue' in ref) {
    const base = githubBase(await git($, ['remote', 'get-url', 'origin'], cwd))
    return base && `${base}/issues/${ref.issue}`
  }
  const abs = ref.path.startsWith('/') ? ref.path : `${cwd}/${ref.path}`
  if (!(await $.fs.exists(abs))) return null
  const root = await git($, ['rev-parse', '--show-toplevel'], abs.slice(0, abs.lastIndexOf('/')))
  if (!root || !abs.startsWith(`${root}/`)) return null
  const base = githubBase(await git($, ['remote', 'get-url', 'origin'], root))
  if (!base) return null
  const rel = abs.slice(root.length + 1)
  // Only a file the remote has: one that exists just locally, or on a local branch, would 404 on GitHub.
  for (const ref_ of ['origin/HEAD', 'origin/main', 'origin/master']) {
    if ((await git($, ['cat-file', '-e', `${ref_}:${rel}`], root)) !== null) return `${base}/blob/HEAD/${rel}${ref.line ? `#L${ref.line}` : ''}`
  }
  return null
}

// Labels being resolved now, so a redraw does not start them twice; whether a failure was reported this session.
const resolving = new Set<string>()
let isFailureLogged = false

/**
 * Works out the links of labels not seen yet and keeps them, so drawing only looks them up. A label whose lookup
 * failed (git could not run) is not kept, so the next drawing tries again.
 */
const linkAll = async ($: EngineInterface, labels: readonly (string | undefined)[], folder?: string) => {
  // Paths count from the folder the questions were prepared in: the session's own moves with its shell.
  const cwd = folder ?? (await $.session.cwd())
  const known = await read($, links)
  const fresh = [...new Set(labels.filter((l): l is string => !!l))].filter(l => !(l in known) && !resolving.has(l))
  if (!fresh.length) return
  fresh.forEach(l => resolving.add(l))
  const found: [string, string][] = []
  for (const l of fresh) {
    try {
      found.push([l, (await resolveLink($, l, cwd)) ?? ''])
    } catch (err) {
      if (!isFailureLogged) $.ui.log(`Great Question: could not resolve source links: ${String(err).slice(0, 200)}`)
      isFailureLogged = true
    } finally {
      resolving.delete(l)
    }
  }
  if (found.length) await update($, links, k => ({ ...k, ...Object.fromEntries(found) }))
}

const answerSources = (questions: readonly Question[]) => questions.flatMap(q => q.answers.map(a => a.source))
const setLabels = (set: QuestionSet) => [...set.sources.map(src => asSource(src).label), ...answerSources(set.questions), ...(set.recent ?? []).map(f => f.source)]

/** Links for every source the pane can show that has none yet. Runs from a timer: drawing may not write state. */
const linkPending = async ($: EngineInterface) => {
  const stored = await read($, current)
  const ear = { ...IDLE, ...(await read($, live)) }
  if (stored) await linkAll($, setLabels(stored), stored.folder)
  await linkAll($, [...answerSources([...ear.added, ...ear.next]), ...Object.values(ear.deep ?? {}).flatMap(list => list.map(a => a.source))])
}

// The background agent finding likely questions, and the spinner's clock while it runs.
let prepAgent: string | null = null
let stopTick: { cancel: () => void } | null = null

/**
 * Finds likely questions in a background agent, so the session stays free; without one, the session does it as before.
 * `label` names the occasion in the spinner when `occasion` is a whole brief.
 */
const startPrep = async ($: EngineInterface, occasion: string, label = occasion) => {
  if (await read($, preparing)) {
    $.ui.toast('Great Question: already finding likely questions …')
    return
  }
  const language = await read($, lang)
  const cwd = await $.session.cwd()
  const spawned = await $.agent
    .spawn({ prompt: prepPrompt(occasion.trim(), language, REPLY_AS_JSON), description: 'Great Question: finding likely questions', subagentType: 'general-purpose' })
    .catch(() => null)
  if (!spawned || !('agentId' in spawned) || !spawned.agentId) {
    void $.prompt.submit({ text: prepPrompt(occasion.trim(), language, CALL_THE_TOOL) })
    $.ui.toast('Great Question: finding likely questions …')
    return
  }
  prepAgent = spawned.agentId
  ours.add(spawned.agentId)
  const since = await $.clock.now()
  await update($, preparing, () => ({ since, occasion: label.trim(), folder: cwd }))
  stopTick?.cancel()
  stopTick = $.clock.every(1000, () => void update($, tick, t => t + 1))
  $.ui.toast('Great Question: finding likely questions in the background …')
}

/** The prepared questions from a background agent's reply; null when it is not the asked-for JSON or holds none. */
export const fromReply = (reply: string, generatedAt: string, folder?: string): QuestionSet | null => {
  try {
    const set = toSet(JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as Record<string, unknown>, generatedAt, folder)
    return set.questions.length ? set : null
  } catch {
    return null
  }
}

/** Stores prepared questions for this folder and shows them, the surest one open. */
const showSet = async ($: EngineInterface, set: QuestionSet) => {
  // Under the folder they were prepared in, which the session may have moved away from since.
  await $.store.set(set.folder ? `set:${set.folder}` : await storeKey($), set)
  await update($, current, () => set)
  await update($, held, () => null)
  await setOpen($, () => [set.questions[0]!.question])
  await linkAll($, setLabels(set), set.folder)
  await $.ui.open({ id: PANE, title: 'Great Question' })
}

const SOURCE_KINDS: Record<SourceKind, string> = {
  meeting: 'Meetings & transcripts',
  repo: 'Repository',
  ticket: 'Issues & tickets',
  doc: 'Documents',
  calendar: 'Calendar',
  other: 'Other',
}

// ponytail: keyword guess for plain-string sources (old sets, or a model that skips `kind`)
const guessKind = (label: string): SourceKind =>
  /wispr|transkript|meeting|termin \d|rehe?arsal/i.test(label) ? 'meeting'
  : /kalender|calendar/i.test(label) ? 'calendar'
  : /decision|issue|#\d|jira|pull request/i.test(label) ? 'ticket'
  : /\.(md|html?|pdf|json|ts|tsx|py)\b|\//.test(label) ? 'repo'
  : /drive|angebot|anhang|mail|rfp/i.test(label) ? 'doc'
  : 'other'

// Source kinds as stored by 0.8 and earlier.
const OLD_KINDS: Record<string, SourceKind> = { kalender: 'calendar', andere: 'other' }

const asSource = (src: unknown): Source =>
  typeof src === 'object' && src !== null && 'label' in src
    ? {
        kind: (src as Source).kind in SOURCE_KINDS ? (src as Source).kind : (OLD_KINDS[String((src as Source).kind)] ?? guessKind(String((src as Source).label))),
        label: String((src as Source).label),
      }
    : { kind: guessKind(String(src)), label: String(src) }

const clamp = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)))

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

const toSet = (input: Record<string, unknown>, generatedAt: string, folder?: string): QuestionSet => {
  const raw = Array.isArray(input.questions) ? (input.questions as Question[]) : []
  const questions = raw
    .filter(q => typeof q?.question === 'string')
    .map(q => ({
      ...q,
      who: asText(q.who),
      why: asText(q.why),
      answerer: asText(q.answerer),
      relevance: clamp(q.relevance),
      confidence: q.confidence === undefined ? undefined : clamp(q.confidence),
      answers: toAnswers(q.answers),
    }))
    .sort(bySurest)

  return {
    title: String(input.title ?? 'Question set'),
    language: input.language === 'en' || input.language === 'de' ? input.language : undefined,
    mode: String(input.mode ?? ''),
    generatedAt,
    sources: Array.isArray(input.sources) ? input.sources.map(asSource) : [],
    questions,
    folder: folder ?? (typeof input.folder === 'string' ? input.folder : undefined),
    recent: Array.isArray(input.recent)
      ? (input.recent as Fact[]).filter(f => typeof f?.text === 'string').map(f => ({ text: f.text, source: asText(f.source) }))
      : undefined,
  }
}

/** Opening the first row freezes the live sections as they stand; closing the last lets them run again. */
const setOpen = async ($: EngineInterface, change: (list: string[]) => string[]) => {
  const list = await update($, opened, change)
  const { next, added } = { ...IDLE, ...(await read($, live)) }
  await update($, held, h => (list.length ? (h ?? { next, added }) : null))
}

const age = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`)

/** The Wispr recording whose live transcript changed last, with when it changed, if that was within FRESH_MS. */
const runningRecording = async ($: EngineInterface, now: number) => {
  const root = `${await $.env.get('HOME')}/Library/Application Support/Wispr Flow/meetings`
  let best: { path: string; mtimeMs: number } | null = null
  for (const entry of await $.fs.list(root)) {
    if (entry.kind !== 'dir' || entry.name.startsWith('.')) continue
    const path = `${root}/${entry.name}/live.ndjson`
    if (!(await $.fs.exists(path))) continue
    const { mtimeMs } = await $.fs.stat(path)
    if (!best || mtimeMs > best.mtimeMs) best = { path, mtimeMs }
  }

  return best && now - best.mtimeMs < FRESH_MS ? best : null
}

// The transcript as last read: read again only when its file changed.
let heard: { path: string; mtimeMs: number; text: string } | null = null

/** The running recording's transcript; an unchanged file is not read again. */
const transcript = async ($: EngineInterface, path: string, mtimeMs: number) => {
  if (heard?.path !== path || heard.mtimeMs !== mtimeMs) heard = { path, mtimeMs, text: (await $.fs.read(path)) as string }
  return heard.text
}

// What the repository says is current, by folder, read at most once a minute.
let briefed: { folder: string; at: number; text: string } | null = null

/** The folder's memory file, its two newest daily logs and its last commits, newest first; nothing where they are missing. */
const readBriefing = async ($: EngineInterface, folder: string, now: number) => {
  if (briefed?.folder === folder && now - briefed.at < BRIEF_MS) return briefed.text
  const head = async (path: string, max: number) =>
    (await $.fs.exists(path).catch(() => false)) ? String((await $.fs.read(path).catch(() => '')) ?? '').slice(0, max) : ''
  const logs = `${folder}/memory/daily-logs`
  // Dated names sort by day; a README beside them is no log.
  const days = (await $.fs.exists(logs).catch(() => false))
    ? (await $.fs.list(logs).catch(() => [])).filter(e => e.kind === 'file' && /^\d/.test(e.name)).map(e => e.name).sort().reverse().slice(0, 2)
    : []
  const parts: [string, string][] = [
    ['memory/MEMORY.md', await head(`${folder}/memory/MEMORY.md`, 6_000)],
    ...(await Promise.all(days.map(async d => [`memory/daily-logs/${d}`, await head(`${logs}/${d}`, 3_000)] as [string, string]))),
    ['git log --oneline -15', (await git($, ['log', '--oneline', '-15'], folder).catch(() => null)) ?? ''],
  ]
  const text = parts.filter(([, t]) => t.trim()).map(([label, t]) => `${label}:\n${t.trim()}`).join('\n\n').slice(0, 16_000)
  briefed = { folder, at: now, text }
  return text
}

/** Lines in the session's repository that carry a question's words; none outside a git repository. */
const repoHits = async ($: EngineInterface, terms: readonly string[]) => {
  const { exitCode, stdout } = await $.process.run(grepArgs(terms), { timeoutMs: 5000 }).catch(() => ({ exitCode: 2, stdout: '' }))
  return exitCode === 0 ? topHits(stdout, terms) : []
}

/** My name and latest commits in the folder the questions are about; nothing outside a git repository. */
const myWork = async ($: EngineInterface, cwd: string) => {
  try {
    const me = parseIdent(await git($, ['var', 'GIT_AUTHOR_IDENT'], cwd))
    return { name: me?.name ?? '', recent: me ? parseLog(await git($, logArgs(me.email), cwd)) : [] }
  } catch {
    return { name: '', recent: [] }
  }
}

// My work by folder, asked of git at most once a minute: ticks with waiting lines need my name every 3 s.
let worked: { folder: string; at: number; me: Awaited<ReturnType<typeof myWork>> } | null = null

const myWorkNow = async ($: EngineInterface, folder: string, now: number) => {
  if (worked?.folder !== folder || now - worked.at >= BRIEF_MS) worked = { folder, at: now, me: await myWork($, folder) }
  return worked.me
}

// Questions whose answers are being written now: a later step leaves them to the call already under way.
const answering = new Set<string>()
// A failed model step holds the next one off until then, so a trigger in the unread lines cannot fire every tick.
let retryAt = 0

// Repository lookups by subagent: agent id to the question it looks up. A notification of one of them is dropped.
const lookups = new Map<string, string>()
const ours = new Set<string>()

/** Starts a read-only subagent on the question asked now, unless the prepared answers already rest on sources. */
const lookUp = async ($: EngineInterface, question: string, set: QuestionSet | null, ear: Live) => {
  const prepared = set?.questions.find(q => q.question === question)
  if (prepared && confidenceOf(prepared) >= 4) return
  if (ear.looking.includes(question) || ear.deep[question]) return
  // ponytail: spawn takes a model but no effort; a registered agent type per level if the lookup needs more thought
  const { model } = await levelOf($)
  const spawned = await $.agent
    .spawn({ prompt: lookupPrompt(question, await read($, lang)), description: 'Great Question: repository lookup', subagentType: 'Explore', model })
    .catch(() => null)
  if (!spawned || !('agentId' in spawned) || !spawned.agentId) return
  lookups.set(spawned.agentId, question)
  ours.add(spawned.agentId)
  await update($, live, l => ({ ...l, looking: [...l.looking, question] }))
}

/**
 * One listening tick: read the transcript when it changed and, when the new lines may hold a question (or have waited
 * STEP_MS), run a step. A step first lets a small model find who asks what (DETECT) and paints that, then writes the
 * answers for every question still waiting (ANSWER) while a subagent looks up the question asked now.
 */
const listen = async ($: EngineInterface) => {
  const state = { ...IDLE, ...(await read($, live)) }
  const set = await read($, current)
  if (!state.isOn) return
  const now = await $.clock.now()
  const recording = await runningRecording($, now)
  if (!recording) {
    await update($, live, l => ({ ...l, status: 'no running Wispr recording found' }))
    return
  }
  const { path, mtimeMs } = recording
  const base = state.meeting === path ? state : { ...IDLE, isOn: true, meeting: path }
  const { lines: total, tail, fresh } = parseTranscript(await transcript($, path, mtimeMs), base.lines)
  // The file's time is when the last line was written; written every tick, so the age stays true while nobody speaks.
  const reading = (l: Live) => {
    const left = l.pending.filter(q => !answering.has(q)).length
    return `listening · ${total} utterances · last utterance ${age(now - mtimeMs)} ago${left ? ` · ${left} unanswered` : ''}`
  }
  const folder = set?.folder ?? (await $.session.cwd())
  const me = fresh.length ? await myWorkNow($, folder, now) : { name: '', recent: [] }
  const names = me.name.split(/\s+/).filter(n => n.length >= 3)
  if (!fresh.length || now < retryAt || !(isTrigger(fresh, names) || now - base.steppedAt >= STEP_MS)) {
    await update($, live, l => (l.isOn ? { ...l, changedAt: mtimeMs, status: reading(l), phase: l.phase === 'idle' ? 'listening' : l.phase } : l))
    return
  }

  await update($, live, l => (l.isOn ? { ...l, phase: 'detecting' } : l))
  const language = await read($, lang)
  // The same opening for both calls, so the second reads it from the cache.
  // ponytail: the whole two-minute tail every step; only the marked lines plus a summary if the cost shows
  const known = knowledge(set, { ...base, recent: me.recent }, await readBriefing($, folder, now))
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    system: SYSTEM,
    prompt: [{ text: known, cache: true }, { text: detectTask(tail, language, me.name) }],
    maxTokens: 700,
    timeoutMs: 15_000,
  })
  const text = reply.isAnswered ? reply.text : ''
  const applied = reply.isAnswered ? applyReply(base, set, text, now) : base
  // No answer, or not the asked-for JSON: the lines stay unread, so a step after RETRY_MS tries them again.
  if (applied === base) {
    retryAt = now + RETRY_MS
    const why = reply.isAnswered ? 'model reply was no JSON; trying again' : `model gave no answer (${reply.reason})`
    await update($, live, l => (l.isOn ? { ...l, status: why, phase: l.pending.length ? 'answering' : 'listening' } : l))
    return
  }
  const heardNow = { lines: total, changedAt: mtimeMs, recent: me.recent }
  // Folded into the state as it stands now: answers, lookups and rows an earlier step's answer call wrote meanwhile stay.
  const step = await update($, live, l => {
    if (!l.isOn) return l
    const folded = l.meeting === path ? applyReply({ ...IDLE, ...l }, set, text, now) : applied
    return { ...folded, ...heardNow, status: reading({ ...folded, pending: [] }) }
  })
  if (!step.isOn) return
  const isNewCurrent = !!step.current && step.current !== base.current
  if (isNewCurrent && !(await read($, opened)).length) await $.ui.scroll({ in: PANE, to: 'start', block: 'start' }).catch(() => {})

  // Detached: the next tick may detect while answers are being written. It writes rows, pending and phase only; the
  // status line belongs to the ticks.
  const answer = async () => {
    const rows = [...step.added, ...step.next]
    const waiting = step.pending
      .filter(q => !answering.has(q))
      .map(q => rows.find(r => r.question === q))
      .filter((q): q is Question => !!q)
    const questions = waiting.map(q => q.question)
    if (questions.length) {
      questions.forEach(q => answering.add(q))
      try {
        const items = await Promise.all(waiting.map(async q => ({ question: q.question, hits: q.search?.length ? await repoHits($, q.search) : [] })))
        const { model, effort, timeoutMs } = await levelOf($)
        const answers = await $.model.complete({
          model,
          effort,
          system: GROUND_SYSTEM,
          prompt: [{ text: known, cache: true }, { text: ground(items, language) }],
          maxTokens: 1800,
          timeoutMs,
        })
        if (answers.isAnswered) await update($, live, l => applyAnswers({ ...IDLE, ...l }, questions, answers.text))
      } finally {
        // ponytail: a call that never settles keeps its questions here until the session restarts; timeoutMs bounds it
        questions.forEach(q => answering.delete(q))
      }
    }
    const after = { ...IDLE, ...(await read($, live)) }
    void linkAll($, answerSources([...after.added, ...after.next]))
  }
  void answer().catch(() => {})
  if (isNewCurrent) await lookUp($, step.current!, set, { ...IDLE, ...(await read($, live)) })
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '')

const mdQuestion = (q: Question) =>
  [
    `### ${q.question}`,
    '',
    ...[
      q.who && `- Likely asked by: ${q.who}`,
      q.why && `- Expected because: ${q.why}`,
      q.answerer && `- Answered by us: ${q.answerer}`,
      `- Likelihood ${q.relevance}/5 · Answer confidence ${confidenceOf(q)}/5`,
    ].filter(Boolean),
    '',
    ...[...q.answers]
      .sort((a, b) => ORDER.indexOf(a.risk) - ORDER.indexOf(b.risk))
      .flatMap(a => [
        `**${RISKS[a.risk].mark} ${RISKS[a.risk].action}** · ${RISKS[a.risk].label}`,
        '',
        a.text,
        ...(a.note ? ['', `Note: ${a.note}`] : []),
        ...(a.source ? ['', `Source: ${a.source}`] : []),
        '',
      ]),
  ].join('\n')

/** The pane as Markdown: the set by answer confidence, then whatever listening produced, then the sources. */
export const toMarkdown = (set: QuestionSet | null, ear: Live, exportedAt: string, hrefs: Record<string, string> = {}) => {
  const questions = [...(set?.questions ?? [])].sort(bySurest)
  const section = (title: string, list: Question[]) => (list.length ? [`## ${title}`, '', ...list.map(mdQuestion)] : [])
  const sources = (set?.sources ?? []).map(asSource)
  const recent = recentOf(set, ear)

  return [
    `# ${set?.title ?? 'Questions from the conversation'}`,
    '',
    [set && `Prepared ${set.generatedAt} UTC`, `exported ${exportedAt} UTC`].filter(Boolean).join(' · '),
    '',
    `Legend: ${ORDER.map(r => `${RISKS[r].mark} ${RISKS[r].action.toLowerCase()} (${RISKS[r].label})`).join(' · ')}`,
    '',
    ...(recent.length ? ['## Safe to say: my recent work', '', ...recent.map(f => `- ${f.text}${f.source ? ` (${f.source})` : ''}`), ''] : []),
    ...GROUPS.flatMap((g, k) =>
      section(g.label, questions.filter(q => confidenceOf(q) >= g.min && (k === 0 || confidenceOf(q) < GROUPS[k - 1]!.min))),
    ),
    ...section('Asked in the meeting, not prepared', ear.added),
    ...section('Likely next (latest state)', ear.next),
    ...(ear.asked.length ? ['## Asked in the meeting', '', ...ear.asked.map(q => `- ${q}`), ''] : []),
    ...(sources.length
      ? [
          '## Sources',
          '',
          ...(Object.keys(SOURCE_KINDS) as SourceKind[]).flatMap(kind => {
            const items = sources.filter(src => src.kind === kind)
            const line = (label: string) => (hrefs[label] ? `- [${label}](${hrefs[label]})` : `- ${label}`)
            return items.length ? [`**${SOURCE_KINDS[kind]}**`, '', ...items.map(src => line(src.label)), ''] : []
          }),
        ]
      : []),
  ].join('\n')
}

const exportMarkdown = async ($: EngineInterface) => {
  const set = await read($, current)
  const ear = { ...IDLE, ...(await read($, live)) }
  const now = stamp(await $.clock.now())
  const path = `question-sets/${now.slice(0, 10)}-${now.slice(11, 16).replace(':', '')}-${slug(set?.title ?? 'conversation') || 'question-set'}.md`
  // Absolute: a relative path is not reliably the session's working directory.
  await $.fs.write(`${await $.session.cwd()}/${path}`, toMarkdown(set, ear, now, await read($, links)))
  $.ui.toast(`Exported: ${path}`)
}

export const register: Register = on => {
  let isListening = false
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'great-question-prep',
      description: 'Great Question: find the likely questions for a pitch, meeting or daily stand-up in the background (optionally name the occasion)',
      argumentHint: '[occasion]',
    })
    await $.command.register({
      name: 'great-question',
      description: 'Great Question: open the pane (without preparing new questions)',
    })
    await $.tool.register({
      name: 'show_questions',
      description:
        'Shows a question set (the most likely questions for a pitch, meeting or daily stand-up, with answer options by risk) in the Great Question pane and stores it for this repository.',
      inputSchema: SCHEMA,
    })
    // What the last module read is gone with it: a new one reads the transcript and the briefing anew.
    heard = null
    briefed = null
    worked = null
    answering.clear()
    retryAt = 0
    // Links a first try missed (git not ready, a source new since) come with the next round.
    $.clock.every(LINK_MS, () => void linkPending($))
    $.clock.every(TICK_MS, () => {
      if (isListening) return
      isListening = true
      void listen($).finally(() => (isListening = false))
    })
    // Once the session has settled: links of the questions it starts with.
    $.clock.after(1000, () => void linkPending($))
    // The version as installed, read from the copy that actually runs (the plugin cache, not the source folder).
    try {
      const manifest = JSON.parse((await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as string)
      await update($, version, () => String(manifest.version ?? ''))
    } catch {
      // no manifest to read (tests): the pane just shows no version
    }
    // State and sets from 0.8 and earlier carry German names: translate them once here.
    await update($, view, v => (v === 'practice' || (v as string) === 'training' ? 'practice' : 'meeting'))
    await update($, sortBy, v => (v === 'likelihood' || (v as string) === 'wahrscheinlich' ? 'likelihood' : 'confidence'))
    // Links are worked out again when drawn: one kept from a failed lookup would stay wrong.
    await update($, links, () => ({}))
    // Background agents do not outlive the module: nothing is still being looked up or prepared.
    await update($, preparing, () => null)
    // Answers 0.10.2 and earlier kept as the model wrote them: an object among them blanked the pane, so they are cleaned here too.
    const cleaned = (deep: Live['deep'] = {}) => Object.fromEntries(Object.entries(deep).map(([q, list]) => [q, toAnswers(list)]))
    await update($, live, l => ({ ...IDLE, ...l, added: withRisks(l.added ?? []), next: withRisks(l.next ?? []), deep: cleaned(l.deep), looking: [] }))
    await update($, held, h => h && { next: withRisks(h.next), added: withRisks(h.added) })
    // Questions on show from before 0.10 know no folder: the key they are stored under names it.
    const shown = await read($, current)
    if (shown && !shown.folder) {
      for (const key of (await $.store.keys().catch(() => [])).filter(k => k.startsWith('set:'))) {
        const kept = (await $.store.get(key)) as QuestionSet | undefined
        if (kept?.title === shown.title && kept.generatedAt === shown.generatedAt) {
          await update($, current, c => c && { ...c, folder: key.slice(4) })
          break
        }
      }
    }
    const saved = (await $.store.get(await storeKey($))) as QuestionSet | undefined
    if (saved) {
      // Sets from before 0.10 carry no folder: the one they are stored under is it.
      const set = toSet(saved as unknown as Record<string, unknown>, saved.generatedAt, saved.folder ?? (await $.session.cwd()))
      await update($, current, () => set)
      void $.ui.open({ id: PANE, title: 'Great Question' })
    }

    return next(e)
  })

  // A repository lookup ends as its subagent's turn: its answers replace the question's own while it is asked.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // The background agent that found likely questions: show them, or say nothing came back.
    if (e.agentId && e.agentId === prepAgent) {
      prepAgent = null
      stopTick?.cancel()
      stopTick = null
      const folder = (await read($, preparing))?.folder
      const set = e.reason === 'answer' ? fromReply(e.answer, stamp(await $.clock.now()), folder) : null
      await update($, preparing, () => null)
      if (set) await showSet($, set)
      $.ui.toast(set ? `Great Question: ${set.questions.length} likely questions ready` : 'Great Question: no likely questions came back')
      return result
    }
    const question = e.agentId ? lookups.get(e.agentId) : undefined
    if (!question) return result
    lookups.delete(e.agentId!)
    await update($, live, l => settleLookup({ ...IDLE, ...l }, question, e.reason === 'answer' ? e.answer : null))
    void linkAll($, ((await read($, live)).deep?.[question] ?? []).map(a => a.source))
    return result
  })

  // The notification of a finished lookup would start a turn of the main model mid-meeting: it stays out.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification' && [...ours].some(id => e.text.includes(id))) return { drop: 'Great Question: repository lookup done' }
    return next(e)
  })

  on('command.run', { command: 'great-question' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Great Question' })

    return { text: isPlaced ? 'Great Question opened.' : 'Great Question opened but not shown: make the window wider.' }
  })

  on('command.run', { command: 'great-question-prep' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Great Question' })
    await startPrep($, e.args)

    return { text: `Finding likely questions in the background${e.args.trim() ? ` (occasion: ${e.args.trim()})` : ' (no occasion given)'}.` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const set = toSet(e as unknown as Record<string, unknown>, stamp(await $.clock.now()), await $.session.cwd())
    if (set.questions.length === 0) return { deny: 'No questions in the input: give questions[] with question, relevance, answers.' }
    await showSet($, set)

    return { result: `${set.questions.length} questions shown in the Great Question pane.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const stored = await read($, current)
    const hrefs = await read($, links)
    // A source as a link where it points somewhere a surface can open, plain text otherwise.
    const sourceOf = (label: string, prefix: string, key: string, size?: 'caption') => {
      const href = hrefs[label]
      return href ? (
        <Box key={key} flexDirection="row" columnGap={1}>
          <Text dimColor size={size}>{prefix}</Text>
          <Link href={href} label={label} />
        </Box>
      ) : (
        <Text key={key} dimColor size={size}>
          {prefix} {label}
        </Text>
      )
    }
    const openList = await read($, opened)
    const frozen = await read($, held)
    const isMore = await read($, more)
    const folder = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? 'this folder'
    const prep = await read($, preparing)
    const frame = ['◐', '◓', '◑', '◒'][(await read($, tick)) % 4]
    const now = await $.clock.now()
    const folds = await read($, toggled)
    const took = prep ? Math.max(0, Math.round((now - prep.since) / 1000)) : 0
    const isPractice = (await read($, view)) === 'practice'
    const isByLikely = (await read($, sortBy)) === 'likelihood'
    const language = await read($, lang)
    const level = await read($, quality)
    // Spread over IDLE: a value from an older version of the mod may lack newer fields.
    const ear: Live = { ...IDLE, ...(await read($, live)) }
    const shown = await read($, version)
    const recent = recentOf(stored, ear)
    const hasLive = ear.asked.length + ear.added.length + ear.next.length > 0

    // Without a set the pane still listens; it just has nothing prepared to match.
    const set: QuestionSet = stored ?? { title: 'No prepared questions yet', mode: '', generatedAt: '', sources: [], questions: [] }

    // A dim rule above each section header; truncated so it never wraps on a narrow or proportional surface.
    const rule = '─'.repeat(Math.max(8, Number(e.props.bodyColumns) || 60))
    const heading = (text: string) => (
      <>
        <Text dimColor wrap="truncate">{rule}</Text>
        <Text bold dimColor>{text}</Text>
      </>
    )
    const isOpen = (q: Question) => openList.includes(q.question)
    const toggle = (q: Question) => setOpen($, list => (list.includes(q.question) ? list.filter(t => t !== q.question) : [...list, q.question]))
    const answerRow = (a: Answer, j: number) => (
      <Box key={`a${j}`} flexDirection="column" marginTop={1}>
        <Text>
          <Text color={RISKS[a.risk].color} bold>
            {RISKS[a.risk].mark} {RISKS[a.risk].action}
          </Text>
          <Text dimColor> · {RISKS[a.risk].label}</Text>
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          {/* Colour repeats the mark and the word above, so nothing rests on colour alone. */}
          <Text color={RISKS[a.risk].color}>{a.text}</Text>
          {a.note && <Text dimColor>Note: {a.note}</Text>}
          {a.source && sourceOf(a.source, 'Source:', `src${j}`)}
        </Box>
      </Box>
    )
    // A repository lookup's answers stand in for the question's own.
    const byRisk = (q: Question) => [...(ear.deep[q.question] ?? q.answers)].sort((a, b) => ORDER.indexOf(a.risk) - ORDER.indexOf(b.risk))
    const isAsked = (q: Question) => ear.asked.includes(q.question)
    const isPending = (q: Question) => ear.pending.includes(q.question)
    // Live rows show their best answer when closed, so a glance is enough and nothing opens by itself.
    const questionRow = (q: Question, hasHint = false) => {
      const k = rowKey(q.question)
      const best = byRisk(q)[0]
      return (
        <Box key={`r${k}`} flexDirection="column" marginBottom={1}>
          <Button key={`t${k}`} plain onPress={() => toggle(q)}>
            {isOpen(q) ? '▾ ' : '▸ '}
            {isAsked(q) ? <Text dimColor>✓ </Text> : ''}
            <Text bold color={isAsked(q) ? undefined : 'text'} dimColor={isAsked(q)}>
              {q.question}
            </Text>
            {/* A live row says whether it is for me; a prepared one shows its answers' marks. */}
            {hasHint ? '' : ' '}
            {hasHint ? (q.to === 'me' ? <Text dimColor> · you</Text> : '') : byRisk(q).map(a => <Text color={RISKS[a.risk].color}>{RISKS[a.risk].mark}</Text>)}
          </Button>
          {!isOpen(q) && hasHint && isPending(q) && (
            <Box paddingLeft={2}>
              <Text dimColor color="warning">
                answering …
              </Text>
            </Box>
          )}
          {!isOpen(q) && hasHint && !isPending(q) && best && (
            // The mark in a box of its own that never shrinks: inside one truncated line the desktop broke it apart.
            <Box paddingLeft={2} flexDirection="row" columnGap={1}>
              <Box flexShrink={0}>
                <Text color={RISKS[best.risk].color}>
                  {RISKS[best.risk].mark} {RISKS[best.risk].action}:
                </Text>
              </Box>
              <Box flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate">
                  {best.text}
                </Text>
              </Box>
            </Box>
          )}
          {isOpen(q) && (
            <Box flexDirection="column" paddingLeft={2}>
              {/* The question leads; these lines step back as far as the theme allows. */}
              {q.who && <Text color="subtle" dimColor italic>Likely asked by: {q.who}</Text>}
              {q.why && <Text color="subtle" dimColor italic>Expected because: {q.why}</Text>}
              {q.answerer && <Text color="subtle" dimColor italic>Answered by us: {q.answerer}</Text>}
              <Text color="subtle" dimColor italic>
                Likelihood {q.relevance}/5 · Answer confidence {confidenceOf(q)}/5
              </Text>
              {byRisk(q).map(answerRow)}
            </Box>
          )}
        </Box>
      )
    }
    const order = isPractice ? -1 : 1
    const groupKey = isByLikely ? (q: Question) => q.relevance : confidenceOf
    const groupList = isByLikely ? LIKELY_GROUPS : GROUPS
    // While listening an asked question stays where it is, marked ✓; paused, it moves to the end.
    const isSinking = (q: Question) => !ear.isOn && isAsked(q)
    const listed = groupList
      .map((g, k) => ({
        ...g,
        items: set.questions
          .filter(q => !isSinking(q))
          .filter(q => groupKey(q) >= g.min && (k === 0 || groupKey(q) < groupList[k - 1]!.min))
          .sort((a, b) => order * (groupKey(b) - groupKey(a) || b.relevance - a.relevance || confidenceOf(b) - confidenceOf(a))),
      }))
      .filter(g => g.items.length > 0)
      .sort((a, b) => order * (b.min - a.min))
    const asked = set.questions.filter(isSinking)
    // The live sections as drawn: held while a row is open, so nothing moves under the reader.
    const source = frozen ?? ear
    const inSet = (q: Question) => set.questions.some(k => k.question === q.question)
    const nextRows = source.next.filter(q => !inSet(q))
    const addedRows = source.added.filter(q => !inSet(q) && !nextRows.some(k => k.question === q.question))
    const drawn = new Set([...nextRows, ...addedRows].map(q => q.question))
    const waiting = frozen ? [...ear.next, ...ear.added].filter(q => !drawn.has(q.question) && !inSet(q)).length : 0
    // Questions for me lead, then the likelier, then the newer; a few, so the next one is found at a glance.
    const upNext = [...nextRows]
      .sort((a, b) => Number(b.to === 'me') - Number(a.to === 'me') || b.relevance - a.relevance || (b.heardAt ?? 0) - (a.heardAt ?? 0))
      .slice(0, MAX_SHOWN_NEXT)
    // The question on the table, always live; its row stays in its section too.
    const nowRow = ear.current ? [...set.questions, ...ear.added].find(q => q.question === ear.current) : undefined
    // Newest first; the question asked now has the card.
    const earlier = [...addedRows].reverse().filter(q => q.question !== ear.current).sort((a, b) => (b.heardAt ?? 0) - (a.heardAt ?? 0))
    const rows = [...nextRows, ...addedRows, ...listed.flatMap(g => g.items), ...asked]
    // Two buttons, not one toggle: closing must never mean opening every row first.
    const isAllOpen = rows.length > 0 && rows.every(isOpen)
    const isAnyOpen = rows.some(isOpen)
    const sorting = isPractice
      ? `Practice: ${isByLikely ? 'rarest' : 'least certain'} first`
      : isByLikely ? 'most likely first' : 'surest first'
    // While listening the status rides on the ear button; anything else it says stays a line of its own.
    const isHeard = ear.isOn && ear.status.startsWith('listening')
    const earLabel = !ear.isOn ? 'Listen live' : isHeard ? `◉ L${ear.status.slice(1).replace('last utterance ', '')}` : '◉ Listening'
    // Listening folds every section below the card; paused, the prepared questions and my recent work stand open.
    const isUnfolded = (key: string) => (!ear.isOn && (key === 'prepared' || key === 'safe')) !== folds.includes(key)
    const fold = (key: string, title: string, body: () => RenderChildren) => (
      <Box key={key} flexDirection="column">
        <Text dimColor wrap="truncate">{rule}</Text>
        <Button key={`fold:${key}`} plain onPress={() => update($, toggled, t => (t.includes(key) ? t.filter(k => k !== key) : [...t, key]))}>
          <Text bold dimColor>
            {isUnfolded(key) ? '▾ ' : '▸ '}
            {title}
          </Text>
        </Button>
        {isUnfolded(key) && body()}
      </Box>
    )
    // The card: who the question is for, the answer to give, the one to avoid; the rest behind a button.
    const card = (q: Question) => {
      const answers = byRisk(q)
      const best = answers[0]
      const risky = answers.find(a => a.risk === 'risky' && a !== best)
      const rest = answers.filter(a => a !== best && a !== risky)
      const isOther = q.to === 'other'
      const label = [
        (q.to && TO[q.to]) || 'ASKED NOW',
        ...(q.asker ? [`by ${q.asker}`] : []),
        ...(ear.currentAt > 0 ? [`${age(now - ear.currentAt)} ago`] : []),
      ].join(' · ')
      return (
        <>
          <Text size="caption" dimColor>
            {label}
          </Text>
          <Text size="title" weight={isOther ? 'regular' : 'semibold'} dimColor={isOther}>
            {q.question}
          </Text>
          {isPending(q) ? (
            <Text dimColor color="warning">
              answering …
            </Text>
          ) : ear.looking.includes(q.question) ? (
            <Text dimColor>checking the repository …</Text>
          ) : (
            ear.deep[q.question] && <Text dimColor>from the repository</Text>
          )}
          {isOpen(q)
            ? answers.map(answerRow)
            : best && (
                <Box flexDirection="column" marginTop={1}>
                  <Text size="heading" weight="semibold" color={RISKS[best.risk].color}>
                    {RISKS[best.risk].mark} {RISKS[best.risk].action}
                  </Text>
                  <Text size="heading" color={RISKS[best.risk].color}>
                    {best.text}
                  </Text>
                  {best.source && sourceOf(best.source, 'Source:', 'now-src', 'caption')}
                  {best.risk !== 'sourced' && best.note && (
                    <Text size="footnote" dimColor>
                      Note: {best.note}
                    </Text>
                  )}
                </Box>
              )}
          {!isOpen(q) && risky && (
            <Text size="footnote" color="error" wrap="truncate">
              ✖ Don't say: {risky.text}
            </Text>
          )}
          {rest.length > 0 && (
            <Button key="now-more" plain onPress={() => toggle(q)}>
              {isOpen(q) ? '▾ fewer' : `▸ ${rest.length} more answers`}
            </Button>
          )}
        </>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text>
              <Text bold>{set.title}</Text>
              {stored ? <Text dimColor> · {set.questions.length} prepared{set.language ? ` · ${set.language.toUpperCase()}` : ''}</Text> : ''}
            </Text>
            {shown && <Text dimColor>v{shown}</Text>}
          </Box>
          {/* Wraps onto further rows on a narrow pane instead of pushing buttons out of view. */}
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
            <Button
              key="ear"
              variant={ear.isOn ? 'primary' : 'secondary'}
              label={earLabel}
              // Stopping only pauses: what the call produced stays until Clear; a new recording starts afresh.
              onPress={() =>
                update($, live, l => ({
                  ...l,
                  isOn: !l.isOn,
                  status: l.isOn ? `paused · ${l.lines} utterances read · results stay` : 'starting …',
                }))
              }
            />
            <Button key="gen" label={prep ? 'Finding …' : 'Find likely questions'} onPress={() => startPrep($, '')} />
            {rows.length > 0 && !isAllOpen && <Button key="open-all" label="Open all" onPress={() => setOpen($, () => rows.map(q => q.question))} />}
            {isAnyOpen && <Button key="close-all" label="Close all" onPress={() => setOpen($, () => [])} />}
            <Button key="more" dimColor label={isMore ? 'More ▾' : 'More ▸'} onPress={() => update($, more, m => !m)} />
          </Box>
        </Box>
        {isMore && (
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
              <Button
                key="lang"
                label={`Language: ${language === 'auto' ? 'Auto' : language.toUpperCase()}`}
                onPress={() => update($, lang, l => LANGS[(LANGS.indexOf(l) + 1) % LANGS.length]!)}
              />
              <Button
                key="quality"
                label={`Model: ${QUALITY[level]?.label ?? QUALITY.fast.label}`}
                onPress={() => update($, quality, q => QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length]!)}
              />
              <Button
                key="sort"
                label={isByLikely ? 'Sort: most likely asked' : 'Sort: safest to answer'}
                onPress={() => update($, sortBy, v => (v === 'likelihood' ? 'confidence' : 'likelihood'))}
              />
              <Button
                key="view"
                variant={isPractice ? 'primary' : 'secondary'}
                label={isPractice ? 'Practice' : 'Meeting'}
                onPress={() => update($, view, v => (v === 'practice' ? 'meeting' : 'practice'))}
              />
              {(stored || hasLive) && <Button key="export" label="Export" onPress={() => exportMarkdown($)} />}
              {!ear.isOn && hasLive && (
                <Button
                  key="clear"
                  label="Clear"
                  onPress={async () => {
                    await update($, live, () => IDLE)
                    await update($, held, h => h && { next: [], added: [] })
                  }}
                />
              )}
            </Box>
            <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={2}>
              {ORDER.map(r => (
                <Text key={r} color={RISKS[r].color}>
                  {RISKS[r].mark} {RISKS[r].action.toLowerCase()}
                </Text>
              ))}
            </Box>
            {stored && <Text dimColor>Prepared {set.generatedAt} UTC</Text>}
          </Box>
        )}
        {prep && (
          <Box key="prep" flexDirection="column">
            <Text color="warning">
              {frame} Finding likely questions{prep.occasion ? ` for ${prep.occasion}` : ''} · {Math.floor(took / 60)}:{String(took % 60).padStart(2, '0')}
            </Text>
            <Text dimColor>In the background, from the repository and connected sources; the session stays free.</Text>
          </Box>
        )}
        {ear.status && !isHeard && <Text dimColor>{ear.status}</Text>}
        {(ear.isOn || nowRow) && (
          <Box key="now" flexDirection="column" borderStyle="round" paddingX={1}>
            {nowRow ? (
              card(nowRow)
            ) : (
              <Text dimColor>{ear.phase === 'detecting' || ear.phase === 'answering' ? `listening · ${ear.phase} …` : 'listening …'}</Text>
            )}
          </Box>
        )}
        {(upNext.length > 0 || waiting > 0) && (
          <Box key="next" flexDirection="column">
            <Text dimColor wrap="truncate">{rule}</Text>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
              <Text bold dimColor>
                UP NEXT · FOR YOU · {upNext.length}
              </Text>
              {waiting > 0 && (
                <Button key="sync" variant="primary" label={`↻ take ${waiting} new`} onPress={() => update($, held, () => ({ next: ear.next, added: ear.added }))} />
              )}
            </Box>
            {upNext.map(q => questionRow(q, true))}
          </Box>
        )}
        {/* Nothing prepared, nothing heard: offer where to start instead of an empty pane. */}
        {!stored && !prep && !ear.isOn && !hasLive && (
          <Box key="welcome" flexDirection="column" borderStyle="round" paddingX={1} rowGap={1}>
            <Text bold>Where do you want to start?</Text>
            <Box flexDirection="column">
              <Button
                key="start-repo"
                plain
                label={`▸ Likely questions about ${folder}`}
                onPress={() =>
                  startPrep($, `questions about this repository (${folder}): what it does, its current state, decisions, risks and open points`, folder)
                }
              />
              <Button
                key="start-meeting"
                plain
                label="▸ Prepare my next meeting"
                onPress={() =>
                  startPrep($, 'my next meeting in the calendar: find it with list_upcoming_meetings, its attendees and earlier meetings with them', 'my next meeting')
                }
              />
              <Button key="start-daily" plain label="▸ Prepare today's daily" onPress={() => startPrep($, "today's daily stand-up", "today's daily")} />
            </Box>
            <Text dimColor>Or just Listen live: questions then come from the live transcript only, answers from this repository.</Text>
          </Box>
        )}
        {/* True whatever is asked: what I worked on last, to fall back on when no answer above fits. */}
        {recent.length > 0 &&
          fold('safe', `SAFE TO SAY · MY RECENT WORK · ${recent.length}`, () =>
            recent.map((f, j) => (
              <Box key={`f${j}`} flexDirection="column" marginTop={1}>
                <Text color="success">● {f.text}</Text>
                {f.source && <Box paddingLeft={2}>{sourceOf(f.source, 'Source:', `fs${j}`)}</Box>}
              </Box>
            )),
          )}
        {earlier.length > 0 && fold('earlier', `ASKED EARLIER · ${earlier.length}`, () => earlier.map(q => questionRow(q, true)))}
        {set.questions.length > 0 &&
          fold('prepared', `PREPARED · ${set.questions.length} · ${sorting}`, () => (
            <>
              {listed.map(g => (
                <Box key={g.label} flexDirection="column">
                  {heading(`${g.label.toUpperCase()} · ${g.items.length}`)}
                  {g.items.map(q => questionRow(q))}
                </Box>
              ))}
              {asked.length > 0 && (
                <Box key="asked" flexDirection="column">
                  {heading(`ALREADY ASKED · ${asked.length}`)}
                  {asked.map(q => questionRow(q))}
                </Box>
              )}
            </>
          ))}
        {set.sources.length > 0 &&
          fold('sources', `SOURCES · ${set.sources.length}`, () =>
            (Object.keys(SOURCE_KINDS) as SourceKind[]).map(kind => {
              const items = set.sources.map(asSource).filter(src => src.kind === kind)
              return items.length === 0 ? null : (
                <Box key={`k${kind}`} flexDirection="column" marginTop={1}>
                  <Text dimColor underline>{SOURCE_KINDS[kind]}</Text>
                  {items.map((src, k) => sourceOf(src.label, '•', `s${kind}${k}`))}
                </Box>
              )
            }),
          )}
      </Box>
    )
  })
}
