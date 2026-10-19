import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { IDLE, applyAnswers, detectTask, githubBase, ground, isTrigger, knowledge, logArgs, parseIdent, parseLog, parseSource, recentOf, settleLookup, applyReply, asRisk, grepArgs, isSameQuestion, parseAnswers, parseTranscript, rowKey, topHits } from '../hooks/live'
import type { Live, QuestionSet } from '../types'

const SET: QuestionSet = {
  title: 't',
  mode: 'pitch',
  generatedAt: '',
  sources: [],
  questions: [
    { question: 'What does it cost?', relevance: 5, confidence: 4, answers: [{ text: 'See offer', risk: 'sourced' }] },
    { question: 'Who leads?', relevance: 3, confidence: 4, answers: [{ text: 'Andreas', risk: 'sourced' }] },
  ],
}

const NDJSON = [
  '{"meta":{"v":3,"clock":"recording_active_ms"}}',
  '{"timestamp":"0:08","text":"Long ago.","endRecordingMs":8000,"speaker":{"id":1001,"source":"system","name":"Somebody"}}',
  '{"timestamp":"3:00","text":"Welcome.","endRecordingMs":180000,"speaker":{"id":1001,"source":"system","name":"Somebody"}}',
  '{"timestamp":"3:20","text":"Thanks.","endRecordingMs":200000,"speaker":{"id":1,"source":"mic","name":null}}',
  '{"timestamp":"3:31","text":"What does the MCP server need?","endRecordingMs":211000,"speaker":{"id":1002,"source":"system"}}',
  '{"broken',
].join('\n')

test('the transcript tail holds the last two minutes, labels the audio source and never carries names', async () => {
  const { lines, tail } = parseTranscript(NDJSON, 4)
  expect(lines).toBe(4)
  expect(tail).not.toContain('Long ago.')
  expect(tail).toContain('[3:20] Mic: Thanks.')
  expect(tail).toContain('[3:31] Call: What does the MCP server need?')
  expect(tail).not.toContain('Somebody')
})

test('lines past what the last step read are fresh, and the tail marks them for the model', async () => {
  const { tail, fresh } = parseTranscript(NDJSON, 2)
  expect(fresh).toEqual(['Thanks.', 'What does the MCP server need?'])
  expect(tail.split('\n')).toEqual(['[3:00] Call: Welcome.', '> [3:20] Mic: Thanks.', '> [3:31] Call: What does the MCP server need?'])
  expect(parseTranscript(NDJSON).fresh).toHaveLength(4)
  expect(parseTranscript(NDJSON, 4).fresh).toEqual([])
})

test('a trigger: a question mark, my name, a question word or verb up front, or a tag at the end', async () => {
  const names = ['Alex', 'Example']
  for (const yes of [
    'Does that work for everyone?',
    'alex, kannst du kurz was dazu sagen',
    'Und dann hat Example das gebaut',
    'Wie weit ist das Deployment',
    'Yeah, so what is the plan for PRE',
    'Okay, kannst du das zeigen',
    'Gibt es dazu schon ein Ticket',
    "Isn't that already on Q",
    'Could you share the numbers',
    'Das ist auf Q, oder',
    'Das passt so, ne.',
    'We ship it Friday, right',
    'Das läuft, nicht wahr',
  ])
    expect([yes, isTrigger([yes], names)]).toEqual([yes, true])
  for (const no of [
    'Thanks, that is all from my side.',
    'Okay.',
    'Das ist eine schöne Sache',
    'Alexander did the migration',
    'Done with the release notes.',
    'Wir haben das gestern deployed.',
    'Isolation tests are green.',
  ])
    expect([no, isTrigger([no], names)]).toEqual([no, false])
  expect(isTrigger(['No question.', 'Next one?'], [])).toBe(true)
  expect(isTrigger([], names)).toBe(false)
})

const next = (...qs: string[]) =>
  JSON.stringify({ asked: [], new: [], current: null, next: qs.map(question => ({ question, relevance: 4, confidence: 2, answers: [{ text: 'x', risk: 'vage' }] })) })

test('predictions stay until asked, keep their wording, and new ones join at the end', async () => {
  const first = applyReply({ ...IDLE, isOn: true }, null, next('Why Google?'))
  const second = applyReply(first, null, next('What about Italy?', 'Why Google?'))
  expect(second.next.map(q => q.question)).toEqual(['Why Google?', 'What about Italy?'])
  const kept = applyReply(second, null, next())
  expect(kept.next.map(q => q.question)).toEqual(['Why Google?', 'What about Italy?'])
  const asked = applyReply(kept, null, '{"asked":[],"new":[{"question":"What about Italy?","answers":[]}],"current":{"new":0},"next":[]}')
  expect(asked.current).toBe('What about Italy?')
  expect(asked.next.map(q => q.question)).toEqual(['Why Google?'])
  expect(asked.added.map(q => q.question)).toEqual(['What about Italy?'])
})

test('past five predictions the oldest one not predicted again goes', async () => {
  let state = applyReply({ ...IDLE, isOn: true }, null, next('Alpha one?', 'Bravo two?', 'Charlie three?'))
  state = applyReply(state, null, next('Alpha one?', 'Delta four?', 'Echo five?'))
  state = applyReply(state, null, next('Alpha one?', 'Foxtrot six?'))
  expect(state.next.map(q => q.question)).toEqual(['Alpha one?', 'Charlie three?', 'Delta four?', 'Echo five?', 'Foxtrot six?'])
})

test('new questions from the call are appended, never pushed out', async () => {
  let state = { ...IDLE, isOn: true }
  const topics = ['Italy', 'Spain', 'France', 'Poland', 'Norway', 'Greece', 'Austria', 'Sweden', 'Latvia', 'Malta']
  for (const t of topics) state = applyReply(state, null, `{"new":[{"question":"What about ${t} pricing?","answers":[]}]}`)
  expect(state.added.map(q => q.question)).toEqual(topics.map(t => `What about ${t} pricing?`))
})

test('a reworded question counts as the same; a row key follows the text alone', async () => {
  expect(isSameQuestion('What about Italy pricing?', 'What about Spain pricing?')).toBe(false)
  expect(isSameQuestion('Warum habt ihr Google gewählt?', 'Warum habt ihr euch für Google gewählt?')).toBe(true)
  expect(isSameQuestion('What does it cost?', 'Who leads?')).toBe(false)
  expect(rowKey('Who leads?')).toBe(rowKey('Who leads?'))
  expect(rowKey('Who leads?')).not.toBe(rowKey('What does it cost?'))
})

test('a reply marks asked questions, sets the current one and adds new ones once', async () => {
  const reply = `Sure: {"asked":[0],"current":{"new":0},"new":[{"question":"Do we need a licence for MCP?","relevance":4,"confidence":9,"answers":[{"text":"No","risk":"made-up"}]}]}`
  const once = applyReply({ ...IDLE, isOn: true }, SET, reply)
  expect(once.asked).toContain('What does it cost?')
  expect(once.current).toBe('Do we need a licence for MCP?')
  expect(once.added[0]?.confidence).toBe(5)
  expect(once.added[0]?.answers[0]?.risk).toBe('vague')

  const twice = applyReply(once, SET, reply)
  expect(twice.added).toHaveLength(1)
})

test('a reply without a usable current points ASKED NOW at the question it saw asked last, not the old one', async () => {
  const state = { ...IDLE, isOn: true, current: 'Do you use subcontractors?', asked: ['Do you use subcontractors?'] }
  expect(applyReply(state, SET, '{"asked":[1],"current":null}').current).toBe('Who leads?')
  const fresh = '{"new":[{"question":"Which payment methods at launch?","answers":[]}],"current":{"new":"0"}}'
  expect(applyReply(state, SET, fresh).current).toBe('Which payment methods at launch?')
  // Nothing newly asked: the question on the table stays.
  expect(applyReply(state, SET, '{"asked":[],"current":null}').current).toBe('Do you use subcontractors?')
})

test('a line without a speaker is nobody in particular, not my microphone', async () => {
  expect(parseTranscript('{"text":"Can you tell us which payment methods?","endRecordingMs":1}').tail).toBe('> [] Unknown: Can you tell us which payment methods?')
})

test('a reply that is no JSON leaves the state alone', async () => {
  const state = { ...IDLE, isOn: true, current: 'Who leads?' }
  expect(applyReply(state, SET, 'I could not tell.')).toEqual(state)
})

test('detecting asks for the chosen language, English reasons either way', async () => {
  expect(detectTask('x', 'en')).toContain('Write "question" and the answer "text"s in English.')
  expect(detectTask('x', 'de')).toContain('in German.')
  expect(detectTask('x')).toContain('in the language the meeting is held in')
  expect(detectTask('x', 'en')).toContain('"why" in English')
  expect(ground([{ question: 'q', hits: [] }], 'de')).toContain('in German. "note" in English.')
})

test("risk classes stored by 0.8 under German names are read in today's names", async () => {
  expect(asRisk('belegt')).toBe('sourced')
  expect(asRisk('zusage')).toBe('commitment')
  expect(asRisk('riskant')).toBe('risky')
  expect(asRisk('risky')).toBe('risky')
  expect(asRisk('made-up')).toBe('vague')
})

test('repository search: exports stay out, files with more of the words come first, at most eight lines', async () => {
  const args = grepArgs(['deploy', 'OpenTofu'])
  expect(args.slice(0, 2)).toEqual(['git', 'grep'])
  expect(args).toContain(':(exclude)question-sets')
  const stdout = ['README.md:3:how to deploy', 'docs/ops.md:12:We deploy with OpenTofu', 'docs/ops.md:40:OpenTofu state', ...Array.from({ length: 10 }, (_, i) => `x.md:${i}:deploy`)].join('\n')
  const hits = topHits(stdout, ['deploy', 'OpenTofu'])
  expect(hits[0]).toBe('docs/ops.md:12: We deploy with OpenTofu')
  expect(hits).toHaveLength(8)
})

test('answers land on their rows; a sourced one lifts its confidence; no JSON changes nothing', async () => {
  const q = { question: 'How do we deploy?', relevance: 3, confidence: 2, answers: [] }
  const state = { ...IDLE, added: [q], pending: ['How do we deploy?'], phase: 'answering' as const }
  const reply = '{"answers": [[{"text": "With OpenTofu", "risk": "sourced", "source": "docs/ops.md:12"}]]}'
  const grounded = applyAnswers(state, ['How do we deploy?'], reply)
  expect(grounded.added[0]?.answers[0]).toEqual({ text: 'With OpenTofu', risk: 'sourced', note: undefined, source: 'docs/ops.md:12' })
  expect(grounded.added[0]?.confidence).toBe(4)
  expect(grounded.pending).toEqual([])
  expect(grounded.phase).toBe('ready')
  expect(applyAnswers(state, ['How do we deploy?'], 'no idea')).toEqual(state)
  expect(parseAnswers('Here: {"answers": [{"text": "Yes", "risk": "belegt"}]}')).toEqual([{ text: 'Yes', risk: 'sourced', note: undefined, source: undefined }])
  expect(parseAnswers('nothing')).toEqual([])
})

test('detecting asks for words to look up, whom a question is for and who asked, but no answers', async () => {
  const t = detectTask('x')
  expect(t).toContain('"search"')
  expect(t).toContain('"to": "me" (asked of me, by name, or about my ticket or my work), "all" (asked of everyone) or "other"')
  expect(t).toContain('"asker": who asked, as a role or the first name as heard; leave it out when unknown.')
  expect(t).toContain('5 = addressed to me by name or about my ticket or work; 4 = my topic or area; 3 = asked of everyone; 2 = someone else\'s topic I could add to; 1 = clearly someone else\'s.')
  expect(t).toContain('A line from "Mic" is me speaking.')
  expect(t).toContain('a near spelling counts as my name')
  expect(t).toContain('"you", "du" or "Sie" alone is a weak cue.')
  expect(t).toContain('No answers')
  expect(t).not.toContain('"answers"')
})

test('a detect reply paints rows with whom they are for, and rows without answers wait for the answer step', async () => {
  const reply = JSON.stringify({
    new: [{ question: 'Alex, is the fix on PRE?', to: 'me', asker: 'Maria', relevance: 5 }],
    current: { new: 0 },
    next: [{ question: 'When does it go live?', to: 'everyone', asker: { name: 'x' } }],
  })
  const state = applyReply({ ...IDLE, isOn: true }, null, reply, 5_000)
  expect(state.added[0]).toMatchObject({ to: 'me', asker: 'Maria', heardAt: 5_000, answers: [] })
  expect(state.next[0]?.to).toBeUndefined()
  expect(state.next[0]?.asker).toBeUndefined()
  expect(state.pending).toEqual(['Alex, is the fix on PRE?', 'When does it go live?'])
  expect(state).toMatchObject({ phase: 'answering', currentAt: 5_000, steppedAt: 5_000, current: 'Alex, is the fix on PRE?' })
  // Answers for one of two: the other keeps waiting.
  const half = applyAnswers(state, state.pending, '{"answers": {"0": [{"text": "Yes, since Monday", "risk": "vague", "note": "thin"}]}}')
  expect(half.added[0]?.answers[0]?.text).toBe('Yes, since Monday')
  expect(half.pending).toEqual(['When does it go live?'])
  expect(half.phase).toBe('answering')
  // The same question again changes nothing about when it became current.
  const again = applyReply(half, null, '{"asked": [], "current": {"new": 0}, "new": [{"question": "Alex, is the fix on PRE?"}]}', 9_000)
  expect(again.currentAt).toBe(5_000)
  expect(again.steppedAt).toBe(9_000)
})

test('a finished lookup stops running; its answers stand in for the question, an empty one leaves them', async () => {
  const state = { ...IDLE, looking: ['How do we deploy?'] }
  const done = settleLookup(state, 'How do we deploy?', '{"answers": [{"text": "OpenTofu from CI", "risk": "sourced", "source": "ci.yml:3"}]}')
  expect(done.looking).toEqual([])
  expect(done.deep['How do we deploy?']?.[0]?.source).toBe('ci.yml:3')
  const failed = settleLookup(state, 'How do we deploy?', null)
  expect(failed.looking).toEqual([])
  expect(failed.deep).toEqual({})
})

test('a source label names a URL, an issue, or a file with its line; a GitHub remote gives its address', async () => {
  expect(githubBase('git@github.com:acme/pitch.git')).toBe('https://github.com/acme/pitch')
  expect(githubBase('https://github.com/acme/pitch')).toBe('https://github.com/acme/pitch')
  expect(githubBase('https://gitlab.com/acme/pitch.git')).toBeNull()
  expect(parseSource('Offer, https://drive.google.com/x/y.')).toEqual({ url: 'https://drive.google.com/x/y' })
  expect(parseSource('octo/repo#1, #2, #3')).toEqual({ repo: 'octo/repo', issue: '1' })
  expect(parseSource('Decision #6 (open)')).toEqual({ issue: '6' })
  expect(parseSource('docs/ops.md:12')).toEqual({ path: 'docs/ops.md', line: '12' })
  expect(parseSource('next-steps/README.md (0.7.0, Marketplace section)')).toEqual({ path: 'next-steps/README.md', line: undefined })
  expect(parseSource('Offer p. 4')).toBeNull()
})

test('grounded answers stay with their question when the model leaves one out', async () => {
  const homepage = { question: 'Can our marketing team change the homepage without asking a developer?', relevance: 4, confidence: 2, answers: [{ text: 'Through the CMS', risk: 'vague' as const }] }
  const retention = { question: 'How long is customer data kept, and who at your company can access it?', relevance: 4, confidence: 2, answers: [{ text: 'Depends', risk: 'vague' as const }] }
  const state = { ...IDLE, added: [homepage], next: [retention] }
  const asked = [homepage.question, retention.question]
  const confirm = '[{"text": "We will confirm the retention period and access policy in writing.", "risk": "commitment"}]'
  const short = applyAnswers(state, asked, `{"answers": [${confirm}]}`)
  expect(short.added[0]?.answers).toEqual(homepage.answers)
  const keyed = applyAnswers(state, asked, `{"answers": {"1": ${confirm}}}`)
  expect(keyed.added[0]?.answers).toEqual(homepage.answers)
  expect(keyed.next[0]?.answers[0]?.risk).toBe('commitment')
})

test('detecting is about the questions I have to answer; answering offers a safe answer before a promise', async () => {
  const t = detectTask('x', 'en', 'Alex Example')
  expect(t).toContain('I am the person this pane is for: Alex Example.')
  expect(t).toContain('asked last in this excerpt and is for me or for everyone, never one for someone else')
  expect(t).toContain('null when the excerpt asks none of those')
  expect(t).toContain('questions I will most likely have to answer next')
  expect(t).toContain('Lines marked ">" are new since the last look')
  expect(detectTask('x')).toContain('I am the person this pane is for.')
  const a = ground([{ question: 'How do we deploy?', hits: [] }, { question: 'Who runs it?', hits: ['ops.md:3: Team Blue runs it'] }], 'en')
  expect(a).toContain('0: How do we deploy?\nno lines found')
  expect(a).toContain('1: Who runs it?\nops.md:3: Team Blue runs it')
  expect(a).toContain('Only a "commitment" may promise anything')
  expect(a).toContain('When nothing is sourced, the first option is this one.')
  expect(a.indexOf('"vague": true and binding us to nothing')).toBeLessThan(a.indexOf('"commitment": only when the question asks'))
})

test('my last commits: name and email from git, one fact per commit with its source; anything else is nothing', async () => {
  expect(parseIdent('Alex Example <alex@example.com> 1760000000 +0200')).toEqual({ name: 'Alex Example', email: 'alex@example.com' })
  expect(parseIdent('fatal: not a git repository')).toBeNull()
  expect(logArgs('alex@example.com')).toContain('--author=alex@example.com')
  expect(logArgs('alex@example.com')).toContain('--no-merges')
  expect(parseLog('abc1234\t2026-10-14\tFix the publish rule\n\nnot a commit')).toEqual([{ text: 'Fix the publish rule', source: 'commit abc1234, 2026-10-14' }])
  expect(parseLog(null)).toEqual([])
})

test('recent work comes from the prepared set when it has some, else from listening, and the model sees it', async () => {
  const live = { ...IDLE, recent: [{ text: 'Fix the publish rule', source: 'commit abc1234, 2026-10-14' }] }
  expect(recentOf(SET, live)).toEqual(live.recent)
  const prepared = { ...SET, recent: [{ text: 'Tested 7822 on Q', source: 'PROJ-7822' }] }
  expect(recentOf(prepared, live)).toEqual(prepared.recent)
  expect(knowledge(null, live)).toContain('- Fix the publish rule (source: commit abc1234, 2026-10-14)')
  expect(knowledge(null, live)).not.toContain('(briefing)')
  expect(knowledge(null, live, 'memory/MEMORY.md:\nFocus: 7822')).toContain('Current facts from the repository, newest first (briefing):\nmemory/MEMORY.md:\nFocus: 7822')
})

/**
 * A session that listens from the start to a running recording whose lines the test speaks, with files in the
 * folder, a git that knows me, and a model that answers from a queue.
 */
const listening = async ($: Parameters<Parameters<typeof test>[1]>[0], on: On, files: Record<string, string> = {}, holdAnswers = false) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__great-question__show_questions' } }) as never)
  on('session.cwd', () => ({ value: '/repo' }) as never)
  on('agent.spawn', () => ({ model: 'haiku' }) as never)
  // The ear is on from the first write, without going through the pane; every later write is kept to look at.
  let live: Live = IDLE
  on('state.set', ($, e, next) => {
    if (e.key !== 'live') return next(e)
    live = { ...IDLE, ...(e.value as Live), ...(live === IDLE ? { isOn: true } : {}) }
    return next({ ...e, value: live } as never)
  })
  const said: string[] = []
  const replies: string[] = []
  const prompts: { text: string; cache?: boolean }[][] = []
  // The live state as each model call found it.
  const seen: Live[] = []
  const meet = { mtimeMs: clock.now(), reads: 0 }
  const under = (dir: string) => Object.keys(files).filter(f => f.startsWith(`${dir}/`))
  on('fs.list', ($, e) =>
    ({ value: e.path.endsWith('/meetings') ? [{ kind: 'dir', name: 'm1' }] : under(e.path).map(f => ({ kind: 'file', name: f.slice(e.path.length + 1) })) }) as never)
  on('fs.exists', ($, e) => ({ value: e.path.endsWith('live.ndjson') || e.path in files || under(e.path).length > 0 }) as never)
  on('fs.stat', () => ({ value: { mtimeMs: meet.mtimeMs } }) as never)
  on('fs.read', ($, e) => {
    if (!e.path.endsWith('live.ndjson')) return { value: files[e.path] ?? '' } as never
    meet.reads++
    return { value: said.map(text => JSON.stringify({ text, endRecordingMs: 1, speaker: { source: 'system' } })).join('\n') } as never
  })
  // Answer calls can be held open, as a slow model keeps them, until the test lets them go.
  let release = () => {}
  const held = new Promise<void>(go => (release = go))
  on('model.complete', async ($, e) => {
    prompts.push((e.promptBlocks ?? []) as { text: string; cache?: boolean }[])
    seen.push(live)
    const text = replies.shift() ?? '{}'
    if (holdAnswers && e.system?.startsWith('You answer questions')) await held
    return { value: text === 'FAIL' ? { isAnswered: false, reason: 'overloaded' } : { isAnswered: true, text, usage: {} } } as never
  })
  on('process.run', ($, e) => {
    const args = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args === 'git var GIT_AUTHOR_IDENT') return out('Alex Example <alex@example.com> 1760000000 +0200')
    if (args === 'git log --oneline -15' && files['git log']) return out(files['git log'])
    return out('', 1)
  })
  await $.session.start({ cwd: '/repo' } as never)
  /** A line said in the call: the file grows and its time moves. */
  const say = (text: string) => (said.push(text), (meet.mtimeMs = clock.now()))
  return { clock, say, replies, prompts, meet, seen, release, state: () => live }
}

test('new lines without a trigger wait up to twelve seconds for a step; my name steps at once', async ($, on) => {
  const { clock, say, prompts, state } = await listening($, on)
  say('Can everyone hear me?')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(1)
  expect(state().lines).toBe(1)

  say('Fine, thanks.')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(1)
  // Unread, yet counted and timed in the status line.
  expect(state().lines).toBe(1)
  expect(state().status).toBe('listening · 2 utterances · last utterance 3 s ago')
  await clock.advance(6_000)
  expect(prompts).toHaveLength(1)
  await clock.advance(3_000)
  expect(prompts).toHaveLength(2)
  expect(state().lines).toBe(2)

  say('alex kurz zu deinem Ticket')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(3)
  // Detecting is quick, with the knowledge first and cached.
  expect(prompts[2]?.[0]).toMatchObject({ cache: true })
  expect(prompts[2]?.[1]?.text).toContain('> [] Call: alex kurz zu deinem Ticket')
})

test('a step paints the questions first, then their answers; one left out keeps waiting', async ($, on) => {
  const { clock, say, replies, prompts, seen, state } = await listening($, on)
  say('Alex, is the fix on PRE?')
  replies.push(
    JSON.stringify({
      new: [{ question: 'Is the fix on PRE?', to: 'me', asker: 'Maria', search: ['PRE'], relevance: 5 }],
      current: { new: 0 },
      next: [{ question: 'When does it go live?', to: 'all', relevance: 3 }],
    }),
    '{"answers": {"0": [{"text": "It is on Q; PRE is still open", "risk": "vague", "note": "thin"}]}}',
  )
  await clock.advance(3_000)
  const between = seen[1]!
  expect(between).toMatchObject({ phase: 'answering', current: 'Is the fix on PRE?', currentAt: 1_003_000, steppedAt: 1_003_000 })
  expect(between.added[0]).toMatchObject({ to: 'me', asker: 'Maria', heardAt: 1_003_000, answers: [] })
  expect(between.pending).toEqual(['Is the fix on PRE?', 'When does it go live?'])
  // The answer step opens with the same knowledge, so the cache serves it, and names each question with its lines.
  expect(prompts[1]?.[0]).toEqual(prompts[0]?.[0])
  expect(prompts[1]?.[1]?.text).toContain('1: When does it go live?\nno lines found')

  const after = state()
  expect(after.added[0]?.answers[0]?.text).toBe('It is on Q; PRE is still open')
  expect(after.pending).toEqual(['When does it go live?'])
  expect(after.phase).toBe('answering')
  // The answer step leaves the status line to the ticks; the next one says what still waits.
  await clock.advance(3_000)
  expect(state().status).toContain('1 unanswered')

  // The next step answers it again, and then all is ready.
  say('Okay, und wann geht das live?')
  replies.push('{"asked": [], "current": null}', '{"answers": {"0": [{"text": "Not dated yet", "risk": "vague", "note": "no date"}]}}')
  await clock.advance(3_000)
  expect(prompts[3]?.[1]?.text).toContain('0: When does it go live?')
  expect(prompts[3]?.[1]?.text).not.toContain('Is the fix on PRE?')
  const done = state()
  expect(done.next[0]?.answers[0]?.text).toBe('Not dated yet')
  expect(done.pending).toEqual([])
  expect(done.phase).toBe('ready')
})

test('the briefing from the folder\'s memory and commits joins the knowledge; without them it stays out', async ($, on) => {
  const { clock, say, prompts } = await listening($, on, {
    '/repo/memory/MEMORY.md': 'Focus: the 7822 data fix',
    '/repo/memory/daily-logs/2026-10-17.md': 'oldest day',
    '/repo/memory/daily-logs/2026-10-18.md': 'older day',
    '/repo/memory/daily-logs/2026-10-19.md': 'newest day',
    '/repo/memory/daily-logs/README.md': 'how to write a log',
    'git log': 'abc1234 Fix the publish rule',
  })
  say('What is the status?')
  await clock.advance(3_000)
  const known = prompts[0]![0]!.text
  expect(known).toContain('Current facts from the repository, newest first (briefing):\nmemory/MEMORY.md:\nFocus: the 7822 data fix')
  expect(known.indexOf('newest day')).toBeLessThan(known.indexOf('older day'))
  expect(known).not.toContain('oldest day')
  expect(known).not.toContain('how to write a log')
  expect(known).toContain('git log --oneline -15:\nabc1234 Fix the publish rule')
})

test('without memory files or commits there is no briefing', async ($, on) => {
  const { clock, say, prompts } = await listening($, on)
  say('What is the status?')
  await clock.advance(3_000)
  expect(prompts[0]![0]!.text).not.toContain('(briefing)')
})

test('a transcript whose file did not change is not read again', async ($, on) => {
  const { clock, say, meet } = await listening($, on)
  say('Any questions?')
  await clock.advance(3_000)
  expect(meet.reads).toBe(1)
  await clock.advance(9_000)
  expect(meet.reads).toBe(1)
  say('One more?')
  await clock.advance(3_000)
  expect(meet.reads).toBe(2)
})

test('answers being written do not hold up the next question, and no question is answered twice at once', async ($, on) => {
  const { clock, say, replies, prompts, release, state } = await listening($, on, {}, true)
  say('Is the fix on PRE?')
  replies.push(JSON.stringify({ new: [{ question: 'Is the fix on PRE?', to: 'me' }], current: { new: 0 } }), '{"answers": {"0": [{"text": "On Q, PRE open", "risk": "vague", "note": "thin"}]}}')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(2)

  say('And who tests it?')
  replies.push(JSON.stringify({ new: [{ question: 'Who tests it?', to: 'all' }], current: { new: 0 } }), '{"answers": {"0": [{"text": "The trainers", "risk": "vague", "note": "check"}]}}')
  await clock.advance(3_000)
  // Detected while the first answers are still being written; the second answer call leaves the first question alone.
  expect(prompts).toHaveLength(4)
  expect(prompts[3]?.[1]?.text).toContain('0: Who tests it?')
  expect(prompts[3]?.[1]?.text).not.toContain('Is the fix on PRE?')
  expect(state().current).toBe('Who tests it?')
  expect(state().phase).toBe('answering')

  release()
  await clock.advance(0)
  expect(state().added.map(q => q.answers[0]?.text)).toEqual(['On Q, PRE open', 'The trainers'])
  expect(state().pending).toEqual([])
  expect(state().phase).toBe('ready')
})

test('a failed step waits six seconds before the same lines try again', async ($, on) => {
  const { clock, say, replies, prompts, state } = await listening($, on)
  say('Is the fix on PRE?')
  replies.push('FAIL')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(1)
  expect(state().status).toBe('model gave no answer (overloaded)')
  await clock.advance(3_000)
  expect(prompts).toHaveLength(1)
  await clock.advance(3_000)
  expect(prompts).toHaveLength(2)
})

test('a question for someone else lands in the list but does not take the place of mine', async () => {
  const mine = applyReply({ ...IDLE, isOn: true }, null, JSON.stringify({ new: [{ question: 'Alex, is the fix on PRE?', to: 'me' }], current: { new: 0 } }), 1_000)
  const other = applyReply(mine, null, JSON.stringify({ new: [{ question: 'Maciej, can you open 7810?', to: 'other' }], current: { new: 0 } }), 2_000)
  expect(other.current).toBe('Alex, is the fix on PRE?')
  expect(other.currentAt).toBe(1_000)
  expect(other.added.map(q => q.question)).toEqual(['Alex, is the fix on PRE?', 'Maciej, can you open 7810?'])
  // Without a pick, the last question for someone else does not stand in either.
  const unpicked = applyReply(mine, null, JSON.stringify({ new: [{ question: 'Maciej, and the PRE import?', to: 'other' }], current: null }), 3_000)
  expect(unpicked.current).toBe('Alex, is the fix on PRE?')
  // One for everyone does.
  const all = applyReply(other, null, JSON.stringify({ new: [{ question: 'Does anyone have news on PRE?', to: 'all' }], current: { new: 0 } }), 4_000)
  expect(all.current).toBe('Does anyone have news on PRE?')
  expect(all.currentAt).toBe(4_000)
})
