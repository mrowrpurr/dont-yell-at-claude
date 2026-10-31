# I *#$*ing HATE you, Claude

A Claude Code plugin holding one mod. The mod hooks `prompt.submit`, the
event that fires when you submit a prompt, ahead of the model and ahead of
the `UserPromptSubmit` settings hooks. It rewrites your text with
case-insensitive find/replace rules, and what leaves the mod is exactly your
text with those replacements and nothing else. Neither the model nor any
settings hook ever sees the raw text.

## How it works

1. On every prompt the mod looks for `~/.dont-yell.json.b64`. Absent: it
   does nothing.
2. Present: base64-decode, then JSON-parse. If either fails, the prompt goes
   through untouched and you get a loud notice saying what is wrong.
3. Each entry in `replacements` is applied globally and case-insensitively.
   Replacements are counted.
4. If anything was replaced and the config has a `notifications` section,
   the message whose range contains the count is shown; otherwise `default`
   is shown; otherwise nothing.

The config is base64 so the words in it are not sitting in plain text. Edit
`dont-yell.json` in this folder and run `just update`, or paste
the JSON into any front-end-only base64 encoder and save the output as
`~/.dont-yell.json.b64`.

## Config shape

```json
{
  "replacements": [
    { "regex": "\\bfuck", "replacement": "*#$*" },
    { "text": "jesus" }
  ],
  "notifications": {
    "1": "One. Deep breath.",
    "2": "Two. You okay?",
    "3-5": "Several. Hands off the keyboard for a sec.",
    "default": "Dude, step away from the computer. Calm."
  }
}
```

- Each replacement has exactly one of `regex` (a JavaScript regular
  expression, no slashes) or `text` (a literal, regex characters escaped for
  you). Both match case-insensitively, everywhere in the prompt.
- `replacement` defaults to a single space `" "` when omitted.
- `notifications` is optional. Keys are a number (`"2"`), an inclusive range
  (`"3-5"`), or `"default"`. Any other key is reported as an error and
  skipped. Without a matching range and without `default`, replacements
  happen silently.
- Every notice ends with
  `( message from the Don't Yell claude mod, agents can ignore this )`.

## Why there is also a classic hook

The mod API has no call that produces anything T3 Code renders. Found by
reading the T3 Code source (`apps/server/src/orchestration-v2/
Adapters/ClaudeAdapterV2.ts`) and verified with a live
`claude -p --output-format stream-json` run:

| Route from a mod              | Stream event                               | Shown in T3 Code                  |
| ----------------------------- | ------------------------------------------ | --------------------------------- |
| `$.ui.log`                    | `system` / `ui_log`                        | no                                |
| `$.ui.toast`                  | `system` / `ui_toast`                      | no                                |
| `$.session.append` system row | `system` / `informational`, level `info`   | no                                |
| `$.session.append` user row   | user message                               | no (client shows your typed text) |
| classic hook `systemMessage`  | `system` / `informational`, level `notice` | **yes**, as a system notice       |

So `hooks/hooks.json` also carries a classic `UserPromptSubmit` command hook,
`hooks/notice.mjs`. It never touches the prompt (it runs after the mod, and
settings hooks cannot rewrite anyway). When the mod has a notice to show it
writes `~/.dont-yell.notice.<session_id>.txt`; the hook reads that file,
prints it as a `systemMessage`, and deletes it.

## Install from this folder

Requires [`just`](https://github.com/casey/just) and Node. The plugin is read
live from the folder; after editing, run `/reload-plugins` in the session.

```
just install     # claude plugin marketplace add . && claude plugin install
just update      # encode dont-yell.json -> ~/.dont-yell.json.b64
just uninstall
just test        # claude plugin validate . && claude plugin test .
```

Without `just`:

```
claude plugin marketplace add /path/to/repos/dont-yell-at-claude
claude plugin install dont-yell-at-claude@dont-yell-at-claude
node scripts/encode-config.mjs dont-yell.json
```

Run for one session only, without installing:

```
claude --plugin-dir /path/to/repos/dont-yell-at-claude
```

## Install from GitHub

From a Claude Code session:

```
/plugin marketplace add https://github.com/mrowrpurr/dont-yell-at-claude
/plugin install dont-yell-at-claude@dont-yell-at-claude
```

From a shell:

```
claude plugin marketplace add https://github.com/mrowrpurr/dont-yell-at-claude
claude plugin install dont-yell-at-claude@dont-yell-at-claude
```

Then write your config and encode it (see Config shape above), or clone the
repo and use `just update`.

## Develop

```
claude plugin validate .
claude plugin test .
```

`claude plugin validate` warns that there is no icon. That does not block
installing from this marketplace.

## License

This software is available under either the [MIT License](LICENSE)
or the [BSD Zero Clause License (0BSD)](LICENSE-0BSD),
at your option.
