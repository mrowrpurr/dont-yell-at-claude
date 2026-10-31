// Classic UserPromptSubmit hook: the one output route T3 Code renders.
//
// The mod in register.ts runs first and rewrites the prompt; this hook only
// ever sees the rewritten text and never changes it. When the mod has
// something to tell the user it writes a per-session notice file; this hook
// reads that file, prints it as a systemMessage, and deletes it.
import { existsSync, readFileSync, unlinkSync } from 'node:fs'

const NOTICE_FILE_PREFIX = '.dont-yell.notice.'

let raw = ''
for await (const chunk of process.stdin) raw += chunk

let sessionId
try {
  sessionId = String(JSON.parse(raw).session_id ?? '')
} catch (err) {
  process.stdout.write(JSON.stringify({ systemMessage: `[dont-yell-at-claude] notice hook could not parse stdin: ${String(err)}` }))
  process.exit(0)
}
if (!sessionId) process.exit(0)

// Same resolution order as the mod, so both agree on the folder.
const home = process.env.USERPROFILE ?? process.env.HOME
if (!home) process.exit(0)

const noticePath = `${home}/${NOTICE_FILE_PREFIX}${sessionId}.txt`
if (!existsSync(noticePath)) process.exit(0)

let message = ''
try {
  message = readFileSync(noticePath, 'utf8')
} finally {
  try {
    unlinkSync(noticePath)
  } catch {
    // Already gone; nothing to clean up.
  }
}

if (message.trim().length > 0) {
  process.stdout.write(JSON.stringify({ systemMessage: message }))
}
