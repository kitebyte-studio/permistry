// Generates the legal and contact pages into legal/. Run: node tools/build-pages.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const SITE = 'https://kitebytestudio.com/';
const EMAIL = 'kitebyte.studio@gmail.com';
const UPDATED = '14 November 2026';
const root = new URL('../', import.meta.url);

const PAGES = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    body: `
<p>These terms cover the Permistry website (${SITE}) and any paid products or services that Kitebyte sells through it. By using the site or buying from us you agree to them.</p>
<h2>The free checker</h2>
<p>The Permistry checker is free and open source under the MIT license. It runs entirely in your browser. It gives advice based on how Paper 26.3 reads plugin.yml files; other server versions and forks can behave differently. Use the results as guidance and test your plugin on your own server. The checker is provided as is, without any warranty.</p>
<h2>Paid products and services</h2>
<p>Paid products and services are described on their own page, with the price and what you get. Orders and payments are processed by <a href="https://www.creem.io">Creem</a>, which acts as the merchant of record: Creem is the seller for the purchase, handles payment, sales tax and VAT, and issues your receipt. Creem's own terms apply to the payment.</p>
<p>Digital products are delivered by download or email right after payment. For custom work, we agree on the scope in writing before you pay, and deliver within the time stated in the offer.</p>
<h2>Acceptable use</h2>
<p>Do not use the site or our products to break the law, to attack other people's servers, or to resell our paid products as your own. You keep all rights to the files you check and the plugins we build for you.</p>
<h2>Refunds</h2>
<p>See the <a href="refunds.html">refund policy</a>.</p>
<h2>Liability</h2>
<p>To the extent the law allows, Kitebyte is not liable for indirect damages such as lost revenue or server downtime. Our total liability for any purchase is limited to the amount you paid for it.</p>
<h2>Changes and contact</h2>
<p>We may update these terms. The date at the top shows the latest version. Questions: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    body: `
<p>Short version: the checker does not upload your files, we use no analytics and no cookies, and we only see the data you send us yourself.</p>
<h2>The checker</h2>
<p>Everything you paste or drop into Permistry, including plugin jars, is read and checked inside your browser. It is never sent to us or to anyone else.</p>
<h2>Hosting</h2>
<p>The site is hosted on GitHub Pages. GitHub may log technical data such as IP addresses when pages are requested; see the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub Privacy Statement</a>. We do not add analytics, tracking pixels or cookies.</p>
<h2>Purchases</h2>
<p>Payments are handled by <a href="https://www.creem.io">Creem</a>, our merchant of record. Creem collects the details needed to process the payment, such as your name, email, country and card data, under its own privacy policy. We receive your email address, the product you bought and the order details so we can deliver it and support you. We never see your full card number.</p>
<h2>Email</h2>
<p>If you email us, we keep the conversation to answer you and to deliver what you ordered. We do not add you to mailing lists and do not sell or share your data.</p>
<h2>Your rights</h2>
<p>You can ask us to show, correct or delete the data we hold about you: <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>`,
  },
  {
    slug: 'refunds',
    title: 'Refund Policy',
    body: `
<h2>Digital products</h2>
<p>If a digital product does not work as described and we cannot fix it, you get a full refund. Ask within 14 days of purchase.</p>
<h2>Custom work</h2>
<p>If we have not started the work yet, you can cancel for a full refund. If we cannot deliver what we agreed, or miss the agreed date and you do not want to wait, you get a full refund. Once you have accepted the delivered work, it is not refundable, but bug fixes for what we agreed stay free for 14 days.</p>
<h2>How to ask</h2>
<p>Email <a href="mailto:${EMAIL}">${EMAIL}</a> with your order number. Refunds are paid back by Creem to the original payment method, usually within 5 to 10 business days.</p>`,
  },
  {
    slug: 'contact',
    title: 'Contact',
    body: `
<p>Permistry is made by Kitebyte, a small studio that builds tools and plugins for Minecraft server developers.</p>
<p>Email: <a href="mailto:${EMAIL}">${EMAIL}</a><br>
Bugs and ideas for new checks: <a href="https://github.com/kitebyte-studio/permistry/issues">GitHub issues</a></p>
<p>We usually reply within one or two days.</p>`,
  },
];

const head = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Permistry by Kitebyte</title>
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
    <a href="../errors/">Server errors</a>
    <a href="../">Check a plugin.yml</a>
  </nav>
</header>`;

const foot = `<footer>
  <p>Permistry is made by Kitebyte. It is not affiliated with Mojang, Microsoft, PaperMC or SpigotMC.</p>
  <p><a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="refunds.html">Refunds</a> · <a href="contact.html">Contact</a></p>
</footer>
</body>
</html>
`;

mkdirSync(new URL('legal/', root), { recursive: true });
for (const p of PAGES) {
  const updated = p.slug === 'contact' ? '' : `<p class="crumb">Last updated: ${UPDATED}</p>`;
  writeFileSync(new URL(`legal/${p.slug}.html`, root), `${head(p.title)}
<main class="doc">
<h1>${p.title}</h1>
${updated}
${p.body.trim()}
</main>
${foot}`);
}
console.log(`${PAGES.length} pages`);
