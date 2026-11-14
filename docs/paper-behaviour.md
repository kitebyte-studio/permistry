# What Paper does with a broken plugin.yml

Each case below is a real plugin jar with one mistake in its `plugin.yml`, loaded on
**Paper 26.3, build 249** (Java 25, default settings). The "Server log" column is copied
from the console. The fixtures are in [`tests/fixtures`](../tests/fixtures), and
[`tests/validator.test.js`](../tests/validator.test.js) checks that Permistry reports each one.

## Crashes the whole server

| Mistake | What happened | Server log |
|---|---|---|
| Permission loop (`a` → child `b` → child `a`), one of them `default: true` | Server crashed at startup | `java.lang.StackOverflowError` in `PermissibleBase.calculateChildPermissions`, then `Encountered an unexpected exception` |
| Same loop with no `default` (which means `op`) | Server crashed at startup | same |
| Same loop with `default: false` on both | Server started. Not tested further, but the same recursive code runs when a player is given one of these permissions | none at startup |
| Plugin lists itself in `depend` | Server crashed at startup | `Cannot add self-loop edge on node <name>, as self-loops are not allowed.` |
| Plugin lists itself in `softdepend` | Server crashed at startup | same |
| Plugin lists itself in `loadbefore` | Server crashed at startup | same |

## The plugin is not loaded

| Mistake | Server log |
|---|---|
| Space in `name` | `Restricted name, cannot use 0x20 (space character) in a plugin name.` |
| `!` in `name` | `name 'P08Bad!Name' contains invalid characters.` |
| `name: minecraft` (also `bukkit`, `mojang`, `spigot`, `paper`) | `Restricted name, cannot use minecraft as a plugin name.` |
| `main: org.bukkit.Foo` | `main may not be within the org.bukkit namespace` |
| `main` points to a class that is not in the jar | `java.lang.ClassNotFoundException` |
| No `version` | `version is not defined` |
| `depend: Vault` (text instead of a list) | `depend is of wrong type` |
| `softdepend: Vault` | `softdepend is of wrong type` |
| `authors: Kitebyte` (text instead of a list) | `authors are of wrong type` |
| `load: LATER` | `load is not a valid choice` |
| `commands: kitehello` (text instead of a section) | `commands are of wrong type` |
| `libraries: [notacoord]` | `Bad artifact coordinates notacoord, expected format is <groupId>:<artifactId>[:<extension>[:<classifier>]]:<version>` |
| Tab used for indentation | `found character '\t(TAB)' that cannot start any token. (Do not use \t(TAB) for indentation)` |
| `api-version: '26.9'` (newer than the server) | `Unsupported API version 26.9` |
| `api-version: 26.10` without quotes | `Unsupported API version 26.10` (the value is kept as text, see below) |
| Dependency that is not installed | `Unknown/missing dependency plugins: [NoSuchPluginXyz]` |
| Two jars in `plugins/` declare the same `name` (e.g. an old and a new build of the same plugin) | `[ModernPluginLoadingStrategy] Ambiguous plugin name 'X' for files '...' and '...' in 'plugins'`. One jar loads, the other is skipped; server keeps starting. |
| paper-plugin.yml without `api-version` | `[api-version] of type org.bukkit.craftbukkit.util.ApiVersion: A value is required for this field` |
| Jar with neither `plugin.yml` nor `paper-plugin.yml` at its top level | `Directory 'plugins\<file>.jar' does not contain a paper-plugin.yml or plugin.yml! Could not determine plugin type, cannot load a plugin from it!` |

## The plugin loads, but part of it is missing

| Mistake | What happened | Server log |
|---|---|---|
| `default: maybe` on a permission | That permission is skipped | `Permission node 'p19.use' ... is invalid` / `'default' key contained unknown value` |
| `p20.use: 'true'` (quoted) under `children` | The parent permission is skipped | `Child 'p20.use' contains invalid value` |
| `children: p36.use` (text instead of a list or section) | The permission is skipped | `'children' key is of wrong type` |
| Command `p22:cmd` | That command is skipped | `Could not load command p22:cmd for plugin P22ColonCmd: Illegal Characters` |
| Alias `p22:al` | That alias is skipped | `Could not load alias p22:al for plugin P22ColonCmd: Illegal Characters` |
| `commands:` in paper-plugin.yml | The plugin loads, the command does not exist | `Unknown or incomplete command` when typed |

## Loads with a warning or silently changes something

| Case | What happened |
|---|---|
| No `api-version` | `Legacy plugin P02ApiMissing v1.0 does not specify an api-version.` and `Initializing Legacy Material Support` |
| `api-version: '1.12'` | Loads in legacy mode |
| `name` written twice | No message. The second value won (`P23DupSecond`) |
| `folia-supported: 'yes'` (text) | Loads on Paper. Folia expects a real `true`/`false` |
| `default-permission: maybe` | Loads without a message |

## Things that are fine

| Case | Result |
|---|---|
| `api-version: 1.20` without quotes | Fine. Paper's YAML reader (`PluginDescriptionResolver`) does not turn numbers with a dot into decimals, so it stays `1.20` |
| `default: yes`, `p26.use: yes` | Fine. `yes`/`no`/`on`/`off` are booleans in plugin.yml |
| `default: admin`, `default: '!op'`, `default: notop` | Fine, all valid |
| `children: [a, b]` (list) | Fine, each child is `true` |
| `api-version: '1.13'`, `'1.21'`, `'1.21.4'`, `'26.1'` | Fine on a 26.3 server |
| Two plugins that `depend` on each other | Both loaded on Paper 26.3 |
