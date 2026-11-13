# Permistry

A `plugin.yml` checker for Paper and Spigot plugins. Paste the file or drop the plugin jar,
and it tells you in plain words what the server will do with it: crash, refuse to load the
plugin, quietly drop a command or permission, or load it fine.

**Use it:** https://kitebyte-studio.github.io/permistry/

Everything runs in your browser. Nothing is uploaded.

## What it checks

- Permission loops (`a` → `b` → `a`). Paper follows children with no loop check, and on
  Paper 26.3 one of these crashed the whole server at startup.
- A plugin that lists itself in `depend`, `softdepend` or `loadbefore`. That also crashes
  Paper 26.3 at startup.
- Everything that makes the server refuse the plugin: missing `name`/`version`/`main`, bad
  characters or reserved words in the name, `org.bukkit` main class, lists written as text,
  bad `load` values, bad library coordinates, tabs, YAML syntax errors.
- Things that load but do not work: invalid permission defaults, quoted `true` under
  `children`, commands and aliases with `:`, `commands` in `paper-plugin.yml`.
- Silent problems: typos in keys (`softdepends`, `alias`), command permissions that do not
  match the declared ones, duplicate keys, two commands sharing an alias, wildcards with no
  children, no `api-version` (legacy mode).
- From a jar: missing `plugin.yml`, main class not in the jar, the Java version the plugin
  was compiled for, build placeholders such as `${version}` that were never replaced.

Every rule was checked against a real **Paper 26.3 (build 249)** server.
[docs/paper-behaviour.md](docs/paper-behaviour.md) lists what the server did in each case,
with the exact log lines.

`paper-plugin.yml` support is basic for now: required fields, dependencies, permissions, and
the sections Paper ignores in that file.

## Run it locally

It is a static site with no build step. Serve the folder with any static server, for example:

```
python -m http.server 8000
```

Tests (Node 20+):

```
npm test
```

## License

MIT, see [LICENSE](LICENSE). Bundled libraries: js-yaml and fflate (both MIT), see
[vendor/THIRD-PARTY-LICENSES.txt](vendor/THIRD-PARTY-LICENSES.txt).

Permistry is made by Kitebyte and is not affiliated with Mojang, Microsoft, PaperMC or
SpigotMC. The code is written with AI coding tools, and every rule is tested on a real server.
