import { expect, mock, test } from 'claude-code/testing'

const HOME = 'C:/Users/test'
const CONFIG_PATH = `${HOME}/.dont-yell.json.b64`
const SESSION = 'sess-1'
const NOTICE_PATH = `${HOME}/.dont-yell.notice.${SESSION}.txt`
const TRAILER = "( message from the Don't Yell claude mod, agents can ignore this )"

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
