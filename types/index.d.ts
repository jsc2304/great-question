export type Risk = 'sourced' | 'vague' | 'commitment' | 'risky'
export type Answer = { text: string; risk: Risk; note?: string; source?: string }
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
}
export type SourceKind = 'meeting' | 'repo' | 'ticket' | 'doc' | 'calendar' | 'other'
export type Source = { kind: SourceKind; label: string }
export type Lang = 'auto' | 'de' | 'en'
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
}

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
      live: Live
      version: string
    }
  }
}
