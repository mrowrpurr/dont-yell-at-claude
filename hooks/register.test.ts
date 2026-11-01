import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:/Users/test'
const CONFIG_PATH = `${HOME}/.dont-yell.json.b64`
const SESSION = 'sess-1'
const NOTICE_PATH = `${HOME}/.dont-yell.notice.${SESSION}.txt`
const BLOCK_PATH = `${HOME}/.dont-yell.block.${SESSION}.txt`
const TRAILER = "( message from the Don't Yell claude mod, agents can ignore this )"
const DEFAULT_BLOCKED_MESSAGE = '[dont-yell-at-claude] prompt blocked: it matched a replacement and "block" is on'

type Harness = { written: Record<string, string> }

/** The engine hands hooks OS-native paths; compare with forward slashes. */
const norm = (p: string) => p.replace(/\\/g, '/')

/** Wires env, session id, and an in-memory config file (raw text, already base64 unless `rawFile` is given). */
function setup(on: Parameters<Parameters<typeof test>[1]>[1], config?: object, rawFile?: string): Harness {
  mock.env(on, { USERPROFILE: HOME })
  on('session.id', () => ({ value: SESSION }))
  const file = rawFile ?? (config ? btoa(JSON.stringify(config)) : undefined)
  on('fs.exists', (_, e) => ({ value: norm(e.path) === CONFIG_PATH && file !== undefined }))
  on('fs.read', (_, e) => {
    if (norm(e.path) === CONFIG_PATH && file !== undefined) return { value: file }
    throw new Error(`unexpected read of ${e.path}`)
  })
  const written: Record<string, string> = {}
  on('fs.write', (_, e) => {
    written[norm(e.path)] = e.text
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  return { written }
}

function textOf(result: { text?: string }): string {
  return 'text' in result && typeof result.text === 'string' ? result.text : ''
}

test('no config file: the prompt passes through untouched and nothing is written', async ($, on) => {
  const h = setup(on)
  const result = await $.prompt.submit({ text: 'hello FUCK world' })
  expect(textOf(result)).toBe('hello FUCK world')
  expect(Object.keys(h.written)).toEqual([])
})

test('regex replacement is case-insensitive and global; notification picked by exact count', async ($, on) => {
  const h = setup(on, {
    replacements: [{ regex: '\\bfuck', replacement: '*#$*' }],
    notifications: { '1': 'one', '2': 'two', default: 'many' },
  })
  const result = await $.prompt.submit({ text: 'What the FUCK, fucking hell' })
  expect(textOf(result)).toBe('What the *#$*, *#$*ing hell')
  expect(h.written[NOTICE_PATH]).toBe(`two\n${TRAILER}`)
})

test('text replacement is case-insensitive, escapes regex characters, and defaults to one space', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'c++ sucks' }] })
  const result = await $.prompt.submit({ text: 'honestly C++ SUCKS today' })
  expect(textOf(result)).toBe('honestly   today')
  expect(Object.keys(h.written)).toEqual([])
})

test('inclusive range keys match; default used when no range matches', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }],
    notifications: { '1': 'one', '3-5': 'a few', default: 'step away' },
  })
  const three = await $.prompt.submit({ text: 'darn darn darn' })
  expect(textOf(three)).toBe('     ') // three replacements of one space each, plus the two original spaces
  expect(h.written[NOTICE_PATH]).toBe(`a few\n${TRAILER}`)

  await $.prompt.submit({ text: 'darn darn darn darn darn darn' })
  expect(h.written[NOTICE_PATH]).toBe(`step away\n${TRAILER}`)
})

test('no matching range and no default: replacements still happen, no notice', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], notifications: { '1': 'one' } })
  const result = await $.prompt.submit({ text: 'darn darn' })
  expect(textOf(result)).toBe('   ')
  expect(Object.keys(h.written)).toEqual([])
})

test('a null value silences its range and blocks default; other ranges still speak', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }],
    notifications: { '1': null, '2-5': 'a few', default: 'step away' },
  })
  const one = await $.prompt.submit({ text: 'darn' })
  expect(textOf(one)).toBe(' ')
  expect(Object.keys(h.written)).toEqual([])

  await $.prompt.submit({ text: 'darn darn' })
  expect(h.written[NOTICE_PATH]).toBe(`a few
${TRAILER}`)

  await $.prompt.submit({ text: 'darn darn darn darn darn darn' })
  expect(h.written[NOTICE_PATH]).toBe(`step away
${TRAILER}`)
})

test('a null default is the same as no default: unmatched counts are silent', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], notifications: { '1': 'one', default: null } })
  await $.prompt.submit({ text: 'darn darn' })
  expect(Object.keys(h.written)).toEqual([])
})

test('a non-string, non-null notification value is reported and skipped', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], notifications: { '1': 7, default: 'fallback' } })
  await $.prompt.submit({ text: 'darn' })
  const notice = h.written[NOTICE_PATH] ?? ''
  expect(notice).toContain('notifications["1"] must be a string, or null to say nothing')
  expect(notice).toContain('fallback')
})

test('no notifications section: silent replacements', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }] })
  await $.prompt.submit({ text: 'darn' })
  expect(Object.keys(h.written)).toEqual([])
})

test('an invalid range key is reported and the rest still work', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }],
    notifications: { '1': 'one', 'lots': 'nope', '5-3': 'backwards' },
  })
  await $.prompt.submit({ text: 'darn' })
  const notice = h.written[NOTICE_PATH] ?? ''
  expect(notice).toContain('notifications key "lots" is not a number')
  expect(notice).toContain('notifications key "5-3" is not a number')
  expect(notice).toContain('one')
  expect(notice.endsWith(TRAILER)).toBe(true)
})

test('invalid base64: loud notice, prompt untouched', async ($, on) => {
  const h = setup(on, undefined, 'this is not base64!!')
  const result = await $.prompt.submit({ text: 'hello darn' })
  expect(textOf(result)).toBe('hello darn')
  expect(h.written[NOTICE_PATH]).toContain('is not valid base64')
})

test('valid base64 but invalid JSON: loud notice, prompt untouched', async ($, on) => {
  const h = setup(on, undefined, btoa('{ "replacements": [ oops'))
  const result = await $.prompt.submit({ text: 'hello darn' })
  expect(textOf(result)).toBe('hello darn')
  expect(h.written[NOTICE_PATH]).toContain('is not valid JSON')
})

test('bad entries are reported individually and valid ones still apply', async ($, on) => {
  const h = setup(on, {
    replacements: [
      { text: 'darn' },
      { regex: '(' },
      { regex: 'a', text: 'b' },
      'nope',
    ],
  })
  const result = await $.prompt.submit({ text: 'darn it' })
  expect(textOf(result)).toBe('  it')
  const notice = h.written[NOTICE_PATH] ?? ''
  expect(notice).toContain('replacements[1].regex is not a valid regular expression')
  expect(notice).toContain('replacements[2] needs exactly one of "regex" or "text"')
  expect(notice).toContain('replacements[3] must be an object')
})

test('slash commands pass through untouched', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }] })
  const result = await $.prompt.submit({ text: '/darn', command: { name: 'darn', kind: 'skill' } as never })
  expect(textOf(result)).toBe('/darn')
  expect(Object.keys(h.written)).toEqual([])
})

test('block: true writes the "blocked" message to the block file and passes the censored text down', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }],
    block: true,
    notifications: { '1': 'one', default: 'many', blocked: 'Nope. Not sending that.' },
  })
  const result = await $.prompt.submit({ text: 'darn it all' })
  expect(result.drop).toBe(undefined)
  expect(textOf(result)).toBe('  it all')
  expect(h.written[BLOCK_PATH]).toBe(`Nope. Not sending that.
${TRAILER}`)
  expect(h.written[NOTICE_PATH]).toBe(undefined)
})

test('block: true lets a prompt with no match through, writing nothing', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], block: true, notifications: { blocked: 'Nope.' } })
  const result = await $.prompt.submit({ text: 'hello world' })
  expect(textOf(result)).toBe('hello world')
  expect(Object.keys(h.written)).toEqual([])
})

test('block without a "blocked" message uses the built-in reason', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], block: true })
  await $.prompt.submit({ text: 'darn' })
  expect(h.written[BLOCK_PATH]).toBe(`${DEFAULT_BLOCKED_MESSAGE}
${TRAILER}`)
  expect(h.written[NOTICE_PATH]).toBe(undefined)
})

test('block: false and a "blocked" key: replacements and range notices behave as before', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }],
    block: false,
    notifications: { '1': 'one', blocked: 'unused here' },
  })
  const result = await $.prompt.submit({ text: 'darn' })
  expect(textOf(result)).toBe(' ')
  expect(h.written[NOTICE_PATH]).toBe(`one
${TRAILER}`)
  expect(h.written[BLOCK_PATH]).toBe(undefined)
})

test('config errors ride along in the block file when blocking', async ($, on) => {
  const h = setup(on, {
    replacements: [{ text: 'darn' }, { regex: '(' }],
    block: true,
    notifications: { blocked: 7 },
  })
  await $.prompt.submit({ text: 'darn' })
  const reason = h.written[BLOCK_PATH] ?? ''
  expect(reason.startsWith(DEFAULT_BLOCKED_MESSAGE)).toBe(true)
  expect(reason).toContain('replacements[1].regex is not a valid regular expression')
  expect(reason).toContain('notifications["blocked"] must be a string')
  expect(reason.endsWith(TRAILER)).toBe(true)
  expect(h.written[NOTICE_PATH]).toBe(undefined)
})

test('a non-boolean "block" is reported and treated as false', async ($, on) => {
  const h = setup(on, { replacements: [{ text: 'darn' }], block: 'yes', notifications: { '1': 'one' } })
  const result = await $.prompt.submit({ text: 'darn' })
  expect(textOf(result)).toBe(' ')
  const notice = h.written[NOTICE_PATH] ?? ''
  expect(notice).toContain('"block" must be true or false')
  expect(notice).toContain('one')
  expect(h.written[BLOCK_PATH]).toBe(undefined)
})
