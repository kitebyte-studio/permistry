import { validate, checkJar, TESTED_ON } from '../src/validator.js';

const EXAMPLE = `name: HomeTeleport
version: 1.10
main: com.example.hometeleport.HomeTeleport
api-version: '26.3'
softdepends: [Vault]

commands:
  home:
    description: Teleport to one of your homes
    alias: [h]
    permission: hometeleport.hmoe
  sethome:
    description: Save the place you stand as a home
    permission: hometeleport.sethome

permissions:
  hometeleport.*:
    default: op
    children:
      hometeleport.home: true
      hometeleport.admin: true
  hometeleport.home:
    default: true
  hometeleport.admin:
    description: Manage other players' homes
    children:
      hometeleport.*: true
`;

const LABELS = {
  crash: 'Crashes the server',
  refuse: 'Will not load',
  broken: 'Partly broken',
  warning: 'Warning',
  tip: 'Tip',
};

const VERDICTS = {
  crash: ['This will crash the server', 'Fix the red items first. They take the whole server down, not just your plugin.'],
  refuse: ['Paper will not load this plugin', 'The server stops reading the file at the first of these problems.'],
  broken: ['It loads, but part of it will not work', 'Some commands or permissions will be missing.'],
  warning: ['It loads, with warnings', 'Nothing fatal, but worth a look.'],
  tip: ['Looks good', 'A few small suggestions below.'],
  ok: ['Looks good', 'No problems found.'],
};

const $ = (id) => document.getElementById(id);
const input = $('input');
const gutter = $('gutter');
const flash = $('flash');
const findingsEl = $('findings');
const verdictEl = $('verdict');
const fileNameEl = $('fileName');
const fileInput = $('fileInput');

let jarContext = null; // { names, mainMajor, ymlName, jarName }
let currentFile = null; // name of an opened file; null for pasted text (kind is guessed)
let timer = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// `code` spans inside plain text.
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderDetail(detail) {
  return detail
    .split('\n\n')
    .filter((p) => p.trim())
    .map((p) => (p.includes('\n') || /^\s{2}/.test(p) ? `<pre>${esc(p)}</pre>` : `<p>${inline(p)}</p>`))
    .join('');
}

function chipText(impact, n) {
  const words = {
    crash: ['crash', 'crashes'],
    refuse: ['blocks loading', 'block loading'],
    broken: ['breaks something', 'break something'],
    warning: ['warning', 'warnings'],
    tip: ['tip', 'tips'],
  }[impact];
  return `${n} ${n === 1 ? words[0] : words[1]}`;
}

function lineHeight() {
  return parseFloat(getComputedStyle(input).lineHeight) || 20;
}

function renderGutter(findings) {
  const count = input.value.split('\n').length;
  const worst = new Map();
  const order = ['crash', 'refuse', 'broken', 'warning', 'tip'];
  for (const f of findings) {
    if (!f.line) continue;
    const prev = worst.get(f.line);
    if (!prev || order.indexOf(f.impact) < order.indexOf(prev)) worst.set(f.line, f.impact);
  }
  let html = '';
  for (let i = 1; i <= count; i++) {
    const w = worst.get(i);
    html += `<div class="ln${w ? ' mark-' + w : ''}">${i}</div>`;
  }
  gutter.innerHTML = html;
  gutter.scrollTop = input.scrollTop;
}

function jumpTo(line) {
  const lines = input.value.split('\n');
  if (line < 1 || line > lines.length) return;
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  input.focus({ preventScroll: true });
  input.setSelectionRange(start, start + lines[line - 1].length);
  const lh = lineHeight();
  input.scrollTop = Math.max(0, (line - 1) * lh - input.clientHeight / 3);
  flash.dataset.line = String(line);
  positionFlash();
  flash.classList.remove('on');
  void flash.offsetWidth; // restart the animation
  flash.classList.add('on');
}

function positionFlash() {
  const line = Number(flash.dataset.line || 0);
  if (!line) return;
  const pad = parseFloat(getComputedStyle(input).paddingTop) || 0;
  flash.style.top = `${pad + (line - 1) * lineHeight() - input.scrollTop}px`;
  flash.style.height = `${lineHeight()}px`;
}

function render(result) {
  const counts = {};
  for (const f of result.findings) counts[f.impact] = (counts[f.impact] || 0) + 1;
  const [title, sub] = VERDICTS[result.verdict];
  const chips = Object.keys(LABELS)
    .filter((k) => counts[k])
    .map((k) => `<span class="chip chip-${k}">${esc(chipText(k, counts[k]))}</span>`)
    .join('');
  const info = (result.info || []).map((t) => `<p class="info">${inline(t)}</p>`).join('');
  const kind = result.kind === 'paper' ? '<p class="info">Read as <code>paper-plugin.yml</code> (basic checks).</p>' : '';
  verdictEl.className = `verdict verdict-${result.verdict}`;
  verdictEl.innerHTML = `<h2>${esc(title)}</h2><p>${esc(sub)}</p>${chips ? `<div class="chips">${chips}</div>` : ''}${kind}${info}`;

  findingsEl.innerHTML = result.findings
    .map((f, i) => {
      const line = f.line ? `<button class="line" data-line="${f.line}" type="button">Line ${f.line}</button>` : '';
      const server = f.server ? `<div class="server"><span>Server log</span><code>${esc(f.server)}</code></div>` : '';
      return `<li class="finding f-${f.impact}" data-i="${i}">
        <div class="f-head"><span class="badge badge-${f.impact}">${esc(LABELS[f.impact])}</span>${line}</div>
        <h3>${inline(f.title)}</h3>
        ${f.detail ? renderDetail(f.detail) : ''}
        ${server}
      </li>`;
    })
    .join('');
  renderGutter(result.findings);
}

function renderEmpty() {
  verdictEl.className = 'verdict verdict-empty';
  verdictEl.innerHTML = `<h2>Paste a plugin.yml to start</h2><p>Or drop a plugin <code>.jar</code>, or load the broken example to see what Permistry finds. Checked against ${esc(TESTED_ON)}.</p>`;
  findingsEl.innerHTML = '';
  renderGutter([]);
}

function run() {
  const text = input.value;
  if (!text.trim() && !jarContext) {
    renderEmpty();
    if (!currentFile) fileNameEl.textContent = 'plugin.yml';
    return;
  }
  let result;
  try {
    result = jarContext && !jarContext.ymlName
      ? { kind: 'plugin', data: null, findings: [], info: [], verdict: 'ok' }
      : validate(text, { fileName: currentFile || undefined });
    if (jarContext) checkJar(result, jarContext);
  } catch (e) {
    showError(`Permistry hit an internal error on this file (${e && e.message}). Please report it on GitHub.`);
    return;
  }
  if (!currentFile) fileNameEl.textContent = result.kind === 'paper' ? 'paper-plugin.yml' : 'plugin.yml';
  render(result);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 200);
}

// name: the opened file's name, or null for pasted/example text.
function setSource(text, name, jar = null) {
  input.value = text;
  currentFile = name;
  jarContext = jar;
  fileNameEl.textContent = jar ? `${jar.jarName} › ${name || 'no plugin.yml'}` : name || 'plugin.yml';
  input.scrollTop = 0;
  flash.dataset.line = '';
  flash.classList.remove('on');
  run();
}

async function openJar(file) {
  const { unzipSync } = await import('../vendor/fflate.mjs');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const names = new Set();
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        names.add(f.name);
        return f.name === 'plugin.yml' || f.name === 'paper-plugin.yml';
      },
    });
  } catch {
    showError(`${file.name} is not a valid jar (zip) file.`);
    return;
  }
  const ymlName = files['paper-plugin.yml'] ? 'paper-plugin.yml' : files['plugin.yml'] ? 'plugin.yml' : null;
  const text = ymlName ? new TextDecoder().decode(files[ymlName]) : '';
  let mainMajor = null;
  const main = /^\s*main\s*:\s*['"]?([\w.$]+)/m.exec(text);
  if (main) {
    const path = main[1].replace(/\./g, '/') + '.class';
    if (names.has(path)) {
      const cls = unzipSync(bytes, { filter: (f) => f.name === path })[path];
      if (cls && cls.length > 8 && cls[0] === 0xca && cls[1] === 0xfe) mainMajor = (cls[6] << 8) | cls[7];
    }
  }
  setSource(text, ymlName, { names, mainMajor, ymlName, jarName: file.name });
}

function showError(message) {
  verdictEl.className = 'verdict verdict-refuse';
  verdictEl.innerHTML = `<h2>Could not open the file</h2><p>${esc(message)}</p>`;
  findingsEl.innerHTML = '';
}

async function openFile(file) {
  if (!file) return;
  if (/\.jar$/i.test(file.name)) {
    await openJar(file);
  } else if (file.size > 2_000_000) {
    showError('That file is too big to be a plugin.yml.');
  } else {
    setSource(await file.text(), file.name);
  }
}

// ---------- wiring ----------

input.addEventListener('input', () => {
  if (jarContext) {
    jarContext = null;
    fileNameEl.textContent = currentFile || 'plugin.yml';
  }
  schedule();
});
input.addEventListener('scroll', () => {
  gutter.scrollTop = input.scrollTop;
  positionFlash();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    // YAML forbids tabs: insert two spaces instead.
    e.preventDefault();
    const { selectionStart: s, selectionEnd: t } = input;
    input.setRangeText('  ', s, t, 'end');
    input.dispatchEvent(new Event('input'));
  }
});

findingsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-line]');
  if (btn) jumpTo(Number(btn.dataset.line));
});

$('exampleBtn').addEventListener('click', () => setSource(EXAMPLE, null));
$('clearBtn').addEventListener('click', () => {
  setSource('', null);
  input.focus();
});
$('openBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  openFile(fileInput.files[0]);
  fileInput.value = '';
});

const overlay = $('dropOverlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  openFile(e.dataTransfer?.files?.[0]);
});

window.addEventListener('resize', positionFlash);

renderEmpty();
