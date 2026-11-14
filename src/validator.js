// Permistry: checks plugin.yml / paper-plugin.yml the way a Paper server reads them.
// Every rule here was checked against Paper 26.3 (build 249); see docs/paper-behaviour.md.

import { load, Type, FAILSAFE_SCHEMA, types } from '../vendor/js-yaml.mjs';
import { indexYaml } from './locate.js';

export const LATEST_API = '26.3';
export const TESTED_ON = 'Paper 26.3 (build 249)';

// The server reads plugin.yml with SnakeYAML and its own resolver
// (org.bukkit.plugin.PluginDescriptionResolver): YAML 1.1 booleans
// (yes/no/on/off), integers, null and timestamps, but no floats, so
// `api-version: 1.20` stays the text "1.20". Mirror that here.
const BOOL11 = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const yaml11Bool = new Type('tag:yaml.org,2002:bool', {
  kind: 'scalar',
  resolve: (d) => d !== null && BOOL11.test(d),
  construct: (d) => /^(?:yes|true|on)$/i.test(d),
  predicate: (o) => typeof o === 'boolean',
  represent: { lowercase: (o) => (o ? 'true' : 'false') },
  defaultStyle: 'lowercase',
});
const SCHEMA = FAILSAFE_SCHEMA.extend({
  implicit: [types.null, yaml11Bool, types.int, types.timestamp, types.merge],
});
const TRAILING_ZERO = /^\d+\.\d*0$/;

// Impact, most serious first.
export const IMPACTS = ['crash', 'refuse', 'broken', 'warning', 'tip'];

const RESERVED_NAMES = ['bukkit', 'minecraft', 'mojang', 'spigot', 'paper'];
const NAME_RE = /^[A-Za-z0-9 _.-]+$/;
const CLASS_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const API_RE = /^\d+\.\d+(\.\d+)?$/;
const LIB_RE = /^[^:\s]+(:[^:\s]+){2,4}$/;

const PLUGIN_KEYS = [
  'name', 'version', 'main', 'description', 'author', 'authors', 'contributors',
  'website', 'prefix', 'load', 'depend', 'softdepend', 'loadbefore', 'provides',
  'commands', 'permissions', 'default-permission', 'api-version', 'libraries',
  'awareness', 'class-loader-of', 'paper-plugin-loader', 'paper-skip-libraries',
  'folia-supported',
];
const PAPER_KEYS = [
  'name', 'version', 'main', 'bootstrapper', 'loader', 'provides',
  'has-open-classloader', 'description', 'author', 'authors', 'contributors',
  'website', 'prefix', 'load', 'permissions', 'default-permission', 'api-version',
  'dependencies', 'folia-supported',
];
const COMMAND_KEYS = ['description', 'aliases', 'permission', 'permission-message', 'usage'];
const PERMISSION_KEYS = ['description', 'default', 'children'];
const PERMISSION_DEFAULTS = {
  true: 'true', false: 'false',
  op: 'op', isop: 'op', operator: 'op', isoperator: 'op', admin: 'op', isadmin: 'op',
  '!op': 'notop', notop: 'notop', '!operator': 'notop', notoperator: 'notop', '!admin': 'notop', notadmin: 'notop',
};

// ---------- small helpers ----------

function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Date) return 'date';
  return typeof v === 'object' ? 'map' : typeof v; // string | number | boolean
}

// What Java's toString() would print for the value SnakeYAML produced.
// `budget` caps the work: YAML anchors can make a small file expand hugely.
function javaText(v, raw, budget = { left: 2000 }) {
  if (budget.left <= 0) return '…';
  budget.left -= 1;
  switch (typeOf(v)) {
    case 'number':
      if (raw && /^[-+]?\d+$/.test(raw.trim())) return String(v);
      return Number.isInteger(v) ? v.toFixed(1) : String(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'list': {
      const parts = [];
      for (const x of v) {
        if (budget.left <= 0) {
          parts.push('…');
          break;
        }
        parts.push(javaText(x, undefined, budget));
      }
      return '[' + parts.join(', ') + ']';
    }
    case 'map': return '{…}';
    case 'null': return 'null';
    default: return String(v);
  }
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// `prefix`: treat "alias" -> "aliases" as a near miss. Right for key names,
// wrong for permission names, where "ess.tp" and "ess.tpa" are both real.
function closest(word, candidates, max = 2, prefix = true) {
  const norm = (s) => s.toLowerCase().replace(/[_\s]/g, '-');
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c === word) continue;
    const a = norm(word);
    const b = norm(c);
    if (!prefix && (a.startsWith(b) || b.startsWith(a))) continue;
    let d = a === b ? 0 : levenshtein(a, b);
    if (prefix && d > 1 && a.length >= 4 && (b.startsWith(a) || a.startsWith(b)) && Math.abs(a.length - b.length) <= 3) d = 1;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const limit = Math.min(max, Math.max(1, Math.floor(word.length / 3)));
  return bestD <= limit ? best : null;
}

function q(s) {
  return '`' + s + '`';
}

// ---------- main entry ----------

export function validate(source, opts = {}) {
  const text = String(source ?? '').replace(/^﻿/, '');
  const ctx = makeContext(text);

  if (!text.trim()) {
    ctx.add('refuse', 'empty', null, 'The file is empty', 'Paste the contents of your plugin.yml, or drop the plugin .jar.');
    return finish(ctx, null, opts.kind || 'plugin');
  }

  if (text.length > 400_000 || ctx.idx.lines.length > 15_000) {
    ctx.add('warning', 'too-big', null, 'This file is too big to check',
      'Permistry checks files up to 400 KB and 15,000 lines. A real plugin.yml is almost always much smaller: check that you pasted the right file.');
    return finish(ctx, null, opts.kind || 'plugin');
  }

  const tabLine = ctx.idx.lines.findIndex((l) => /^ *\t/.test(l));
  if (tabLine !== -1) {
    ctx.add('refuse', 'yaml-tab', tabLine + 1, 'Tab used for indentation',
      'YAML only allows spaces for indentation. Replace the Tab at the start of this line with spaces.',
      { server: "found character '\\t(TAB)' that cannot start any token. (Do not use \\t(TAB) for indentation)" });
    return finish(ctx, null, opts.kind || 'plugin');
  }

  let data;
  try {
    data = load(text, { schema: SCHEMA, json: true });
  } catch (e) {
    yamlError(ctx, e);
    return finish(ctx, null, opts.kind || 'plugin');
  }

  if (typeOf(data) !== 'map') {
    ctx.add('refuse', 'not-map', 1, 'Not a plugin description',
      'The file should be a list of `key: value` lines such as `name: MyPlugin`. This one parses as ' +
      (typeOf(data) === 'list' ? 'a list' : 'plain text') + '.');
    return finish(ctx, null, opts.kind || 'plugin');
  }

  const kind = opts.kind || guessKind(opts.fileName, data);
  try {
    checkDuplicates(ctx);
    if (kind === 'paper') checkPaperPlugin(ctx, data);
    else checkPluginYml(ctx, data);
    checkPlaceholders(ctx, data);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    ctx.add('warning', 'too-deep', null, 'Could not finish the check',
      'The file nests too deeply (very long permission chains or YAML anchors inside anchors). The results above are incomplete.');
  }
  return finish(ctx, data, kind);
}

function makeContext(text) {
  const findings = [];
  const idx = indexYaml(text);
  return {
    idx,
    findings,
    info: [],
    add(impact, code, line, title, detail, extra = {}) {
      findings.push({ impact, code, line: line ?? null, title, detail, ...extra });
    },
  };
}

function finish(ctx, data, kind) {
  const rank = (f) => IMPACTS.indexOf(f.impact);
  ctx.findings.sort((a, b) => rank(a) - rank(b) || (a.line ?? 1e9) - (b.line ?? 1e9));
  const worst = ctx.findings.length ? ctx.findings[0].impact : 'ok';
  return { kind, data, findings: ctx.findings, info: ctx.info, verdict: worst };
}

export function guessKind(fileName, data) {
  if (fileName && /paper-plugin\.ya?ml$/i.test(fileName)) return 'paper';
  if (fileName && /plugin\.ya?ml$/i.test(fileName)) return 'plugin';
  if (data && typeOf(data) === 'map') {
    if ('bootstrapper' in data || 'loader' in data || 'has-open-classloader' in data) return 'paper';
    const deps = data.dependencies;
    if (typeOf(deps) === 'map' && ('server' in deps || 'bootstrap' in deps)) return 'paper';
  }
  return 'plugin';
}

// ---------- YAML syntax errors ----------

function yamlError(ctx, e) {
  const line = e.mark ? e.mark.line + 1 : null;
  const reason = (e.reason || e.message || '').trim();
  const src = line ? ctx.idx.lines[line - 1] || '' : '';
  const value = src.replace(/^\s*(-\s+)?[^:#]*?:\s?/, '');
  let title = 'YAML syntax error';
  let detail = 'The server cannot read the file, so the plugin will not load. Look at this line and the one above it.';

  if (/: /.test(value) && !/^\s*["'[{|>]/.test(value)) {
    title = 'Value contains ": " and needs quotes';
    detail = 'A value with a colon followed by a space confuses YAML. Put the whole value in quotes, for example `description: "Usage: /home"`.';
  } else if (/^\s*[@`]/.test(value)) {
    title = 'Value starts with a reserved character';
    detail = 'In YAML a value cannot start with @ or `. Put the value in quotes, for example `prefix: "@Shop"`.';
  } else if (/^\s*[*&!%]/.test(value)) {
    title = 'Value starts with a special character';
    detail = 'In YAML, *, &, ! and % at the start of a value mean something special. Put the value in quotes, for example `usage: "*"`.';
  } else if (/quoted scalar/.test(reason)) {
    title = 'Quote is never closed';
    detail = 'A value starts with a quote but the closing quote is missing.';
  } else if (/bad indentation/.test(reason)) {
    title = 'Indentation does not match';
    detail = 'This line is indented differently from the lines around it. Keys that belong together must start in the same column, using spaces only.';
  } else if (/multiline key|implicit key|could not find expected ':'/.test(reason)) {
    title = 'Missing colon or broken key';
    detail = 'This line (or the one above) looks like a key without `:` after it, or a key that spans two lines.';
  } else if (/flow collection|missed comma/.test(reason)) {
    title = 'Broken [list] or {map}';
    detail = 'A `[...]` or `{...}` on this line is not closed or is missing a comma between items.';
  } else if (/unidentified alias/.test(reason)) {
    title = 'Value starts with *';
    detail = 'In YAML, `*name` refers to an anchor. Put the value in quotes, for example `usage: "*"`.';
  }
  ctx.add('refuse', 'yaml-syntax', line, title, detail, { parser: reason });
}

// ---------- shared checks ----------

function checkDuplicates(ctx) {
  for (const d of ctx.idx.duplicates()) {
    const name = d.path[d.path.length - 1];
    ctx.add('warning', 'duplicate-key', d.lines[d.lines.length - 1], `${q(name)} appears ${d.lines.length} times`,
      `Lines ${d.lines.join(', ')} set the same key. The server keeps only the last one and silently drops the rest. ` +
      (['commands', 'permissions'].includes(name) && d.path.length === 1
        ? 'With a whole section this means every command or permission in the earlier block is gone.'
        : 'Remove the extra copies.'));
  }
}

function checkUnknownKeys(ctx, data, known, path, what) {
  for (const key of Object.keys(data)) {
    if (known.includes(key)) continue;
    const line = ctx.idx.lineOf([...path, key]);
    const guess = closest(key, known);
    if (guess) {
      ctx.add('warning', 'unknown-key', line, `Unknown ${what} key ${q(key)}. Did you mean ${q(guess)}?`,
        `Keys are case-sensitive and the server ignores ones it does not know, so ${q(key)} has no effect.`, { fix: guess });
    } else if (path.length === 0) {
      ctx.add('tip', 'unknown-key', line, `Unknown key ${q(key)}`,
        'The server ignores this key. That is fine if your own code reads it.');
    } else {
      ctx.add('warning', 'unknown-key', line, `Unknown ${what} key ${q(key)}`,
        `The server ignores it. Allowed here: ${known.map(q).join(', ')}.`);
    }
  }
}

function checkName(ctx, data) {
  const line = ctx.idx.lineOf(['name']);
  if (data.name === undefined || data.name === null) {
    ctx.add('refuse', 'name-missing', line ?? 1, 'No `name`', 'Every plugin needs a name, for example `name: MyPlugin`.', { server: 'name is not defined' });
    return null;
  }
  const name = javaText(data.name, ctx.idx.rawOf(['name']));
  if (!NAME_RE.test(name)) {
    ctx.add('refuse', 'name-chars', line, 'Plugin name has characters the server rejects',
      'A plugin name may contain only letters, digits, spaces, `_`, `.` and `-`.', { server: `name '${name}' contains invalid characters.` });
  } else if (name.includes(' ')) {
    ctx.add('refuse', 'name-space', line, 'Plugin name contains a space',
      `Paper refuses names with spaces. Use ${q(name.replace(/ /g, ''))} or ${q(name.replace(/ /g, '_'))}.`,
      { server: 'Restricted name, cannot use 0x20 (space character) in a plugin name.' });
  }
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    ctx.add('refuse', 'name-reserved', line, `${q(name)} is a reserved name`,
      `The server does not allow these plugin names: ${RESERVED_NAMES.join(', ')}.`,
      { server: `Restricted name, cannot use ${name} as a plugin name.` });
  }
  return name;
}

function checkVersion(ctx, data) {
  const line = ctx.idx.lineOf(['version']);
  if (data.version === undefined || data.version === null) {
    ctx.add('refuse', 'version-missing', line ?? 1, 'No `version`', 'Add a version, for example `version: \'1.0.0\'`.', { server: 'version is not defined' });
    return;
  }
  const raw = (ctx.idx.rawOf(['version']) || '').trim();
  if (TRAILING_ZERO.test(raw)) {
    ctx.add('tip', 'version-quote', line, `Put version ${raw} in quotes`,
      `Current Paper reads it correctly, but older servers and many tools treat ${raw} as a number and show ${String(parseFloat(raw))}. \`version: '${raw}'\` is safe everywhere.`,
      { fix: `version: '${raw}'` });
  }
}

function checkMain(ctx, data, key = 'main') {
  const line = ctx.idx.lineOf([key]);
  const main = data[key];
  if (main === undefined || main === null) {
    if (key === 'main') {
      ctx.add('refuse', 'main-missing', line ?? 1, 'No `main`',
        'The server needs the full name of your main class, for example `main: com.example.myplugin.MyPlugin`.', { server: 'main is not defined' });
    }
    return null;
  }
  if (typeOf(main) !== 'string') {
    ctx.add('refuse', 'main-type', line, `${q(key)} must be a class name`, 'Write the full class name as text.', { server: `${key} is of wrong type` });
    return null;
  }
  const m = main.trim();
  if (/\.(java|class)$/.test(m) || m.includes('/') || m.includes('\\') || !CLASS_RE.test(m)) {
    ctx.add('refuse', 'main-format', line, `${q(m)} is not a Java class name`,
      'Use the package and class name separated by dots, without `.java`, `.class` or slashes, for example `com.example.myplugin.MyPlugin`.');
    return null;
  }
  if (key === 'main' && m.startsWith('org.bukkit.')) {
    ctx.add('refuse', 'main-bukkit', line, 'Main class is inside `org.bukkit`',
      'The server does not allow plugin classes in the org.bukkit package. Move your class to your own package, for example `com.yourname.plugin`.',
      { server: 'main may not be within the org.bukkit namespace' });
  } else if (!m.includes('.')) {
    ctx.add('warning', 'main-no-package', line, 'Main class has no package',
      'Put the class in a package such as `com.yourname.plugin`. Classes without a package clash easily with other plugins.');
  }
  return m;
}

function checkApiVersion(ctx, data, required) {
  const line = ctx.idx.lineOf(['api-version']);
  const v = data['api-version'];
  if (v === undefined || v === null) {
    if (required) {
      ctx.add('refuse', 'api-missing', line ?? 1, 'No `api-version`', `paper-plugin.yml requires it. Add \`api-version: '${LATEST_API}'\` (or the oldest version you support).`,
        { server: '[api-version] of type org.bukkit.craftbukkit.util.ApiVersion: A value is required for this field', fix: `api-version: '${LATEST_API}'` });
    } else {
      ctx.add('warning', 'api-missing', line ?? 1, 'No `api-version`: the plugin runs in legacy mode',
        `Without it the server treats the plugin as written for Minecraft 1.12 or older. It turns on Legacy Material Support, which slows startup and rewrites your code at load time. Add \`api-version: '${LATEST_API}'\` (or the oldest version you support).`,
        { server: 'Legacy plugin <name> v<version> does not specify an api-version.', fix: `api-version: '${LATEST_API}'` });
    }
    return;
  }
  const raw = (ctx.idx.rawOf(['api-version']) || '').trim();
  const seen = javaText(v, raw);
  if (/\$\{[^}]+\}|@[A-Za-z_.]+@/.test(seen)) return; // build placeholder, see checkPlaceholders
  if (!API_RE.test(seen)) {
    ctx.add('refuse', 'api-format', line, `api-version ${q(seen)} has the wrong format`,
      `It must be two or three numbers separated by dots, for example '1.21.4' or '${LATEST_API}'. Things like '1.21-R0.1' or '26' are rejected.`,
      { server: `API version string should be of format "major.minor.patch" or "major.minor", where "major", "minor" and "patch" are numbers. For example "1.18.2" or "1.13", but got '${seen}' instead.` });
    return;
  }
  if (isOlder(seen, '1.13')) {
    ctx.add('warning', 'api-legacy', line, `api-version ${seen} means legacy mode`,
      `Anything below 1.13 makes the server load the plugin in legacy mode (Legacy Material Support, slower startup, code rewritten at load time). Use 1.13 or newer.`);
  } else if (isOlder(LATEST_API, seen)) {
    ctx.add('warning', 'api-future', line, `api-version ${seen} is newer than any server we know`,
      `The newest Paper we know is ${LATEST_API}. Servers older than ${seen} refuse to load the plugin.`,
      { server: `Unsupported API version ${seen}` });
  } else {
    ctx.info.push(`Loads on servers ${seen} and newer. Older servers refuse it with "Unsupported API version ${seen}".`);
  }
  if (TRAILING_ZERO.test(raw)) {
    ctx.add('tip', 'api-quote', line, `Put api-version ${raw} in quotes`,
      `Current Paper reads it correctly, but older servers read an unquoted ${raw} as the number ${String(parseFloat(raw))}. \`api-version: '${raw}'\` is safe everywhere.`,
      { fix: `api-version: '${raw}'` });
  }
}

function parseVer(s) {
  return String(s).split('.').map((n) => parseInt(n, 10) || 0);
}

function isOlder(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

function checkLoad(ctx, data) {
  if (data.load === undefined || data.load === null) return;
  const line = ctx.idx.lineOf(['load']);
  if (typeOf(data.load) !== 'string') {
    ctx.add('refuse', 'load-type', line, '`load` must be STARTUP or POSTWORLD', '', { server: 'load is of wrong type' });
    return;
  }
  const norm = data.load.toUpperCase().replace(/\W/g, '');
  if (norm !== 'STARTUP' && norm !== 'POSTWORLD') {
    ctx.add('refuse', 'load-value', line, `\`load: ${data.load}\` is not a valid choice`,
      '`load` can only be STARTUP (before worlds load) or POSTWORLD (the default). If you do not need STARTUP, remove the line.',
      { server: 'load is not a valid choice' });
  }
}

function checkStringList(ctx, data, key, message) {
  const v = data[key];
  if (v === undefined || v === null) return null;
  const line = ctx.idx.lineOf([key]);
  if (typeOf(v) !== 'list') {
    const shown = javaText(v, ctx.idx.rawOf([key]));
    ctx.add('refuse', `${key}-type`, line, `${q(key)} must be a list`,
      `Write it as a list, for example \`${key}: [${shown}]\`, or put each entry on its own line starting with \`- \`.`,
      { server: message, fix: `${key}: [${shown}]` });
    return null;
  }
  return v.map((x) => javaText(x));
}

function checkDepends(ctx, data, name) {
  const lists = {};
  for (const key of ['depend', 'softdepend', 'loadbefore']) {
    const list = checkStringList(ctx, data, key, `${key} is of wrong type`);
    if (!list) continue;
    lists[key] = list;
    const seen = new Set();
    const occ = new Map();
    for (const raw of list) {
      const dep = raw.replace(/ /g, '_');
      const nth = occ.get(raw) || 0;
      occ.set(raw, nth + 1);
      const line = ctx.idx.itemLine([key], raw, nth);
      if (name && dep === name.replace(/ /g, '_')) {
        ctx.add('crash', 'depend-self', line, `The plugin lists itself in \`${key}\``,
          `${q(name)} points to itself, which makes a loop in the load order. On ${TESTED_ON} this does not just skip the plugin: the whole server crashes at startup. Remove it from the list.`,
          { server: `java.lang.IllegalArgumentException: Cannot add self-loop edge on node ${name}, as self-loops are not allowed.` });
      }
      if (seen.has(dep)) {
        ctx.add('tip', 'depend-dup', line, `${q(raw)} is listed twice in \`${key}\``, 'Remove the duplicate.');
      }
      seen.add(dep);
      if (raw.includes(' ')) {
        ctx.add('tip', 'depend-space', line, `${q(raw)} contains a space`,
          `The server turns spaces into underscores and looks for ${q(dep)}. Plugin names cannot contain spaces on Paper, so this is probably a typo.`);
      }
    }
  }
  if (lists.depend && lists.softdepend) {
    for (const dep of lists.depend.filter((d) => lists.softdepend.includes(d))) {
      ctx.add('warning', 'depend-both', ctx.idx.itemLine(['softdepend'], dep), `${q(dep)} is in both \`depend\` and \`softdepend\``,
        '`depend` means the plugin will not load without it; `softdepend` means it is optional. Pick one.');
    }
  }
}

function checkPermissionDefaultValue(ctx, value, line, label) {
  const raw = javaText(value).toLowerCase().replace(/[^a-z!]/g, '');
  if (PERMISSION_DEFAULTS[raw]) return PERMISSION_DEFAULTS[raw];
  ctx.add(label === 'default-permission' ? 'warning' : 'broken', 'perm-default', line,
    `${q(javaText(value))} is not a valid default`,
    'Use one of: `true` (everyone), `false` (nobody), `op` (operators only) or `not op` (everyone except operators).' +
    (label === 'default-permission' ? '' : ' The server skips this whole permission, so it will not exist.'),
    label === 'default-permission' ? {} : { server: "'default' key contained unknown value" });
  return null;
}

// Collects permission definitions, including ones defined inline under children.
function collectPermissions(ctx, perms, pluginDefault, out, path) {
  for (const [name, def] of Object.entries(perms)) {
    const p = [...path, name];
    const line = ctx.idx.lineOf(p);
    if (def !== null && typeOf(def) !== 'map') {
      ctx.add('broken', 'perm-type', line, `Permission ${q(name)} is not a section`,
        'Each permission must be a section with `description`, `default` and/or `children` under it. The server skips this one.',
        { server: `Permission node '${name}' in plugin description file for <plugin> is invalid` });
      continue;
    }
    const d = def || {};
    const node = { name, line, def: pluginDefault, children: new Map(), valid: true, path: p };
    checkUnknownKeys(ctx, d, PERMISSION_KEYS, p, 'permission');
    if (d.default !== undefined && d.default !== null) {
      const v = checkPermissionDefaultValue(ctx, d.default, ctx.idx.lineOf([...p, 'default']), 'default');
      if (v) node.def = v;
      else node.valid = false;
    }
    const ch = d.children;
    const chLine = ctx.idx.lineOf([...p, 'children']);
    if (ch !== undefined && ch !== null) {
      if (typeOf(ch) === 'list') {
        for (const c of ch) if (c !== null) node.children.set(javaText(c), { value: true, line: ctx.idx.itemLine([...p, 'children'], c) });
      } else if (typeOf(ch) === 'map') {
        for (const [child, val] of Object.entries(ch)) {
          const cLine = ctx.idx.lineOf([...p, 'children', child]);
          if (typeOf(val) === 'boolean') {
            node.children.set(child, { value: val, line: cLine });
          } else if (typeOf(val) === 'map') {
            node.children.set(child, { value: true, line: cLine });
            collectPermissions(ctx, { [child]: val }, node.def, out, [...p, 'children']);
          } else {
            node.valid = false;
            ctx.add('broken', 'perm-child-value', cLine, `Child ${q(child)} must be true or false`,
              (typeOf(val) === 'string'
                ? `It is the text ${q(String(val))}. Remove the quotes: \`${child}: ${/^(true|yes|on)$/i.test(String(val)) ? 'true' : 'false'}\`. `
                : '') + `The server skips the whole permission ${q(name)} because of this.`,
              { server: `Child '${child}' contains invalid value` });
          }
        }
      } else {
        node.valid = false;
        ctx.add('broken', 'perm-children-type', chLine, `\`children\` of ${q(name)} must be a list or a section`,
          `Write \`children: [${javaText(ch)}]\` or put each child on its own line as \`${javaText(ch)}: true\`. The server skips the whole permission ${q(name)}.`,
          { server: "'children' key is of wrong type" });
      }
    }
    if (/\.\*$/.test(name) && node.children.size === 0) {
      ctx.add('tip', 'perm-wildcard', line, `${q(name)} has no children`,
        `The server does not expand * by itself. Without children, ${q(name)} gives nothing extra unless a permissions plugin such as LuckPerms handles wildcards. List the permissions it should include under \`children\`.`);
    }
    out.set(name.toLowerCase(), node);
  }
}

function checkPermissions(ctx, data) {
  const perms = data.permissions;
  const nodes = new Map();
  let pluginDefault = 'op';
  if (data['default-permission'] !== undefined && data['default-permission'] !== null) {
    pluginDefault = checkPermissionDefaultValue(ctx, data['default-permission'], ctx.idx.lineOf(['default-permission']), 'default-permission') || 'op';
  }
  if (perms === undefined || perms === null) return nodes;
  if (typeOf(perms) !== 'map') {
    ctx.add('refuse', 'permissions-type', ctx.idx.lineOf(['permissions']), '`permissions` must be a section',
      'Put each permission on its own line under `permissions:`, indented, ending with a colon.', { server: 'permissions are of the wrong type' });
    return nodes;
  }
  collectPermissions(ctx, perms, pluginDefault, nodes, ['permissions']);
  findPermissionLoops(ctx, nodes);
  return nodes;
}

function findPermissionLoops(ctx, nodes) {
  // Nodes reachable from anything granted by default to operators or everyone:
  // the console is an operator, so these are expanded during startup.
  const startupRoots = [...nodes.values()].filter((n) => n.valid && (n.def === 'op' || n.def === 'true'));
  const reachable = new Set();
  const walk = (n) => {
    if (reachable.has(n.name.toLowerCase())) return;
    reachable.add(n.name.toLowerCase());
    for (const c of n.children.keys()) {
      const child = nodes.get(c.toLowerCase());
      if (child && child.valid) walk(child);
    }
  };
  startupRoots.forEach(walk);

  const seenCycles = new Set();
  const state = new Map(); // 1 = on stack, 2 = done
  const stack = [];
  const visit = (n) => {
    const key = n.name.toLowerCase();
    state.set(key, 1);
    stack.push(n);
    for (const c of n.children.keys()) {
      const child = nodes.get(c.toLowerCase());
      if (!child || !child.valid) continue;
      const ck = c.toLowerCase();
      if (state.get(ck) === 1) {
        const from = stack.findIndex((s) => s.name.toLowerCase() === ck);
        const cycle = stack.slice(from);
        const id = cycle.map((s) => s.name.toLowerCase()).sort().join('|');
        if (!seenCycles.has(id)) {
          seenCycles.add(id);
          reportLoop(ctx, cycle, reachable.has(ck));
        }
      } else if (!state.get(ck)) {
        visit(child);
      }
    }
    stack.pop();
    state.set(key, 2);
  };
  for (const n of nodes.values()) if (n.valid && !state.get(n.name.toLowerCase())) visit(n);
}

function reportLoop(ctx, cycle, atStartup) {
  const names = [...cycle.map((n) => n.name), cycle[0].name];
  const first = cycle[0];
  const next = cycle[1 % cycle.length] || cycle[0];
  const edge = first.children.get(next.name) || [...first.children.values()][0];
  ctx.add('crash', 'perm-loop', edge ? edge.line : first.line,
    cycle.length === 1 ? `Permission ${q(first.name)} is its own child` : 'Permission loop',
    `${names.map(q).join(' → ')}. The server follows children with no loop check and dies with StackOverflowError. ` +
    (atStartup
      ? `Here it happens at startup, because one of these is given to operators by default (the console is an operator). Tested on ${TESTED_ON}: the whole server crashed.`
      : 'It happens as soon as a player gets one of these permissions.') +
    ' Remove one of the children so the chain ends.',
    { server: 'java.lang.StackOverflowError at org.bukkit.permissions.PermissibleBase.calculateChildPermissions' });
}

function checkCommands(ctx, data, permNodes) {
  const cmds = data.commands;
  if (cmds === undefined || cmds === null) return;
  const line = ctx.idx.lineOf(['commands']);
  if (typeOf(cmds) !== 'map') {
    ctx.add('refuse', 'commands-type', line, '`commands` must be a section',
      'Put each command on its own line under `commands:`, indented, ending with a colon, for example:\n\ncommands:\n  home:\n    description: Teleports you home',
      { server: 'commands are of wrong type' });
    return;
  }
  const labels = new Map(); // label -> command that owns it
  for (const name of Object.keys(cmds)) labels.set(name.toLowerCase(), name);
  const declared = [...permNodes.values()].map((n) => n.name);
  const undeclared = [];

  for (const [name, def] of Object.entries(cmds)) {
    const p = ['commands', name];
    const cLine = ctx.idx.lineOf(p);
    if (name.includes(':')) {
      ctx.add('broken', 'command-colon', cLine, `Command ${q(name)} contains ":"`,
        'The colon is reserved for `plugin:command` prefixes. The server skips this command; the plugin still loads without it.',
        { server: `Could not load command ${name} for plugin <plugin>: Illegal Characters` });
    } else if (/\s/.test(name)) {
      ctx.add('broken', 'command-space', cLine, `Command ${q(name)} contains a space`, 'Players can never type it. Use one word.');
    }
    if (def === null || def === undefined) continue;
    if (typeOf(def) !== 'map') {
      ctx.add('refuse', 'command-type', cLine, `Command ${q(name)} must be a section`,
        `Put its settings on separate lines under it, for example:\n\n  ${name}:\n    description: ${javaText(def)}`, { server: 'commands are of wrong type' });
      continue;
    }
    checkUnknownKeys(ctx, def, COMMAND_KEYS, p, 'command');

    const aliases = def.aliases;
    if (aliases !== undefined && aliases !== null) {
      const list = typeOf(aliases) === 'list' ? aliases.map((a) => javaText(a)) : [javaText(aliases)];
      for (const alias of list) {
        const aLine = ctx.idx.itemLine([...p, 'aliases'], alias);
        if (alias.includes(':')) {
          ctx.add('broken', 'alias-colon', aLine, `Alias ${q(alias)} contains ":"`, 'The server skips this alias.',
            { server: `Could not load alias ${alias} for plugin <plugin>: Illegal Characters` });
          continue;
        }
        const owner = labels.get(alias.toLowerCase());
        if (owner && owner !== name) {
          ctx.add('warning', 'alias-clash', aLine, `Alias ${q(alias)} is already taken by ${q(owner)}`,
            'Two commands in this file answer to the same word, so one of them will not get it. Rename the alias.');
        } else if (owner === name && alias.toLowerCase() === name.toLowerCase()) {
          ctx.add('tip', 'alias-self', aLine, `Alias ${q(alias)} is the command itself`, 'Remove it from aliases.');
        } else {
          labels.set(alias.toLowerCase(), name);
        }
      }
    }

    if (def.permission !== undefined && def.permission !== null) {
      const pLine = ctx.idx.lineOf([...p, 'permission']);
      // "a.b;a.c" means any one of these permissions is enough.
      for (const part of javaText(def.permission).split(';')) {
        const perm = part.trim();
        if (!perm || permNodes.has(perm.toLowerCase())) continue;
        const guess = closest(perm, declared, 2, false);
        if (guess) {
          ctx.add('warning', 'command-perm-typo', pLine, `Permission ${q(perm)} is not declared. Did you mean ${q(guess)}?`,
            `The command checks ${q(perm)}, but the permissions section only has a similar name. Players who have ${q(guess)} still will not be able to use /${name}.`,
            { fix: guess });
        } else {
          undeclared.push({ perm, line: pLine, name });
        }
      }
    }
  }

  if (undeclared.length) {
    const list = undeclared.map((u) => q(u.perm)).join(', ');
    ctx.add('tip', 'command-perm-undeclared', undeclared[0].line,
      undeclared.length === 1 ? `Permission ${list} is not declared` : `${undeclared.length} command permissions are not declared`,
      `${list} ${undeclared.length === 1 ? 'is' : 'are'} not listed under \`permissions\`. That works, but such permissions are operator-only by default. Declare them with a \`default\` if regular players should have them.`);
  }
}

function checkLibraries(ctx, data) {
  const libs = checkStringList(ctx, data, 'libraries', 'libraries are of wrong type');
  if (!libs) return;
  for (const lib of libs) {
    if (!LIB_RE.test(lib)) {
      ctx.add('refuse', 'library-format', ctx.idx.itemLine(['libraries'], lib), `${q(lib)} is not a Maven coordinate`,
        'Use `group:artifact:version`, for example `com.google.code.gson:gson:2.11.0`. The plugin fails to load.',
        { server: `Bad artifact coordinates ${lib}, expected format is <groupId>:<artifactId>[:<extension>[:<classifier>]]:<version>` });
    }
  }
}

function checkAuthors(ctx, data) {
  checkStringList(ctx, data, 'authors', 'authors are of wrong type');
  checkStringList(ctx, data, 'contributors', 'contributors are of wrong type');
  if (typeOf(data.author) === 'list') {
    ctx.add('tip', 'author-list', ctx.idx.lineOf(['author']), 'Use `authors` for a list',
      '`author` is for one name. For several people write `authors: [Alice, Bob]`.');
  }
}

function checkFolia(ctx, data) {
  const v = data['folia-supported'];
  if (v === undefined || v === null) return;
  if (typeOf(v) !== 'boolean') {
    ctx.add('warning', 'folia-type', ctx.idx.lineOf(['folia-supported']), '`folia-supported` must be true or false',
      `It is ${q(javaText(v))}. Write \`folia-supported: true\` without quotes.`);
  }
}

function checkPlaceholders(ctx, data) {
  for (const key of ['name', 'version', 'main', 'api-version', 'description']) {
    const v = data && data[key];
    if (typeof v === 'string' && /\$\{[^}]+\}|@[A-Za-z_.]+@/.test(v)) {
      ctx.add('tip', 'placeholder', ctx.idx.lineOf([key]), `${q(key)} is a build placeholder`,
        `${q(v)} is fine in your source folder, as long as Gradle (processResources / expand) or Maven (resource filtering) replaces it. Check the plugin.yml inside the built jar.`);
      return;
    }
  }
}

// ---------- plugin.yml ----------

function checkPluginYml(ctx, data) {
  checkUnknownKeys(ctx, data, PLUGIN_KEYS, [], 'top-level');
  const name = checkName(ctx, data);
  checkVersion(ctx, data);
  checkMain(ctx, data);
  checkApiVersion(ctx, data, false);
  checkLoad(ctx, data);
  checkDepends(ctx, data, name);
  checkStringList(ctx, data, 'provides', 'provides is of wrong type');
  checkAuthors(ctx, data);
  checkLibraries(ctx, data);
  checkFolia(ctx, data);
  const nodes = checkPermissions(ctx, data);
  checkCommands(ctx, data, nodes);
  if (data.awareness !== undefined) {
    ctx.add('tip', 'awareness', ctx.idx.lineOf(['awareness']), '`awareness` is outdated', 'Modern servers ignore it. You can remove it.');
  }
}

// ---------- paper-plugin.yml (basic) ----------

function checkPaperPlugin(ctx, data) {
  // Sections Paper ignores in this file get their own message below.
  checkUnknownKeys(ctx, data, [...PAPER_KEYS, 'commands', 'depend', 'softdepend', 'loadbefore', 'libraries'], [], 'top-level');
  checkName(ctx, data);
  checkVersion(ctx, data);
  checkMain(ctx, data);
  checkMain(ctx, data, 'bootstrapper');
  checkMain(ctx, data, 'loader');
  checkApiVersion(ctx, data, true);
  checkLoad(ctx, data);
  checkFolia(ctx, data);
  checkPermissions(ctx, data);

  if (data.commands !== undefined) {
    ctx.add('broken', 'paper-commands', ctx.idx.lineOf(['commands']), 'paper-plugin.yml has no `commands` section',
      'Paper plugins ignore commands declared here, so none of them will exist. Register commands in code with the Brigadier API (LifecycleEvents.COMMANDS), or use a plain plugin.yml.');
  }
  for (const key of ['depend', 'softdepend', 'loadbefore']) {
    if (data[key] !== undefined) {
      ctx.add('broken', 'paper-depend', ctx.idx.lineOf([key]), `\`${key}\` is ignored in paper-plugin.yml`,
        'Paper plugins declare dependencies under `dependencies:` → `server:` (or `bootstrap:`), for example:\n\ndependencies:\n  server:\n    Vault:\n      load: BEFORE\n      required: true');
    }
  }
  if (data.libraries !== undefined) {
    ctx.add('broken', 'paper-libraries', ctx.idx.lineOf(['libraries']), '`libraries` is ignored in paper-plugin.yml',
      'Paper plugins load libraries through a PluginLoader class set in `loader:`.');
  }
  const deps = data.dependencies;
  if (deps !== undefined && deps !== null) {
    if (typeOf(deps) !== 'map') {
      ctx.add('refuse', 'paper-deps-type', ctx.idx.lineOf(['dependencies']), '`dependencies` must be a section', 'It needs `server:` and/or `bootstrap:` under it.');
      return;
    }
    for (const [stage, list] of Object.entries(deps)) {
      const sp = ['dependencies', stage];
      if (stage !== 'server' && stage !== 'bootstrap') {
        ctx.add('warning', 'paper-deps-stage', ctx.idx.lineOf(sp), `Unknown dependency stage ${q(stage)}`,
          'Only `server` and `bootstrap` are allowed under `dependencies`.' + (/^[A-Z]/.test(stage) ? ' It looks like a plugin name: put it under `server:`.' : ''));
        continue;
      }
      if (list === null) continue;
      if (typeOf(list) !== 'map') {
        ctx.add('refuse', 'paper-deps-list', ctx.idx.lineOf(sp), `\`${stage}\` must be a section of plugin names`,
          `Each dependency is a plugin name with settings under it, for example:\n\n    ${stage}:\n      Vault:\n        required: true`);
        continue;
      }
      for (const [dep, conf] of Object.entries(list)) {
        const dp = [...sp, dep];
        if (data.name && dep === javaText(data.name)) {
          ctx.add('crash', 'depend-self', ctx.idx.lineOf(dp), 'The plugin depends on itself',
            'A plugin that lists itself makes a loop in the load order. In plugin.yml this crashes the whole Paper server at startup; remove it here too.');
        }
        if (conf === null) continue;
        if (typeOf(conf) !== 'map') {
          ctx.add('refuse', 'paper-dep-type', ctx.idx.lineOf(dp), `Settings for ${q(dep)} must be a section`, 'Use `load`, `required` and `join-classpath` under the plugin name.');
          continue;
        }
        checkUnknownKeys(ctx, conf, ['load', 'required', 'join-classpath'], dp, 'dependency');
        if (conf.load !== undefined && !['BEFORE', 'AFTER', 'OMIT'].includes(String(conf.load).toUpperCase())) {
          ctx.add('refuse', 'paper-dep-load', ctx.idx.lineOf([...dp, 'load']), `\`load: ${javaText(conf.load)}\` is not valid`, 'Use BEFORE, AFTER or OMIT.');
        }
        for (const flag of ['required', 'join-classpath']) {
          if (conf[flag] !== undefined && typeOf(conf[flag]) !== 'boolean') {
            ctx.add('refuse', 'paper-dep-flag', ctx.idx.lineOf([...dp, flag]), `\`${flag}\` must be true or false`, 'Remove the quotes around the value.');
          }
        }
      }
    }
  }
}

// ---------- jar contents ----------

// names: every file path inside the jar. mainMajor: class file major version of
// the main class, or null. ymlName: which description file was found.
export function checkJar(result, { names, mainMajor, ymlName }) {
  const add = (impact, code, title, detail, extra = {}) =>
    result.findings.push({ impact, code, line: null, title, detail, ...extra });
  if (!ymlName) {
    add('refuse', 'jar-no-yml', 'The jar has no plugin.yml',
      'The server only loads jars with plugin.yml (or paper-plugin.yml) at the top level of the jar. Check that it is in src/main/resources and not in a sub-folder.',
      { server: "does not contain a paper-plugin.yml or plugin.yml! Could not determine plugin type, cannot load a plugin from it!" });
  } else {
    if (names.has('plugin.yml') && names.has('paper-plugin.yml')) {
      add('tip', 'jar-both', 'The jar has both plugin.yml and paper-plugin.yml', 'Paper uses paper-plugin.yml and ignores plugin.yml. Spigot uses plugin.yml.');
    }
    const data = result.data;
    if (data && typeof data.main === 'string' && CLASS_RE.test(data.main.trim())) {
      const path = data.main.trim().replace(/\./g, '/') + '.class';
      if (!names.has(path)) {
        add('refuse', 'jar-no-main', `Main class ${q(data.main.trim())} is not in the jar`,
          'There is no ' + q(path) + ' inside. Check the package and class name for typos, and that the class was compiled into this jar.',
          { server: `java.lang.ClassNotFoundException: ${data.main.trim()}` });
      } else if (mainMajor) {
        const java = mainMajor - 44;
        add('tip', 'jar-java', `Compiled for Java ${java}`, `The server must run Java ${java} or newer, otherwise it fails with UnsupportedClassVersionError.`);
      }
    }
    if (data) {
      for (const key of ['version', 'name', 'main']) {
        const v = data[key];
        if (typeof v === 'string' && /\$\{[^}]+\}|@[A-Za-z_.]+@/.test(v)) {
          add('warning', 'jar-placeholder', `${q(key)} in the built jar is still ${q(v)}`,
            'Your build did not replace the placeholder. In Gradle add `expand` in processResources; in Maven turn on resource filtering.');
        }
      }
    }
  }
  const rank = (f) => IMPACTS.indexOf(f.impact);
  result.findings.sort((a, b) => rank(a) - rank(b) || (a.line ?? 1e9) - (b.line ?? 1e9));
  result.verdict = result.findings.length ? result.findings[0].impact : 'ok';
  return result;
}
