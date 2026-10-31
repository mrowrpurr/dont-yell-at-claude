# I *#$*ing HATE you, Claude

You're going to swear at Claude. Everyone does. This plugin makes sure Claude
never actually reads it.

Before your prompt reaches the model, the words you list get replaced
(`fucking` → `*#$*ing`, or whatever you choose). The model, the transcript,
and every downstream hook only ever see the cleaned-up version. You still
get to type it. Claude just doesn't get to hear it.

And because yelling at a text box is a habit worth breaking, the plugin can
answer each outburst with a quiet notice in your client, scaled to how much
you just swore:

> Two. You okay?

> Dude, step away from the computer. Calm.

Those messages are yours to write. See the config below.

## Install

```
claude plugin marketplace add https://github.com/mrowrpurr/dont-yell-at-claude
claude plugin install dont-yell-at-claude@dont-yell-at-claude
```

Or from inside a Claude Code session:

```
/plugin marketplace add https://github.com/mrowrpurr/dont-yell-at-claude
/plugin install dont-yell-at-claude@dont-yell-at-claude
```

## Configure

The plugin reads `~/.dont-yell.json.b64`: a JSON file, base64-encoded so
your word list isn't sitting on disk in plain text. If the file isn't there,
the plugin does nothing. If it's there but broken (bad base64, bad JSON),
your prompt goes through untouched and you get a loud notice saying why.

The JSON looks like this:

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

- Each replacement is either a `regex` (JavaScript syntax, no slashes) or a
  literal `text`. Both match everywhere, case-insensitively. `FUCK`, `Fuck`
  and `fuck` all get caught.
- `replacement` is optional. Leave it out and the word becomes a single space.
- `notifications` is optional. Keys are a count (`"2"`), an inclusive range
  (`"3-5"`), or `"default"` for everything else. No matching key and no
  `default` means replacements happen silently. Leave the whole section out
  for no notices at all.
- Every notice ends with
  `( message from the Don't Yell claude mod, agents can ignore this )`
  so an agent that sees it knows it isn't for them.

### Writing the config

Easiest: clone this repo, edit `dont-yell.json` in its root (a starter is
there), and run

```
just update
```

which checks the JSON and writes the encoded file to `~/.dont-yell.json.b64`.

No `just`? `node scripts/encode-config.mjs dont-yell.json` does the same. Or
paste the JSON into any browser-only base64 encoder and save the result as
`~/.dont-yell.json.b64` yourself.

The config is read on every prompt, so edits take effect immediately. No
reload needed.

## Uninstall

```
claude plugin uninstall dont-yell-at-claude
claude plugin marketplace remove dont-yell-at-claude
```

## Developing

```
just install     # install the plugin live from this folder
just test        # claude plugin validate . && claude plugin test .
just uninstall
```

After editing the plugin itself, run `/reload-plugins` in your session.
