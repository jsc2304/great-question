import { expect, test } from 'claude-code/testing'

import { IDLE, applyGrounding, githubBase, parseSource, settleLookup, applyReply, asRisk, grepArgs, isSameQuestion, parseAnswers, parseTranscript, rowKey, task, topHits } from '../hooks/live'
import type { QuestionSet } from '../types'

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
  const { lines, tail } = parseTranscript(NDJSON)
  expect(lines).toBe(4)
  expect(tail).not.toContain('Long ago.')
  expect(tail).toContain('[3:20] Mic: Thanks.')
  expect(tail).toContain('[3:31] Call: What does the MCP server need?')
  expect(tail).not.toContain('Somebody')
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

test('a reply that is no JSON leaves the state alone', async () => {
  const state = { ...IDLE, isOn: true, current: 'Who leads?' }
  expect(applyReply(state, SET, 'I could not tell.')).toEqual(state)
})

test('the live task asks for the chosen language, English notes either way', async () => {
  expect(task('x', 'en')).toContain('Write "question" and the answer "text"s in English.')
  expect(task('x', 'de')).toContain('in German.')
  expect(task('x')).toContain('in the language the meeting is held in')
  expect(task('x', 'en')).toContain('"why" and "note" in English')
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

test('grounded answers replace a live question\'s own; a sourced one lifts its confidence; no JSON changes nothing', async () => {
  const q = { question: 'How do we deploy?', relevance: 3, confidence: 2, answers: [{ text: 'Somehow', risk: 'vague' as const }] }
  const state = { ...IDLE, added: [q] }
  const reply = '{"answers": [[{"text": "With OpenTofu", "risk": "sourced", "source": "docs/ops.md:12"}]]}'
  const grounded = applyGrounding(state, ['How do we deploy?'], reply)
  expect(grounded.added[0]?.answers[0]).toEqual({ text: 'With OpenTofu', risk: 'sourced', note: undefined, source: 'docs/ops.md:12' })
  expect(grounded.added[0]?.confidence).toBe(4)
  expect(applyGrounding(state, ['How do we deploy?'], 'no idea')).toEqual(state)
  expect(parseAnswers('Here: {"answers": [{"text": "Yes", "risk": "belegt"}]}')).toEqual([{ text: 'Yes', risk: 'sourced', note: undefined, source: undefined }])
  expect(parseAnswers('nothing')).toEqual([])
})

test('the live task asks for words to look up in the repository', async () => {
  expect(task('x')).toContain('"search"')
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
