// `just update`: base64-encode dont-yell.json and write it to ~/.dont-yell.json.b64,
// the file the mod reads. Validates that the source is JSON first so a typo is
// caught here rather than as a notice in every Claude session.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve(process.argv[2] ?? 'dont-yell.json')

// Same resolution order as the mod and the notice hook.
const home = process.env.USERPROFILE ?? process.env.HOME
if (!home) {
  console.error('Neither USERPROFILE nor HOME is set; cannot find the home folder.')
  process.exit(1)
}
const target = `${home}/.dont-yell.json.b64`

let text
try {
  text = readFileSync(source, 'utf8')
} catch (err) {
  console.error(`Could not read ${source}: ${err.message}`)
  console.error('Write your replacements there first; see README for the shape.')
  process.exit(1)
}

try {
  JSON.parse(text.replace(/^﻿/, ''))
} catch (err) {
  console.error(`${source} is not valid JSON: ${err.message}`)
  process.exit(1)
}

writeFileSync(target, Buffer.from(text, 'utf8').toString('base64'))
console.log(`Wrote ${target} 🔒 (${text.length} chars of JSON, base64-encoded)`)
