set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

root := justfile_directory()

# List recipes
default:
    @just --list

# Base64-encode dont-yell.json from this folder into ~/.dont-yell.json.b64
update:
    node "{{root}}/scripts/encode-config.mjs" "{{root}}/dont-yell.json"

# Install the plugin from this folder (read live; run /reload-plugins after edits)
install:
    -claude plugin marketplace add "{{root}}"
    claude plugin install dont-yell-at-claude@dont-yell-at-claude

# Uninstall the plugin and remove this folder's marketplace entry
uninstall:
    claude plugin uninstall dont-yell-at-claude
    claude plugin marketplace remove dont-yell-at-claude

# Validate and test the plugin
test:
    claude plugin validate "{{root}}"
    claude plugin test "{{root}}"
