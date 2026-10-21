export type Risk = 'sourced' | 'vague' | 'commitment' | 'risky'
export type Answer = { text: string; risk: Risk; note?: string; source?: string }
/** Who a question heard in the meeting is for: me (by name, my ticket or my work), everyone, or someone else. */
export type Addressee = 'me' | 'all' | 'other'
export type Question = {
  question: string
  relevance: number
  confidence?: number
  who?: string
  /** Who on our side answers; only when the material names them. */
  answerer?: string
  why?: string
  answers: Answer[]
  /** Words to look up in the repository, from a live step; not shown. */
  search?: string[]
  /** Who the question is for, as the model read the conversation; live rows only. */
  to?: Addressee
  /** Who asked, as a role or the first name heard in the call; nothing when unknown. Live rows only. */
  asker?: string
  /** When the row was heard or predicted, in ms since the epoch; live rows only. */
  heardAt?: number
}
/** Something I certainly did, said as is in any meeting. */
export type Fact = { text: string; source?: string }
export type SourceKind = 'meeting' | 'repo' | 'ticket' | 'doc' | 'calendar' | 'other'
export type Source = { kind: SourceKind; label: string }
export type Lang = 'auto' | 'de' | 'en'
/** Which model answers live and how hard it thinks: speed against depth. */
export type Quality = 'fast' | 'balanced' | 'thorough'
export type QuestionSet = {
  title: string
  mode: string
  generatedAt: string
  /** Strings in sets stored before sources had a kind. */
  sources: (Source | string)[]
  questions: Question[]
  /** Language the questions and answers were written in. */
  language?: 'de' | 'en'
  /** The folder they were prepared in; source paths count from it. */
  folder?: string
  /** What I worked on most recently, newest first; sets from before 0.11 have none. */
  recent?: Fact[]
}

/** Where listening stands, shown on the focus card: nothing heard yet, waiting for lines, reading them, writing answers, done. */
export type Phase = 'idle' | 'listening' | 'detecting' | 'answering' | 'ready'

export type Live = {
  isOn: boolean
  status: string
  meeting: string | null
  lines: number
  /** When the transcript last grew, for the status line. */
  changedAt: number
  asked: string[]
  current: string | null
  added: Question[]
  /** Predictions; they stay until asked, new ones join at the end. */
  next: Question[]
  /** Answers a repository lookup found for a question asked now, by question text; drawn instead of the question's own. */
  deep: Record<string, Answer[]>
  /** Questions a repository lookup is still running for. */
  looking: string[]
  /** My latest commits in the folder, read while listening. */
  recent: Fact[]
  /** Where the last listening step stands. */
  phase: Phase
  /** Live questions whose answers are still being written, by question text; the pane says "answering …" for them. */
  pending: string[]
  /** When `current` last changed: a fresh question is marked as such and the pane scrolls to it. */
  currentAt: number
  /** When the last model step ran; without a question mark or my name in the new lines, the next step waits. */
  steppedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'great-question': {
      set: QuestionSet | null
      /** Question texts whose row is open; every row starts closed. */
      open: string[]
      /** The live rows as they stood when a row was opened; drawn instead of `live` until all rows close or the person takes the news. */
      held: Pick<Live, 'next' | 'added'> | null
      /** The second button row (language, sorting, view, export) is shown. */
      more: boolean
      /** A background agent is finding likely questions: when it started, for which occasion. */
      preparing: { since: number; occasion: string; folder?: string } | null
      /** Counts seconds while preparing, so the spinner turns. */
      tick: number
      /** Where sources point, by label; '' where nowhere. */
      links: Record<string, string>
      view: 'meeting' | 'practice'
      sortBy: 'confidence' | 'likelihood'
      lang: Lang
      /** Model and effort of the live step, the repository answers and the ASKED NOW lookup. */
      quality: Quality
      live: Live
      version: string
      /** The set a fresh session found stored for its folder, offered on the start screen; null when there is none. */
      previous: { title: string; count: number; generatedAt: string; folder: string } | null
      /** Sections whose fold is the opposite of their default: 'safe', 'earlier', 'prepared', 'sources'. Listening folds all four; paused, 'prepared' and 'safe' stand open. */
      toggled: string[]
    }
  }
}
