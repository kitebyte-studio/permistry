// Maps YAML keys and list items to line numbers.
// js-yaml gives us the data but not where each key lives, so this is a
// small line scanner for the block-style YAML that plugin.yml files use.

const SEP = '\u0000';

// A key at the start of a line: "key:", "'key':" or "\"key\":", followed by
// a space or the end of the line. Plain keys may contain ':' (e.g. "a:b:").
const KEY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"[\]{},][^#]*?))[ \t]*:(?=[ \t]|$)/;

export function pathKey(path) {
  return path.join(SEP);
}

// Removes a trailing "# comment" that is not inside quotes.
export function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

export function indexYaml(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const keys = new Map(); // pathKey -> [{ line, raw }]
  const items = []; // { pathKey, value, line }
  const stack = []; // { indent, key }
  let blockScalarIndent = null;

  lines.forEach((rawLine, i) => {
    const ln = i + 1;
    if (/^\s*(#.*)?$/.test(rawLine)) return;
    if (/^(---|\.\.\.)(\s|$)/.test(rawLine)) {
      stack.length = 0;
      return;
    }
    const indent = rawLine.length - rawLine.replace(/^ +/, '').length;
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) return;
      blockScalarIndent = null;
    }
    const rest = rawLine.slice(indent);
    if (rest.startsWith('\t')) return;

    if (/^-(\s|$)/.test(rest)) {
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      items.push({
        pathKey: pathKey(stack.map((s) => s.key)),
        value: unquote(stripComment(rest.replace(/^-\s*/, ''))),
        line: ln,
      });
      return;
    }

    const m = KEY_RE.exec(rest);
    if (!m) return;
    let key;
    if (m[1] !== undefined) key = m[1].replace(/\\"/g, '"');
    else if (m[2] !== undefined) key = m[2].replace(/''/g, "'");
    else key = m[3].trim();

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = [...stack.map((s) => s.key), key];
    const raw = stripComment(rest.slice(m[0].length)).trim();
    const pk = pathKey(path);
    if (!keys.has(pk)) keys.set(pk, []);
    keys.get(pk).push({ line: ln, raw });
    stack.push({ indent, key });
    if (/^[|>][-+0-9]*$/.test(raw)) blockScalarIndent = indent;
  });

  return {
    lines,
    keys,
    items,
    // Line of the key at `path` (last occurrence wins, like the server).
    // Falls back to the closest parent that exists.
    lineOf(path) {
      for (let n = path.length; n > 0; n--) {
        const hits = keys.get(pathKey(path.slice(0, n)));
        if (hits) return hits[hits.length - 1].line;
      }
      return null;
    },
    // Raw text after "key:" on the key's own line ('' when the value is below).
    rawOf(path) {
      const hits = keys.get(pathKey(path));
      return hits ? hits[hits.length - 1].raw : null;
    },
    itemLine(path, value) {
      const pk = pathKey(path);
      const hit = items.find((it) => it.pathKey === pk && it.value === String(value));
      return hit ? hit.line : this.lineOf(path);
    },
    duplicates() {
      const out = [];
      for (const [pk, hits] of keys) {
        if (hits.length > 1) out.push({ path: pk.split(SEP), lines: hits.map((h) => h.line) });
      }
      return out;
    },
  };
}
