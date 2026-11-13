// Each fixture pXX.yml was loaded on a real Paper 26.3 (build 249) server.
// `expect` is what the server did, expressed as the finding codes we report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, checkJar } from '../src/validator.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.yml`, import.meta.url), 'utf8');
const codes = (r) => r.findings.map((f) => f.code);

const SERVER_CASES = {
  p01: { verdict: 'tip', codes: ['api-quote'] }, // 1.20 unquoted: Paper keeps "1.20"
  p02: { verdict: 'warning', codes: ['api-missing'] }, // "Legacy plugin ... does not specify an api-version."
  p03: { verdict: 'warning', codes: ['api-legacy'] }, // 1.12: loads in legacy mode
  p04: { verdict: 'warning', codes: ['api-future'] }, // "Unsupported API version 26.9"
  p05: { verdict: 'ok', codes: [] },
  p06: { verdict: 'ok', codes: [] },
  p07: { verdict: 'refuse', codes: ['name-space'] },
  p08: { verdict: 'refuse', codes: ['name-chars'] },
  p09: { verdict: 'refuse', codes: ['name-reserved'] },
  p10: { verdict: 'refuse', codes: ['main-bukkit'] },
  p12: { verdict: 'refuse', codes: ['version-missing'] },
  p13: { verdict: 'refuse', codes: ['depend-type'] },
  p14: { verdict: 'crash', codes: ['depend-self'] }, // whole server crashed
  p16: { verdict: 'refuse', codes: ['softdepend-type'] },
  p17: { verdict: 'refuse', codes: ['authors-type'] },
  p18: { verdict: 'refuse', codes: ['load-value'] },
  p19: { verdict: 'broken', codes: ['perm-default'] },
  p20: { verdict: 'broken', codes: ['perm-child-value'] },
  p21: { verdict: 'crash', codes: ['perm-loop'] }, // StackOverflowError, server crashed
  p22: { verdict: 'broken', codes: ['command-colon', 'alias-colon'] },
  p23: { verdict: 'warning', codes: ['duplicate-key'] }, // server kept the second name
  p24: { verdict: 'refuse', codes: ['yaml-tab'] },
  p25: { verdict: 'refuse', codes: ['library-format'] },
  p26: { verdict: 'ok', codes: [] }, // yes/no are booleans for the server
  p27: { verdict: 'ok', codes: [] }, // admin, !op, notop are valid defaults
  p30: { verdict: 'warning', codes: ['folia-type'] },
  p31: { verdict: 'ok', codes: [] }, // children as a list is fine
  p32: { verdict: 'warning', codes: ['api-future', 'api-quote'] }, // "Unsupported API version 26.10"
  p34: { verdict: 'refuse', codes: ['name-reserved'] },
  p35: { verdict: 'refuse', codes: ['name-reserved'] },
  p36: { verdict: 'broken', codes: ['perm-children-type'] },
  p37: { verdict: 'refuse', codes: ['commands-type'] },
  p40: { verdict: 'ok', codes: [] },
  p41: { verdict: 'ok', codes: [] },
};

for (const [name, want] of Object.entries(SERVER_CASES)) {
  test(`server case ${name}`, () => {
    const r = validate(fixture(name), { fileName: 'plugin.yml' });
    assert.equal(r.verdict, want.verdict, JSON.stringify(r.findings, null, 1));
    assert.deepEqual(codes(r).sort(), [...want.codes].sort());
  });
}

test('permission loop reports the chain and the line', () => {
  const r = validate(fixture('p21'), { fileName: 'plugin.yml' });
  const f = r.findings.find((x) => x.code === 'perm-loop');
  assert.match(f.detail, /p21\.a.*p21\.b.*p21\.a/);
  assert.match(f.detail, /at startup/);
  assert.equal(f.line, 9);
});

test('loop with default false is reported but not as a startup crash', () => {
  const r = validate(fixture('p39'), { fileName: 'plugin.yml' });
  const f = r.findings.find((x) => x.code === 'perm-loop');
  assert.ok(f);
  assert.doesNotMatch(f.detail, /at startup/);
});

test('value with ": " gets a quoting hint', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\ndescription: Usage: /home\n");
  assert.equal(r.verdict, 'refuse');
  assert.equal(r.findings[0].title, 'Value contains ": " and needs quotes');
  assert.equal(r.findings[0].line, 4);
});

test('value starting with @ gets a quoting hint', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\nprefix: @Shop\n");
  assert.equal(r.findings[0].title, 'Value starts with a reserved character');
});

test('duplicate commands section drops the first block', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\ncommands:\n  home: {}\ncommands:\n  spawn: {}\n");
  const f = r.findings.find((x) => x.code === 'duplicate-key');
  assert.ok(f);
  assert.match(f.detail, /every command or permission/);
  assert.equal(f.line, 7);
});

test('typo in a command permission is caught', () => {
  const yml = [
    'name: Homes', "version: '1.0'", 'main: com.example.homes.Homes', "api-version: '26.3'",
    'commands:', '  home:', '    permission: homes.hmoe',
    'permissions:', '  homes.home:', '    default: true',
  ].join('\n');
  const r = validate(yml);
  const f = r.findings.find((x) => x.code === 'command-perm-typo');
  assert.ok(f);
  assert.equal(f.fix, 'homes.home');
  assert.equal(f.line, 7);
});

test('alias used by two commands', () => {
  const yml = "name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\ncommands:\n  home:\n    aliases: [h]\n  hub:\n    aliases: [h]\n";
  assert.ok(codes(validate(yml)).includes('alias-clash'));
});

test('typo in a top-level key', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\nsoftdepends: [Vault]\n");
  const f = r.findings.find((x) => x.code === 'unknown-key');
  assert.equal(f.fix, 'softdepend');
  assert.equal(f.impact, 'warning');
});

test('typo in a command key', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\ncommands:\n  home:\n    alias: [h]\n");
  assert.equal(r.findings.find((x) => x.code === 'unknown-key').fix, 'aliases');
});

test('wildcard permission without children', () => {
  const r = validate("name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\npermissions:\n  a.*:\n    default: op\n");
  assert.ok(codes(r).includes('perm-wildcard'));
});

test('nested permission definitions are part of the loop check', () => {
  const yml = "name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\npermissions:\n  a.all:\n    default: true\n    children:\n      a.sub:\n        children:\n          a.all: true\n";
  assert.ok(codes(validate(yml)).includes('perm-loop'));
});

test('build placeholder is a tip, not an error', () => {
  const r = validate("name: A\nversion: '${version}'\nmain: a.B\napi-version: '${apiVersion}'\n");
  assert.deepEqual(codes(r), ['placeholder']);
});

test('clean file has no findings and reports the minimum server', () => {
  const r = validate("name: Homes\nversion: '1.0.0'\nmain: com.example.homes.Homes\napi-version: '1.21'\n");
  assert.equal(r.verdict, 'ok');
  assert.match(r.info[0], /1\.21 and newer/);
});

test('paper-plugin.yml is detected and commands are flagged', () => {
  const yml = "name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\ndependencies:\n  server:\n    Vault:\n      load: BEFORE\ncommands:\n  x: {}\n";
  const r = validate(yml);
  assert.equal(r.kind, 'paper');
  assert.ok(codes(r).includes('paper-commands'));
});

test('jar without plugin.yml', () => {
  const r = checkJar({ findings: [], data: null }, { names: new Set(['a/B.class']), mainMajor: null, ymlName: null });
  assert.equal(r.verdict, 'refuse');
});

test('jar whose main class is missing', () => {
  const r = validate("name: A\nversion: '1'\nmain: com.example.Missing\napi-version: '26.3'\n");
  checkJar(r, { names: new Set(['plugin.yml', 'com/example/Other.class']), mainMajor: null, ymlName: 'plugin.yml' });
  assert.equal(r.verdict, 'refuse');
  assert.ok(codes(r).includes('jar-no-main'));
});

// ---- cases from the code review ----

const HEAD = "name: A\nversion: '1'\nmain: a.B\napi-version: '26.3'\n";

test('duplicate list entries point at the second line', () => {
  const r = validate(HEAD + 'depend:\n  - Vault\n  - Vault\n');
  assert.equal(r.findings.find((x) => x.code === 'depend-dup').line, 7);
});

test('a permission that extends a declared one is not called a typo', () => {
  const r = validate(HEAD + 'commands:\n  tp:\n    permission: ess.tp\npermissions:\n  ess.tpa: {}\n');
  assert.ok(!codes(r).includes('command-perm-typo'));
});

test('a;b permission syntax is split', () => {
  const r = validate(HEAD + 'commands:\n  x:\n    permission: a.b;a.c\npermissions:\n  a.b: {}\n  a.c: {}\n');
  assert.deepEqual(codes(r), []);
});

test('keys inside a duplicated section are not reported again', () => {
  const r = validate(HEAD + 'commands:\n  a:\n    usage: /a\n  a:\n    usage: /a x\n');
  assert.deepEqual(codes(r), ['duplicate-key']);
});

test('pasted paper-plugin.yml is recognised without a file name', () => {
  const r = validate("name: P\nversion: '1'\nmain: a.B\nbootstrapper: a.Boot\napi-version: '1.21'\n");
  assert.equal(r.kind, 'paper');
});

test('anchor bomb does not hang', () => {
  let y = HEAD + 'x0: &a0 [v]\n';
  for (let i = 1; i <= 26; i++) y += `x${i}: &a${i} [*a${i - 1}, *a${i - 1}]\n`;
  y += 'depend: *a26\ncommands:\n  c:\n    aliases: *a26\n';
  const t = Date.now();
  validate(y);
  assert.ok(Date.now() - t < 3000);
});

test('very long permission chain does not throw', () => {
  let y = HEAD + 'permissions:\n';
  for (let i = 0; i < 20000; i++) y += `  p${i}:\n    children: [p${i + 1}]\n`;
  assert.doesNotThrow(() => validate(y));
});

test('large realistic file stays fast', () => {
  let y = HEAD + 'commands:\n';
  for (let i = 0; i < 2000; i++) y += `  cmd${i}:\n    aliases: [c${i}]\n    permission: x.cmd${i}\n`;
  y += 'permissions:\n';
  for (let i = 0; i < 2000; i++) y += `  x.cmd${i}:\n    default: op\n`;
  const t = Date.now();
  validate(y);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
});
