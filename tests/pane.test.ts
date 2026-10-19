import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { rowKey } from '../hooks/live'
import { fromReply } from '../hooks/register'

const bottoms = (on: On, cwd: () => string = () => '/repo') => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__great-question__show_questions' } }) as never)
  on('session.cwd', () => ({ value: cwd() }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  return clock
}

const T = (question: string) => `t${rowKey(question)}`
const COST = T('What does stage 2 cost?')
const TEAM = T('Who is on the team?')
const PANE = { plugin: 'great-question', component: 'Pane', requestId: 'great-question', props: { title: 'Great Question', isFocused: false, bodyColumns: 60, placement: 'dock' } as never } as const

const SET = {
  title: 'Pitch Test',
  mode: 'pitch',
  sources: ['pitch/deck.html', { kind: 'meeting', label: 'Pitch transcript 13.10.' }, 'Decision #6 (open)'],
  questions: [
    { question: 'Who is on the team?', relevance: 5, confidence: 2, answers: [{ text: 'We already do that', risk: 'kaputt' }] },
    { question: 'What does stage 2 cost?', relevance: 2, confidence: 5, who: 'Procurement', answerer: 'Moritz', answers: [{ text: 'See the offer', risk: 'belegt' /* the 0.8 name: still read as sourced */, source: 'Offer p. 4' }] },
  ],
}

test('show_questions stores the set surest first, the pane draws it, practice turns it round', async ($, on) => {
  bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  const ran = await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET })
  expect(ran.deny).toBeUndefined()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'great-question',
      surface,
      component: 'Pane',
      requestId: 'great-question',
      props: { title: 'Great Question', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    // Surest answer first, although its question is the less likely one.
    const order = (await ui.findAll({ type: 'Button', text: /\?/ })).map(b => b.text)
    expect(order[0]).toContain('What does stage 2 cost?')
    expect(order[1]).toContain('Who is on the team?')
    expect(await ui.find({ text: 'SAFE TO ANSWER · 1' })).toBeDefined()
    expect(await ui.find({ text: /^─{8,}$/ })).toBeDefined()
    expect(await ui.find({ text: 'Repository' })).toBeDefined()
    expect(await ui.find({ text: '• pitch/deck.html' })).toBeDefined()
    expect(await ui.find({ text: 'Meetings & transcripts' })).toBeDefined()
    expect(await ui.find({ text: 'Issues & tickets' })).toBeDefined()
    expect(await ui.find({ text: 'Source: Offer p. 4' })).toBeDefined()
    expect(await ui.find({ text: /● SAY IT/ })).toBeDefined()
    expect(await ui.find({ text: 'Likely asked by: Procurement' })).toBeDefined()
    expect(await ui.find({ text: 'Answered by us: Moritz' })).toBeDefined()
    expect(await ui.find({ text: 'We already do that' })).toBeUndefined()
    await ui.press({ key: TEAM })
    expect(await ui.find({ text: 'We already do that' })).toBeDefined()
    await ui.press({ key: TEAM })

    // One row open: Close all closes it straight away, without opening the rest first.
    await ui.press({ key: 'close-all' })
    expect(await ui.find({ text: 'Source: Offer p. 4' })).toBeUndefined()
    expect(await ui.find({ key: 'close-all' })).toBeUndefined()
    // Open all reaches every row and goes once every row is open; Close all closes them again.
    await ui.press({ key: 'open-all' })
    expect(await ui.find({ text: 'We already do that' })).toBeDefined()
    expect(await ui.find({ key: 'open-all' })).toBeUndefined()
    await ui.press({ key: 'close-all' })
    expect(await ui.find({ text: 'We already do that' })).toBeUndefined()
    await ui.press({ key: COST })

    // Stopping the listener pauses it: the status stays and says so.
    await ui.press({ key: 'ear' })
    await ui.press({ key: 'ear' })
    expect(await ui.find({ text: /paused · 0 utterances read · results stay/ })).toBeDefined()

    // Language, sorting, view and export sit behind More.
    expect(await ui.find({ key: 'more', text: 'More ▸' })).toBeDefined()
    expect(await ui.find({ key: 'lang' })).toBeUndefined()
    await ui.press({ key: 'more' })
    expect(await ui.find({ text: /^Prepared / })).toBeDefined()
    // The language button cycles Auto → DE → EN → Auto.
    expect(await ui.find({ key: 'lang', text: /Language: Auto/ })).toBeDefined()
    await ui.press({ key: 'lang' })
    await ui.press({ key: 'lang' })
    expect(await ui.find({ key: 'lang', text: /Language: EN/ })).toBeDefined()
    await ui.press({ key: 'lang' })

    // Sorting by likelihood puts the likely question first, under its own group.
    await ui.press({ key: 'sort' })
    const likely = (await ui.findAll({ type: 'Button', text: /\?/ })).map(b => b.text)
    expect(likely[0]).toContain('Who is on the team?')
    expect(await ui.find({ text: 'VERY LIKELY · 1' })).toBeDefined()
    await ui.press({ key: 'sort' })

    // Practice turns it round: the unsure question leads.
    await ui.press({ key: 'view' })
    const practice = (await ui.findAll({ type: 'Button', text: /\?/ })).map(b => b.text)
    expect(practice[0]).toContain('Who is on the team?')
    await ui.press({ key: 'view' })
    await ui.press({ key: 'more' })
    await ui.unmount()
  }
})

test('Export writes the pane as Markdown into question-sets/', async ($, on) => {
  bottoms(on)
  const written: { path: string; text: string }[] = []
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET })
  const ui = await $.ui.mount({
    plugin: 'great-question',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'great-question',
    props: { title: 'Great Question', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  await ui.press({ key: 'more' })
  await ui.press({ key: 'export' })
  await ui.unmount()

  expect(written).toHaveLength(1)
  expect(written[0]!.path).toMatch(/^\/repo\/question-sets\/\d{4}-\d{2}-\d{2}-\d{4}-pitch-test\.md$/)
  const md = written[0]!.text
  expect(md).toContain('# Pitch Test')
  expect(md).toContain('## Safe to answer')
  expect(md).toContain('### What does stage 2 cost?')
  expect(md).toContain('- Answered by us: Moritz')
  expect(md).toContain('**● SAY IT** · sourced')
  expect(md).toContain('Source: Offer p. 4')
  expect(md).toContain('**Meetings & transcripts**')
  expect(md.indexOf('What does stage 2 cost?')).toBeLessThan(md.indexOf('Who is on the team?'))
})

test('Generate asks for the chosen language', async ($, on) => {
  bottoms(on)
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({
    plugin: 'great-question',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'great-question',
    props: { title: 'Great Question', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  await ui.press({ key: 'more' })
  await ui.press({ key: 'lang' })
  await ui.press({ key: 'lang' })
  await ui.press({ key: 'gen' })
  await ui.unmount()

  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Write "question" and the answer "text"s in English.')
  expect(prompts[0]).toContain('Return the language used as "language".')
})

test('an empty set is refused', async ($, on) => {
  bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  const ran = await $.tool.call({ tool: 'mcp__great-question__show_questions', title: 'x', mode: 'pitch', questions: [] })
  expect(ran.deny).toBeDefined()
})

const guess = (question: string) => ({ question, relevance: 4, confidence: 2, answers: [{ text: 'It depends', risk: 'vague', note: 'promise nothing' }] })

type Row = { question: string; answers?: unknown[] }

/** A step's two replies: the questions without answers, then their answers by number, as the model gives them. */
const detectThenAnswer = (reply: { new?: Row[]; next?: Row[] }) => {
  const rows = [...(reply.new ?? []), ...(reply.next ?? [])]
  const bare = (list?: Row[]) => list?.map(({ answers, ...q }) => q)
  const answered = rows.some(q => q.answers?.length)
  return [JSON.stringify({ ...reply, new: bare(reply.new), next: bare(reply.next) }), ...(answered ? [JSON.stringify({ answers: { ...rows.map(q => q.answers ?? []) } })] : [])]
}

/** A running Wispr recording that grows by one question per step, and a model that answers from a queue. */
const meeting = (on: On, clock: { now: () => number }) => {
  const replies: string[] = []
  let lines = 0
  // The file's time moves only when a line is written.
  let wrote = { lines: 0, at: clock.now() }
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ((wrote = wrote.lines === lines ? wrote : { lines, at: clock.now() }), { value: { mtimeMs: wrote.at } }) as never)
  on('fs.read', ($, e) =>
    ({ value: e.path.endsWith('live.ndjson') ? Array.from({ length: lines }, (_, i) => JSON.stringify({ text: `Sentence ${i}?`, endRecordingMs: i })).join('\n') : '' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: replies.shift() ?? '{}', usage: {} } }) as never)
  return (reply?: { new?: Row[]; next?: Row[] }) => {
    if (reply) {
      lines++
      replies.push(...detectThenAnswer(reply))
    }
  }
}

test('while a row is open the live rows stand still; new ones wait behind take new and arrive closed', async ($, on) => {
  const clock = bottoms(on)
  const say = meeting(on, clock)
  const step = async (reply?: object) => (say(reply), clock.advance(3_000))
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ear' })
  expect(await ui.find({ text: 'no question recognised yet' })).toBeDefined()

  // The first question of a new set is open, so the live rows hold.
  await step({ next: [guess('Why Google?')] })
  expect(await ui.find({ key: T('Why Google?') })).toBeUndefined()
  expect(await ui.find({ key: 'sync', text: /take 1 new/ })).toBeDefined()
  expect(await ui.find({ text: /listening · 1 utterances · last utterance 0 s ago/ })).toBeDefined()
  await ui.press({ key: 'sync' })
  // In, closed, its best answer on one line; the open question stays open.
  expect(await ui.find({ key: T('Why Google?') })).toBeDefined()
  expect(await ui.find({ text: /It depends/ })).toBeDefined()
  expect(await ui.find({ text: 'Note: promise nothing' })).toBeUndefined()
  expect(await ui.find({ text: 'Source: Offer p. 4' })).toBeDefined()
  expect(await ui.find({ key: 'sync' })).toBeUndefined()

  // All closed: news flows straight in, after what was there.
  await ui.press({ key: COST })
  await step({ next: [guess('What about Italy?')] })
  const live = (await ui.findAll({ type: 'Button', text: /Google|Italy/ })).map(b => b.text)
  expect(live).toEqual([expect.stringContaining('Why Google?'), expect.stringContaining('What about Italy?')])
  expect(await ui.find({ key: 'sync' })).toBeUndefined()

  // Nobody speaks: the status says how long ago the transcript last grew (as of the last 3 s tick).
  await clock.advance(21_000)
  expect(await ui.find({ text: /last utterance 21 s ago/ })).toBeDefined()

  // An asked question keeps its place while listening, marked ✓; paused, it moves to the end.
  await step({ asked: [1], current: { set: 1 } })
  expect(await ui.find({ text: /ALREADY ASKED/ })).toBeUndefined()
  expect(await ui.find({ text: /ASKED NOW/ })).toBeDefined()
  await ui.press({ key: 'ear' })
  await ui.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const again = await $.ui.mount({ ...PANE, surface })
    expect(await again.find({ text: 'ALREADY ASKED · 1' })).toBeDefined()
    expect(await again.find({ key: T('What about Italy?') })).toBeDefined()
    await again.unmount()
  }
})

test('a question from the call is answered from the repository; a lookup starts for the question asked now', async ($, on) => {
  const clock = bottoms(on)
  const replies: string[] = []
  const spawned: string[] = []
  let lines = 0
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: clock.now() } }) as never)
  on('fs.read', ($, e) =>
    ({ value: e.path.endsWith('live.ndjson') ? Array.from({ length: lines }, (_, i) => JSON.stringify({ text: `Sentence ${i}?`, endRecordingMs: i })).join('\n') : '' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: replies.shift() ?? '{}', usage: {} } }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'docs/ops.md:12:We deploy with OpenTofu', stderr: '' } }) as never)
  on('agent.spawn', ($, e) => (spawned.push(e.prompt), { agentId: 'ag1', model: 'haiku' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: COST })
  await ui.press({ key: 'ear' })

  // The step finds a new question with words to look up; the second call answers it from the lines found.
  lines = 1
  replies.push(
    JSON.stringify({ new: [{ question: 'How do we deploy?', search: ['deploy'] }], current: { new: 0 } }),
    JSON.stringify({ answers: [[{ text: 'With OpenTofu', risk: 'sourced', source: 'docs/ops.md:12' }]] }),
  )
  await clock.advance(3_000)
  expect(await ui.find({ text: 'With OpenTofu' })).toBeDefined()
  expect(await ui.find({ text: 'Source: docs/ops.md:12' })).toBeDefined()
  expect(await ui.find({ text: 'Somehow' })).toBeUndefined()
  // Asked now and not prepared: a subagent looks it up.
  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toContain('How do we deploy?')
  // The engine sets the subagent's id; a test's answer to agent.spawn starts none, so the kit stops here.
  // settleLookup, which folds the subagent's answer in, is covered in live.test.ts.
  await ui.unmount()
})

test('the background agent\'s reply becomes prepared questions; anything else is nothing', async () => {
  const reply = `Here you go: ${JSON.stringify({ ...SET })}`
  const set = fromReply(reply, '2026-10-15 08:00')
  expect(set?.questions.map(q => q.question)).toEqual(['What does stage 2 cost?', 'Who is on the team?'])
  expect(set?.questions[0]?.answers[0]?.risk).toBe('sourced')
  expect(fromReply('I could not find anything.', 'x')).toBeNull()
  expect(fromReply(JSON.stringify({ ...SET, questions: [] }), 'x')).toBeNull()
})

test('Find likely questions starts a background agent with a JSON task; without one the session prepares them', async ($, on) => {
  bottoms(on)
  const spawned: string[] = []
  const prompts: string[] = []
  on('agent.spawn', ($, e) => (spawned.push(e.prompt), { model: 'opus' }) as never)
  on('prompt.submit', ($, e) => (prompts.push(e.text), { text: e.text }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'gen', text: 'Find likely questions' })).toBeDefined()
  await ui.press({ key: 'gen' })
  await ui.unmount()
  expect(spawned).toHaveLength(1)
  expect(spawned[0]).toContain('Reply with one JSON object only')
  expect(spawned[0]).not.toContain('Load the tool')
  // The kit's answer to agent.spawn starts no agent (the engine sets its id), so the session takes over here.
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Load the tool mcp__great-question__show_questions')
})

test('with nothing prepared the pane offers where to start; a start names the folder', async ($, on) => {
  bottoms(on)
  const spawned: string[] = []
  on('agent.spawn', ($, e) => (spawned.push(e.prompt), { model: 'opus' }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: 'Where do you want to start?' })).toBeDefined()
    expect(await ui.find({ key: 'start-repo', text: /Likely questions about repo/ })).toBeDefined()
    expect(await ui.find({ key: 'start-meeting' })).toBeDefined()
    expect(await ui.find({ key: 'start-daily' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'start-meeting' })
  await ui.unmount()
  expect(spawned[0]).toContain('my next meeting in the calendar')
})

test('a source file links to GitHub when its repository has it on origin; only local, it stays text', async ($, on) => {
  bottoms(on)
  on('fs.exists', () => ({ value: true }) as never)
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args === 'git rev-parse --show-toplevel') return out('/repo')
    if (args === 'git remote get-url origin') return out('git@github.com:acme/pitch.git')
    if (args.startsWith('git cat-file -e origin/HEAD:pitch/deck.html')) return out('')
    return out('', 128)
  })
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET, sources: [...SET.sources, 'notes/local.md'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: 'Where do you want to start?' })).toBeUndefined()
  const link = await ui.find({ type: 'Link', text: 'pitch/deck.html' })
  expect(link?.props.href).toBe('https://github.com/acme/pitch/blob/HEAD/pitch/deck.html')
  expect((await ui.find({ type: 'Link', text: 'Decision #6 (open)' }))?.props.href).toBe('https://github.com/acme/pitch/issues/6')
  expect(await ui.find({ type: 'Link', text: 'notes/local.md' })).toBeUndefined()
  expect(await ui.find({ text: '• notes/local.md' })).toBeDefined()
  await ui.unmount()
})

test('listening with nothing prepared: questions from the transcript, answers from the repository', async ($, on) => {
  const clock = bottoms(on)
  const replies: string[] = []
  const prompts: string[] = []
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: clock.now() } }) as never)
  on('fs.read', ($, e) => ({ value: e.path.endsWith('live.ndjson') ? JSON.stringify({ text: 'How do we deploy?', endRecordingMs: 1 }) : '' }) as never)
  on('model.complete', ($, e) => (prompts.push(JSON.stringify(e.prompt)), { value: { isAnswered: true, text: replies.shift() ?? '{}', usage: {} } }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'docs/ops.md:12:We deploy with OpenTofu', stderr: '' } }) as never)
  on('agent.spawn', () => ({ model: 'haiku' }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ear' })
  replies.push(
    JSON.stringify({ new: [{ question: 'How do we deploy?', search: ['deploy'] }], current: { new: 0 } }),
    JSON.stringify({ answers: [[{ text: 'With OpenTofu', risk: 'sourced', source: 'docs/ops.md:12' }]] }),
  )
  await clock.advance(3_000)
  expect(prompts[0]).toContain('No prepared question set.')
  expect(await ui.find({ text: 'With OpenTofu' })).toBeDefined()
  await ui.unmount()
})

test('a reply whose note or source is not text cannot blank the pane', async ($, on) => {
  const clock = bottoms(on)
  const say = meeting(on, clock)
  on('agent.spawn', () => ({ model: 'haiku' }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'ear' })
  // Asked now, so ASKED NOW draws its answers at once; before 0.10.3 the engine refused every redraw from here on.
  say({ new: [{ question: 'How do we deploy?', answers: [{ text: 'Somehow', risk: 'vague', note: { why: 'x' }, source: { path: 'docs/ops.md' } }] }], current: { new: 0 } } as never)
  await clock.advance(3_000)
  expect(await ui.find({ text: 'Somehow' })).toBeDefined()
  await ui.press({ key: 'ear' })
  expect(await ui.find({ key: 'ear', text: 'Listen live' })).toBeDefined()
  await ui.unmount()
})

test('a pane blanked by answers 0.10.2 kept draws again once the mod loads anew', async ($, on) => {
  bottoms(on)
  // What 0.10.2 could keep: the question asked now, its lookup's answer with an object note.
  const bad = [{ text: 'Somehow', risk: 'vague', note: { why: 'x' } }]
  let isOld = true
  on('state.set', ($, e, next) =>
    next(isOld && e.key === 'live' ? ({ ...e, value: { ...(e.value as object), current: 'How?', added: [{ question: 'How?', relevance: 3, answers: bad }], deep: { 'How?': bad } } } as never) : e))
  await $.session.start({ cwd: '/repo' } as never)
  isOld = false
  await expect($.ui.mount({ ...PANE, surface: 'desktop' })).rejects.toThrow(/refused/)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: 'Somehow' })).toBeDefined()
  await ui.unmount()
})

test('a link lookup that fails is not kept: the next tick tries again and the link appears', async ($, on) => {
  const clock = bottoms(on)
  let isDown = true
  const logs: string[] = []
  on('fs.exists', () => ({ value: true }) as never)
  on('ui.log', ($, e) => (logs.push(String(e.text)), { value: undefined }) as never)
  on('process.run', ($, e) => {
    if (isDown) return { deny: 'not yet' } as never
    const args = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args === 'git rev-parse --show-toplevel') return out('/repo')
    if (args === 'git remote get-url origin') return out('https://github.com/acme/pitch.git')
    if (args.startsWith('git cat-file -e origin/HEAD:pitch/deck.html')) return out('')
    return out('', 128)
  })
  await $.session.start({ cwd: '/repo' } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET })
  expect(logs).toHaveLength(1)
  isDown = false
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Link', text: 'pitch/deck.html' })).toBeUndefined()
  // The next tick tries again, outside drawing.
  await clock.advance(20_000)
  expect((await ui.find({ type: 'Link', text: 'pitch/deck.html' }))?.props.href).toBe('https://github.com/acme/pitch/blob/HEAD/pitch/deck.html')
  await ui.unmount()
})

test('source paths count from the folder the questions were prepared in, wherever the session is now', async ($, on) => {
  let cwd = '/work/mods'
  const clock = bottoms(on, () => cwd)
  const seen: string[] = []
  on('fs.exists', ($, e) => (seen.push(e.path), { value: e.path === '/work/mods/next-steps/README.md' }) as never)
  let isDown = true
  on('process.run', ($, e) => {
    if (isDown) return { deny: 'not yet' } as never
    const args = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args === 'git rev-parse --show-toplevel') return out('/work/mods/next-steps')
    if (args === 'git remote get-url origin') return out('https://github.com/acme/next-steps.git')
    if (args.startsWith('git cat-file -e origin/HEAD:README.md')) return out('')
    return out('', 128)
  })
  await $.session.start({ cwd } as never)
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET, sources: ['next-steps/README.md (0.7.0)'] })
  // The first lookup failed; the session's shell has moved on before the next tick tries again.
  cwd = '/work/mods/great-question'
  isDown = false
  seen.length = 0
  await clock.advance(20_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Link', text: 'next-steps/README.md (0.7.0)' }))?.props.href).toBe('https://github.com/acme/next-steps/blob/HEAD/README.md')
  expect(seen.every(p => p.startsWith('/work/mods/') && !p.startsWith('/work/mods/great-question/'))).toBe(true)
  await ui.unmount()
})

test('listening: my last commits stay on show as safe to say; a closed row offers the safe answer, not the promise', async ($, on) => {
  const clock = bottoms(on)
  const replies: string[] = []
  const prompts: string[] = []
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: clock.now() } }) as never)
  on('fs.read', ($, e) => ({ value: e.path.endsWith('live.ndjson') ? JSON.stringify({ text: 'Alex, how is the publish fix going?', endRecordingMs: 1 }) : '' }) as never)
  on('model.complete', ($, e) => (prompts.push(JSON.stringify(e.prompt)), { value: { isAnswered: true, text: replies.shift() ?? '{}', usage: {} } }) as never)
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args === 'git var GIT_AUTHOR_IDENT') return out('Alex Example <alex@example.com> 1760000000 +0200')
    if (args.startsWith('git log')) return out('abc1234\t2026-10-14\tFix the publish rule')
    return out('', 1)
  })
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ear' })
  replies.push(
    ...detectThenAnswer({
      next: [{ question: 'When is the fix on PRE?', answers: [
        { text: 'Tomorrow at nine', risk: 'commitment', note: 'nobody agreed a date' },
        { text: 'It is fixed on Q; PRE is still open', risk: 'vague', note: 'thin' },
      ] }],
    }),
  )
  await clock.advance(3_000)
  expect(prompts[0]).toContain('Alex Example')
  expect(prompts[0]).toContain('Fix the publish rule (source: commit abc1234, 2026-10-14)')
  expect(await ui.find({ text: 'SAFE TO SAY · MY RECENT WORK · 1' })).toBeDefined()
  expect(await ui.find({ text: '● Fix the publish rule' })).toBeDefined()
  expect(await ui.find({ text: 'Source: commit abc1234, 2026-10-14' })).toBeDefined()
  expect(await ui.find({ text: /○ WEAK:/ })).toBeDefined()
  expect(await ui.find({ text: /ONLY IF COVERED:/ })).toBeUndefined()
  await ui.unmount()
})

test('prepared questions carry what I worked on last; the pane shows it without listening', async ($, on) => {
  bottoms(on)
  await $.session.start({ cwd: '/repo' } as never)
  const set = fromReply(JSON.stringify({ ...SET, recent: [{ text: 'Tested the fix on Q', source: 'Decision #6 (open)' }, { nope: 1 }] }), '2026-10-15 08:00')
  expect(set?.recent).toEqual([{ text: 'Tested the fix on Q', source: 'Decision #6 (open)' }])
  await $.tool.call({ tool: 'mcp__great-question__show_questions', ...SET, recent: set?.recent })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: '● Tested the fix on Q' })).toBeDefined()
  await ui.unmount()
})

test('a reply cut short or not JSON leaves the lines unread: the status says so and the next step tries them again', async ($, on) => {
  const clock = bottoms(on)
  const replies = ['{"new": [{"question": "Which payment methods at launch?", "to": "a', ...detectThenAnswer({ new: [guess('Which payment methods at launch?')], current: { new: 0 } } as never)]
  const limits: number[] = []
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: clock.now() } }) as never)
  on('fs.read', ($, e) => ({ value: e.path.endsWith('live.ndjson') ? JSON.stringify({ text: 'Which payment methods at launch?', endRecordingMs: 1 }) : '' }) as never)
  on('model.complete', ($, e) => (limits.push(e.maxTokens ?? 0), { value: { isAnswered: true, text: replies.shift() ?? '{}', usage: {} } }) as never)
  on('agent.spawn', () => ({ model: 'haiku' }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ear' })
  await clock.advance(3_000)
  expect(await ui.find({ text: 'model reply was no JSON; trying again' })).toBeDefined()
  // The transcript has not grown, yet the step runs again after a short wait and the question arrives.
  await clock.advance(6_000)
  expect(await ui.find({ text: 'Which payment methods at launch?' })).toBeDefined()
  // Finding questions is short; their answers get room for three options each.
  expect(limits).toEqual([700, 700, 1800])
  expect(await ui.find({ text: /last utterance 0 s ago/ })).toBeDefined()
  await ui.unmount()
})

test('the Model button sets who answers live and how hard it thinks', async ($, on) => {
  const clock = bottoms(on)
  const asked: { model: string; effort?: string; timeoutMs?: number }[] = []
  const spawned: { model?: string; effort?: unknown }[] = []
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ kind: 'dir', name: 'm1' }] }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: clock.now() } }) as never)
  let lines = 0
  on('fs.read', ($, e) => ({ value: e.path.endsWith('live.ndjson') ? Array.from({ length: lines }, (_, i) => JSON.stringify({ text: `S ${i}`, endRecordingMs: i })).join('\n') : '' }) as never)
  on('model.complete', ($, e) => (asked.push({ model: e.model, effort: e.effort, timeoutMs: e.timeoutMs }), { value: { isAnswered: true, text: JSON.stringify({ new: [{ question: 'How do we deploy?', answers: [] }], current: { new: 0 } }), usage: {} } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('agent.spawn', ($, e) => (spawned.push({ model: e.model, effort: e.effort }), { model: 'x' }) as never)
  await $.session.start({ cwd: '/repo' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'more' })
  expect(await ui.find({ key: 'quality', text: /Model: Fast \(Haiku\)/ })).toBeDefined()
  await ui.press({ key: 'quality' })
  await ui.press({ key: 'quality' })
  expect(await ui.find({ key: 'quality', text: /Model: Thorough \(Sonnet, high\)/ })).toBeDefined()
  await ui.press({ key: 'ear' })
  lines = 1
  await clock.advance(3_000)
  // Finding the questions is always quick; the level decides who answers them.
  expect(asked[0]).toEqual({ model: 'haiku', effort: 'low', timeoutMs: 15_000 })
  expect(asked[1]).toEqual({ model: 'sonnet', effort: 'high', timeoutMs: 90_000 })
  expect(spawned[0]?.model).toBe('sonnet')
  await ui.press({ key: 'quality' })
  expect(await ui.find({ key: 'quality', text: /Model: Fast/ })).toBeDefined()
  await ui.unmount()
})
