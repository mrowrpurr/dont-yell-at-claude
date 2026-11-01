// Classic UserPromptSubmit hook: the one output route T3 Code renders.
//
// The mod in register.ts runs first and rewrites the prompt; this hook only
// ever sees the rewritten text and never changes it. When the mod has
// something to tell the user it writes a per-session notice file; this hook
// reads that file, prints it as a systemMessage, and deletes it.
//
// When the config has `block: true` and the prompt matched, the mod writes a
// per-session block file instead; this hook reads it, deletes it, and answers
// `{ decision: "block", reason }`, so the prompt never reaches the model and
// the client shows the reason.
import { existsSync, readFileSync, unlinkSync } from 'node:fs'

const NOTICE_FILE_PREFIX = '.dont-yell.notice.'
const BLOCK_FILE_PREFIX = '.dont-yell.block.'

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

/** Reads and deletes the file; undefined when it is not there. */
function take(path) {
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8')
  } finally {
    try {
      unlinkSync(path)
    } catch {
      // Already gone; nothing to clean up.
    }
  }
}

const blockReason = take(`${home}/${BLOCK_FILE_PREFIX}${sessionId}.txt`)
if (blockReason !== undefined) {
  // A notice left over from the same prompt would otherwise show next time.
  take(`${home}/${NOTICE_FILE_PREFIX}${sessionId}.txt`)
  process.stdout.write(JSON.stringify({ decision: 'block', reason: blockReason }))
  process.exit(0)
}

const message = take(`${home}/${NOTICE_FILE_PREFIX}${sessionId}.txt`)
if (message !== undefined && message.trim().length > 0) {
  process.stdout.write(JSON.stringify({ systemMessage: message }))
}
