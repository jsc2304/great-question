import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { IDLE, rowKey } from '../hooks/live'
import type { Live, Question } from '../types'

/** The test's bottoms, and a way to put live state in place: the plugin's next write of it, set off by the ear button, is rewritten. */
const bottoms = (on: On) => {
  let wanted: Live | null = null
  on('state.set', ($, e, next) => {
    if (!wanted || e.key !== 'live') return next(e)
    const value = wanted
    wanted = null
    return next({ ...e, value } as never)
  })
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__great-question__show_questions' } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  // The live state as a listening step leaves it; no step runs, since the clock never moves.
  return async (ui: { press: (target: { key: string }) => Promise<unknown> }, value: Partial<Live>) => {
    wanted = { ...IDLE, ...value }
    await ui.press({ key: 'ear' })
  }
}

const T = (question: string) => `t${rowKey(question)}`
const PANE = { plugin: 'great-question', component: 'Pane', requestId: 'great-question', props: { title: 'Great Question', isFocused: false, bodyColumns: 60, placement: 'dock' } as never } as const

const SHIP = 'Can you ship by Friday?'
const asked: Question = {
  question: SHIP,
  relevance: 5,
  to: 'me',
  asker: 'Procurement',
  heardAt: 990_000,
  answers: [
    { text: 'Friday, yes', risk: 'commitment' },
    { text: 'Definitely Friday, whatever happens', risk: 'risky' },
    { text: 'It is on Q since Monday', risk: 'sourced', source: 'Q release notes' },
    { text: 'We are on it', risk: 'vague' },
  ],
}
const row = (question: string, extra: Partial<Question> = {}): Question => ({ question, relevance: 3, answers: [{ text: `About ${question}`, risk: 'vague' }], ...extra })

test('the card says who the question is for and who asked, leads with the best answer, warns once, hides the rest', async ($, on) => {
  const setLive = bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await setLive(ui, { isOn: true, current: SHIP, currentAt: 970_000, added: [asked] })
    expect(await ui.find({ type: 'Text', text: 'ASKED OF YOU · by Procurement · 30 s ago' })).toBeDefined()
    const question = await ui.find({ type: 'Text', text: SHIP })
    expect(question?.props.size).toBe('title')
    expect(question?.props.weight).toBe('semibold')
    expect((await ui.find({ type: 'Text', text: '● SAY IT' }))?.props.size).toBe('heading')
    expect((await ui.find({ type: 'Text', text: 'It is on Q since Monday' }))?.props.size).toBe('heading')
    expect(await ui.find({ text: 'Source: Q release notes' })).toBeDefined()
    const warning = await ui.find({ type: 'Text', text: "✖ Don't say: Definitely Friday, whatever happens" })
    expect(warning?.props.size).toBe('footnote')
    expect(warning?.props.wrap).toBe('truncate')
    // The rest waits behind one button; opening it shows every answer and holds the live lists.
    expect(await ui.find({ text: 'Friday, yes' })).toBeUndefined()
    await ui.press({ key: 'now-more' })
    expect(await ui.find({ text: 'Friday, yes' })).toBeDefined()
    expect(await ui.find({ text: 'We are on it' })).toBeDefined()
    expect(await ui.find({ key: 'now-more', text: '▾ fewer' })).toBeDefined()
    await setLive(ui, { isOn: true, current: SHIP, currentAt: 970_000, added: [asked], next: [row('What about Italy?')] })
    expect(await ui.find({ key: 'sync', text: /take 1 new/ })).toBeDefined()
    expect(await ui.find({ key: T('What about Italy?') })).toBeUndefined()
    await ui.press({ key: 'now-more' })
    expect(await ui.find({ key: 'sync' })).toBeUndefined()
    expect(await ui.find({ key: T('What about Italy?') })).toBeDefined()
    expect(await ui.find({ key: 'now-more', text: '▸ 2 more answers' })).toBeDefined()
    // A question for someone else steps back; one for nobody in particular is just asked now.
    await setLive(ui, { isOn: true, current: SHIP, added: [{ ...asked, to: 'other', asker: undefined }] })
    expect(await ui.find({ type: 'Text', text: 'ASKED · SOMEONE ELSE' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: SHIP }))?.props).toMatchObject({ weight: 'regular', dimColor: true })
    await setLive(ui, { isOn: true, current: SHIP, added: [{ ...asked, to: undefined, asker: undefined }], pending: [SHIP] })
    expect(await ui.find({ type: 'Text', text: 'ASKED NOW' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'answering …' })).toBeDefined()
    await ui.unmount()
  }
})

test('UP NEXT draws three rows at most, mine first, and says when an answer is still being written', async ($, on) => {
  const setLive = bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await setLive(ui, {
      isOn: true,
      next: [
        row('Who signs off?', { relevance: 5, to: 'other' }),
        row('When is my fix on PRE?', { relevance: 2, to: 'me' }),
        row('Older likely one?', { relevance: 4, heardAt: 10 }),
        row('Newer likely one?', { relevance: 4, heardAt: 20 }),
        row('Rare one?', { relevance: 1 }),
      ],
      pending: ['Who signs off?'],
    })
    expect(await ui.find({ type: 'Text', text: 'UP NEXT · FOR YOU · 3' })).toBeDefined()
    const shown = (await ui.findAll({ type: 'Button', text: /\?/ })).map(b => b.text)
    expect(shown).toEqual([
      '▸ When is my fix on PRE? · you',
      '▸ Who signs off?',
      '▸ Newer likely one?',
    ])
    expect(await ui.find({ key: T('Older likely one?') })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'answering …' })).toBeDefined()
    expect(await ui.find({ text: 'About Who signs off?' })).toBeUndefined()
    expect(await ui.find({ text: 'About Newer likely one?' })).toBeDefined()
    await ui.unmount()
  }
})

test('sections fold by listening state and turn on a press', async ($, on) => {
  const setLive = bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({
    tool: 'mcp__great-question__show_questions',
    title: 'Daily',
    mode: 'standup',
    sources: ['notes.md'],
    recent: [{ text: 'Tested the fix on Q' }],
    questions: [{ question: 'Is the fix done?', relevance: 5, confidence: 5, answers: [{ text: 'Yes, on Q', risk: 'sourced' }] }],
  })
  // A new set opens its first question, which holds the live lists: closed, the heard row comes in.
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'close-all' })
  await first.unmount()
  const heard = [row('How was the workshop?', { heardAt: 5 }), row('Any blockers?', { heardAt: 9 })]
  const folds = async (ui: { find: (q: { key: string }) => Promise<{ text: string } | undefined> }) =>
    Promise.all(['safe', 'earlier', 'prepared', 'sources'].map(async k => (await ui.find({ key: `fold:${k}` }))?.text.slice(0, 1)))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await setLive(ui, { added: heard })
    expect(await ui.find({ text: 'Daily · 1 prepared' })).toBeDefined()
    // Paused: the prepared questions and my recent work stand open.
    expect(await folds(ui)).toEqual(['▾', '▸', '▾', '▸'])
    expect(await ui.find({ key: 'fold:earlier', text: '▸ ASKED EARLIER · 2' })).toBeDefined()
    expect(await ui.find({ key: T('How was the workshop?') })).toBeUndefined()
    await ui.press({ key: 'fold:earlier' })
    // Newest first.
    expect((await ui.findAll({ type: 'Button', text: /workshop|blockers/ })).map(b => b.text)).toEqual(['▸ Any blockers?', '▸ How was the workshop?'])
    expect(await ui.find({ text: 'About How was the workshop?' })).toBeDefined()
    await ui.press({ key: 'fold:earlier' })
    // Listening: all four fold; a press opens one.
    await setLive(ui, { isOn: true, added: heard })
    expect(await folds(ui)).toEqual(['▸', '▸', '▸', '▸'])
    expect(await ui.find({ text: 'Tested the fix on Q' })).toBeUndefined()
    await ui.press({ key: 'fold:safe' })
    expect(await ui.find({ text: '● Tested the fix on Q' })).toBeDefined()
    await ui.press({ key: 'fold:safe' })
    await ui.unmount()
  }
})

test('while listening the ear button carries the status; anything else stays a line of its own', async ($, on) => {
  const setLive = bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await setLive(ui, { isOn: true, status: 'listening · 212 utterances · last utterance 12 s ago', phase: 'detecting' })
    expect(await ui.find({ key: 'ear', text: '◉ Listening · 212 utterances · 12 s ago' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /212 utterances/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'listening · detecting …' })).toBeDefined()
    await setLive(ui, { isOn: true, status: 'no running Wispr recording found' })
    expect(await ui.find({ key: 'ear', text: '◉ Listening' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'no running Wispr recording found' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'listening …' })).toBeDefined()
    await setLive(ui, { status: 'paused · 212 utterances read · results stay' })
    expect(await ui.find({ key: 'ear', text: 'Listen live' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'paused · 212 utterances read · results stay' })).toBeDefined()
    await ui.unmount()
  }
})
