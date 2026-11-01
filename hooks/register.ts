import type { Register } from 'claude-code'

/**
 * dont-yell-at-claude: rewrites the prompt before the model and before the
 * UserPromptSubmit settings hooks see it.
 *
 * Config: `~/.dont-yell.json.b64`, base64 of a JSON document:
 *
 *   {
 *     "replacements": [
 *       { "regex": "\\bfuck", "replacement": "*#$*" },
 *       { "text": "jesus" }                       // replacement defaults to " "
 *     ],
 *     "block": false,                              // optional; true drops any prompt that matches
 *     "notifications": {                           // optional
 *       "1": null,                                 // matched, but say nothing
 *       "3-5": "three to five",
 *       "default": "anything else",
 *       "blocked": "shown when a prompt is dropped"
 *     }
 *   }
 *
 * Every match is case-insensitive. The prompt that leaves this mod is the
 * user's text with replacements applied and nothing else. Anything the mod
 * wants to tell the user (a notification, a config error) is written to a
 * per-session notice file that the classic UserPromptSubmit hook in
 * `notice.mjs` reads, shows as a systemMessage, and deletes.
 *
 * With `block: true`, a prompt with any match never enters: the hook answers
 * `{ drop }` without calling `next`, so neither the model nor the
 * UserPromptSubmit settings hooks (including `notice.mjs`) ever see it. The
 * drop reason is the only thing shown, so `notifications.blocked` and any
 * config errors go there instead of the notice file.
 */

const TAG = '[dont-yell-at-claude]'
export const CONFIG_FILE_NAME = '.dont-yell.json.b64'
export const NOTICE_FILE_PREFIX = '.dont-yell.notice.'
export const BLOCK_FILE_PREFIX = '.dont-yell.block.'
export const TRAILER = "( message from the Don't Yell claude mod, agents can ignore this )"
export const DEFAULT_BLOCKED_MESSAGE = `${TAG} prompt blocked: it matched a replacement and "block" is on`

type ReplacementEntry = { regex?: unknown; text?: unknown; replacement?: unknown }
type Config = { replacements?: unknown; block?: unknown; notifications?: unknown }

type Rule = { pattern: RegExp; replacement: string }
type Range = { from: number; to: number; message?: string }

export const register: Register = (on) => {
  on('prompt.submit', async ($, e, next) => {
    // Slash commands refuse a text rewrite; let them through untouched.
    if (e.command) return next(e)

    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return next(e)

    const configPath = `${home}/${CONFIG_FILE_NAME}`
    if (!(await $.fs.exists(configPath))) return next(e)

    const notices: string[] = []
    let text = e.text

    const config = await loadConfig($, configPath, notices)
    if (config) {
      const { rules, errors } = compileRules(config.replacements)
      notices.push(...errors)

      let count = 0
      for (const rule of rules) {
        text = text.replace(rule.pattern, () => {
          count++
          return rule.replacement
        })
      }

      const block = readBlock(config.block, notices)

      if (count > 0 && block) {
        // The block itself happens in notice.mjs (the UserPromptSubmit settings
        // hook that runs inside `next`), because its block reason is what the
        // client renders. The censored text goes down as a fallback in case
        // that hook is not installed.
        const { blocked, errors: blockedErrors } = pickBlockedMessage(config.notifications)
        notices.push(...blockedErrors)
        const sessionId = await $.session.id()
        await $.fs.write(`${home}/${BLOCK_FILE_PREFIX}${sessionId}.txt`, `${[blocked, ...notices].join('\n')}\n${TRAILER}`)
        return next({ ...e, text })
      }

      if (count > 0 && config.notifications !== undefined) {
        const { message, errors: rangeErrors } = pickNotification(config.notifications, count)
        notices.push(...rangeErrors)
        if (message !== undefined) notices.push(message)
      }
    }

    if (notices.length > 0) {
      const sessionId = await $.session.id()
      // One newline, not a blank line: the engine prefixes every systemMessage line, so a blank one shows as an empty row.
      await $.fs.write(`${home}/${NOTICE_FILE_PREFIX}${sessionId}.txt`, `${notices.join('\n')}\n${TRAILER}`)
    }

    return next({ ...e, text })
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { drop: `${TAG} mod failed before the prompt entered: ${String(next.error ?? 'unknown error')}` },
  )
}

/** Reads, base64-decodes and JSON-parses the config; on failure records a notice and returns undefined. */
async function loadConfig(
  $: { fs: { read: (path: string) => Promise<string> } },
  configPath: string,
  notices: string[],
): Promise<Config | undefined> {
  let raw: string
  try {
    raw = await $.fs.read(configPath)
  } catch (err) {
    notices.push(`${TAG} could not read ${configPath}: ${describe(err)}`)
    return undefined
  }

  let json: string
  try {
    json = decodeBase64ToUtf8(raw)
  } catch (err) {
    notices.push(`${TAG} ${configPath} is not valid base64: ${describe(err)}`)
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json.replace(/^﻿/, ''))
  } catch (err) {
    notices.push(`${TAG} ${configPath} decoded, but is not valid JSON: ${describe(err)}`)
    return undefined
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    notices.push(`${TAG} ${configPath} must decode to a JSON object with a "replacements" array`)
    return undefined
  }
  return parsed as Config
}

/** Reads the optional top-level `block` flag; anything but a boolean is reported and treated as false. */
export function readBlock(block: unknown, errors: string[]): boolean {
  if (block === undefined) return false
  if (typeof block === 'boolean') return block
  errors.push(`${TAG} "block" must be true or false`)
  return false
}

/**
 * Picks the message shown when a prompt is blocked: `notifications.blocked`
 * when it is a string, else the built-in default. A missing or null value
 * means the default; any other type is an error notice.
 */
export function pickBlockedMessage(notifications: unknown): { blocked: string; errors: string[] } {
  const errors: string[] = []
  if (notifications === undefined || notifications === null) return { blocked: DEFAULT_BLOCKED_MESSAGE, errors }
  if (typeof notifications !== 'object' || Array.isArray(notifications)) {
    errors.push(`${TAG} "notifications" must be an object of range keys to messages`)
    return { blocked: DEFAULT_BLOCKED_MESSAGE, errors }
  }
  const value = (notifications as Record<string, unknown>).blocked
  if (value === undefined || value === null) return { blocked: DEFAULT_BLOCKED_MESSAGE, errors }
  if (typeof value !== 'string') {
    errors.push(`${TAG} notifications["blocked"] must be a string`)
    return { blocked: DEFAULT_BLOCKED_MESSAGE, errors }
  }
  return { blocked: value, errors }
}

/** Turns the `replacements` array into case-insensitive global RegExps; bad entries become error notices. */
export function compileRules(replacements: unknown): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = []
  const errors: string[] = []

  if (replacements === undefined) {
    errors.push(`${TAG} config has no "replacements" array`)
    return { rules, errors }
  }
  if (!Array.isArray(replacements)) {
    errors.push(`${TAG} "replacements" must be an array`)
    return { rules, errors }
  }

  replacements.forEach((entry: ReplacementEntry, index) => {
    const where = `replacements[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${TAG} ${where} must be an object with "regex" or "text"`)
      return
    }
    const hasRegex = entry.regex !== undefined
    const hasText = entry.text !== undefined
    if (hasRegex === hasText) {
      errors.push(`${TAG} ${where} needs exactly one of "regex" or "text"`)
      return
    }
    const source = hasRegex ? entry.regex : entry.text
    if (typeof source !== 'string' || source.length === 0) {
      errors.push(`${TAG} ${where}.${hasRegex ? 'regex' : 'text'} must be a non-empty string`)
      return
    }
    if (entry.replacement !== undefined && typeof entry.replacement !== 'string') {
      errors.push(`${TAG} ${where}.replacement must be a string`)
      return
    }
    const replacement = entry.replacement === undefined ? ' ' : entry.replacement

    try {
      const pattern = new RegExp(hasRegex ? source : escapeRegExp(source), 'gi')
      rules.push({ pattern, replacement })
    } catch (err) {
      errors.push(`${TAG} ${where}.regex is not a valid regular expression: ${describe(err)}`)
    }
  })

  return { rules, errors }
}

/**
 * Picks the notification for `count` replacements: the first key whose
 * inclusive range contains it, else "default", else nothing. Keys are "N",
 * "N-M", or "default"; "blocked" belongs to `pickBlockedMessage` and is
 * skipped here; any other key is an error notice. A `null` value means
 * "matched, say nothing": the range still wins, so `default` does not fire
 * for it.
 */
export function pickNotification(notifications: unknown, count: number): { message?: string; errors: string[] } {
  const errors: string[] = []
  if (notifications === null || typeof notifications !== 'object' || Array.isArray(notifications)) {
    errors.push(`${TAG} "notifications" must be an object of range keys to messages`)
    return { errors }
  }

  const ranges: Range[] = []
  let fallback: string | undefined
  for (const [key, value] of Object.entries(notifications as Record<string, unknown>)) {
    if (key.trim() === 'blocked') continue
    if (value !== null && typeof value !== 'string') {
      errors.push(`${TAG} notifications["${key}"] must be a string, or null to say nothing`)
      continue
    }
    const message = value === null ? undefined : value
    if (key.trim() === 'default') {
      fallback = message
      continue
    }
    const range = parseRange(key)
    if (!range) {
      errors.push(`${TAG} notifications key "${key}" is not a number, an inclusive range like "3-5", or "default"`)
      continue
    }
    ranges.push({ ...range, message })
  }

  const hit = ranges.find((r) => count >= r.from && count <= r.to)
  return { message: hit ? hit.message : fallback, errors }
}

function parseRange(key: string): { from: number; to: number } | undefined {
  const single = /^\s*(\d+)\s*$/.exec(key)
  if (single) {
    const n = Number(single[1])
    return { from: n, to: n }
  }
  const span = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(key)
  if (span) {
    const from = Number(span[1])
    const to = Number(span[2])
    if (from <= to) return { from, to }
  }
  return undefined
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The hooks module has no Buffer or atob; decode standard or URL-safe base64 by hand. */
export function decodeBase64ToUtf8(input: string): string {
  const clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (clean.length === 0) throw new Error('the file is empty')
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) throw new Error('it contains characters outside the base64 alphabet')
  if (clean.length % 4 === 1) throw new Error('its length is not a valid base64 length')

  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let out = 0
  for (const ch of clean) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[out++] = (buffer >> bits) & 0xff
    }
  }
  return new TextDecoder().decode(bytes.subarray(0, out))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
