// Generates errors/<slug>.html, errors/index.html and sitemap.xml from errors-data.mjs.
// Run: node tools/build-errors.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { ERRORS } from './errors-data.mjs';

const SITE = 'https://kitebytestudio.com/';
const root = new URL('../', import.meta.url);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const plain = (s) => s.replace(/`/g, '');

function page({ title, description, canonical, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="../assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../assets/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="../" aria-label="Permistry home">
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 6 13h10z" fill="#FF8C42"/><path d="M16 2l10 11H16z" fill="#2EC4B6"/><path d="M6 13l10 15V13z" fill="#2EC4B6"/><path d="M26 13 16 28V13z" fill="#FF8C42"/><path d="M16 28c-1 2 1 2 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
    <span>Permistry</span>
  </a>
  <nav>
    <a href="./">Server errors</a>
    <a href="../">Check a plugin.yml</a>
  </nav>
</header>
<main class="doc">
${body}
</main>
<footer>
  <p>Permistry is made by Kitebyte. It is not affiliated with Mojang, Microsoft, PaperMC or SpigotMC.</p>
  <p>Every error on this site was reproduced on Paper 26.3 (build 249). <a href="https://github.com/kitebyte-studio/permistry/blob/main/docs/paper-behaviour.md">Test results</a>.</p>
  <p><a href="../legal/terms.html">Terms</a> · <a href="../legal/privacy.html">Privacy</a> · <a href="../legal/refunds.html">Refunds</a> · <a href="../legal/contact.html">Contact</a> · <a href="mailto:support@kitebytestudio.com">support@kitebytestudio.com</a></p>
</footer>
</body>
</html>
`;
}

mkdirSync(new URL('errors/', root), { recursive: true });

for (const e of ERRORS) {
  const body = `
<p class="crumb"><a href="./">Paper and Spigot plugin.yml errors</a></p>
<h1>${inline(e.title)}</h1>
<div class="server"><span>Server log</span><pre>${esc(e.log)}</pre></div>
<h2>What it means</h2>
<p>${inline(e.what)}</p>
<h2>What causes it</h2>
<p>${inline(e.cause)}</p>
<h2>How to fix it</h2>
<div class="compare">
  <div><p class="label bad">Before</p><pre>${esc(e.bad)}</pre></div>
  <div><p class="label good">After</p><pre>${esc(e.good)}</pre></div>
</div>
${e.notes ? `<p>${inline(e.notes)}</p>` : ''}
<div class="cta">
  <p><strong>Check the whole file.</strong> Paste your plugin.yml or drop the plugin jar into Permistry. It finds this and about 40 other problems, and explains each one in plain words. It runs in your browser and nothing is uploaded.</p>
  <a class="button" href="../">Open the checker</a>
</div>
`;
  const description = plain(`${e.what}`).slice(0, 155);
  writeFileSync(new URL(`errors/${e.slug}.html`, root), page({
    title: `${plain(e.title).replace(/"/g, '')} | plugin.yml fix`,
    description,
    canonical: `${SITE}errors/${e.slug}.html`,
    body,
  }));
}

const list = ERRORS.map((e) => `  <li><a href="${e.slug}.html">${inline(e.title)}</a><p>${inline(e.cause)}</p></li>`).join('\n');
writeFileSync(new URL('errors/index.html', root), page({
  title: 'Paper and Spigot plugin.yml errors explained',
  description: 'What each plugin.yml error in a Paper or Spigot server log means and how to fix it. Every message was reproduced on a real Paper 26.3 server.',
  canonical: `${SITE}errors/`,
  body: `
<h1>Paper and Spigot plugin.yml errors, explained</h1>
<p class="lead">Each message below was printed by a real Paper 26.3 server while loading a test plugin with one mistake in its plugin.yml. Find the line from your log, see what causes it and how to fix it.</p>
<ul class="error-list">
${list}
</ul>
`,
}));

const urls = ['', 'errors/', ...ERRORS.map((e) => `errors/${e.slug}.html`), 'legal/terms.html', 'legal/privacy.html', 'legal/refunds.html', 'legal/contact.html'];
writeFileSync(new URL('sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`${ERRORS.length} error pages`);
