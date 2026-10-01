#!/usr/bin/env node
// llms-txt-generator — build an llms.txt (and optional llms-full.txt) for any website from its XML sitemap.
// Format: https://llmstxt.org — H1 name, blockquote summary, then H2 sections of "- [Title](url): description".
// Zero dependencies. Node 18+. MIT licence. By Ankur (https://github.com/ankursinghdev).

import { writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const HELP = `Usage: llms-txt-generator --site https://example.com [options]

Options
  --site <url>          Website root (required). The sitemap is found via robots.txt or /sitemap.xml.
  --sitemap <url>       Use this sitemap instead of discovering one.
  --out <file>          Output file (default: llms.txt). Use "-" to print to stdout.
  --full <file>         Also write a full-text version (e.g. llms-full.txt).
  --name <text>         Site name for the H1 (default: og:site_name or the home page title).
  --summary <text>      One-line summary (default: the home page meta description).
  --order <list>        Comma-separated section order, e.g. "services,case-studies,blog".
  --optional <list>     Sections listed under "## Optional" (default: privacy,terms,legal,careers,jobs,tag,tags,author,category).
  --exclude <regex>     Skip URLs matching this regular expression.
  --max-pages <n>       Maximum pages to fetch (default 500).
  --concurrency <n>     Parallel requests (default 4).
  --user-agent <text>   User-Agent header.
  --help                Show this help.`;

// ---------- args ----------
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
  if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; }
}
if (!args.site) { console.error('Error: --site is required.\n\n' + HELP); process.exit(2); }
const site = args.site.replace(/\/+$/, '');
const out = args.out || 'llms.txt';
const maxPages = +(args['max-pages'] || 500);
const concurrency = +(args.concurrency || 4);
const ua = args['user-agent'] || 'llms-txt-generator/1.0 (+https://github.com/ankursinghdev/llms-txt-generator)';
const exclude = args.exclude ? new RegExp(args.exclude) : null;
const order = (args.order || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const optional = new Set((args.optional || 'privacy,privacy-policy,terms,terms-and-conditions,legal,careers,jobs,tag,tags,author,category,cookie-policy')
  .split(',').map((s) => s.trim().toLowerCase()));

// ---------- helpers ----------
async function get(url, { raw = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(20000) });
      return { status: r.status, body: raw ? Buffer.from(await r.arrayBuffer()) : await r.text(), url: r.url };
    } catch (e) {
      if (attempt === 1) return { status: 0, body: raw ? Buffer.alloc(0) : '', error: e.message };
    }
  }
}
async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}
const decode = (s) => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
function meta(html, key) {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1];
    if (name && name.toLowerCase() === key) return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '').trim();
  }
  return '';
}
const clean = (html) => html.replace(/<script(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
function pageInfo(html) {
  const h = clean(html);
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]).replace(/\s+/g, ' ').trim();
  const h1 = decode(((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1]).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const robots = meta(h, 'robots');
  const canonical = (h.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || h.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1] || '';
  return { title, h1, description: meta(h, 'description') || meta(h, 'og:description'), siteName: meta(h, 'og:site_name'), robots, canonical };
}
function fullText(html) {
  let h = clean(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<(header|nav|footer|aside)[\s>][\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) h = main[1];
  return decode(h.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
function stripBrand(title, name) {
  if (!name) return title;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*[|–—:-]\\s*${esc}\\s*$`, 'i'), '').replace(new RegExp(`^${esc}\\s*[|–—:-]\\s*`, 'i'), '').trim() || title;
}
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function readSitemap(url, depth = 0) {
  const r = await get(url, { raw: true });
  if (r.status !== 200) return [];
  let buf = r.body;
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const xml = buf.toString('utf8');
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  if (/<sitemapindex/i.test(xml)) {
    if (depth > 2) return [];
    const all = [];
    for (const l of locs.slice(0, 100)) all.push(...(await readSitemap(l, depth + 1)));
    return all;
  }
  return locs;
}

// ---------- main ----------
let maps = [];
if (args.sitemap) maps = [args.sitemap];
else {
  const robots = await get(site + '/robots.txt');
  if (robots.status === 200) maps = [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!maps.length) maps = [site + '/sitemap.xml'];
}
let urls = [];
for (const m of maps) urls.push(...(await readSitemap(m)));
const host = new URL(site).host.replace(/^www\./, '');
urls = [...new Set(urls)].filter((u) => { try { return new URL(u).host.replace(/^www\./, '') === host; } catch { return false; } });
if (exclude) urls = urls.filter((u) => !exclude.test(u));
if (!urls.length) { console.error(`No URLs found in sitemap(s): ${maps.join(', ')}`); process.exit(1); }
if (urls.length > maxPages) { console.error(`Note: ${urls.length} URLs found, using the first ${maxPages} (raise with --max-pages).`); urls = urls.slice(0, maxPages); }

const home = await get(site + '/');
const homeInfo = home.status === 200 ? pageInfo(home.body) : {};
const name = args.name || homeInfo.siteName || (homeInfo.title || host).split(/\s[|–—-]\s/)[0].trim();
const summary = args.summary || homeInfo.description || '';

const pages = (await pool(urls, concurrency, async (u) => {
  const r = await get(u);
  if (r.status !== 200) return null;
  const info = pageInfo(r.body);
  if (/noindex/i.test(info.robots)) return null;
  const path = new URL(u).pathname.replace(/\/+$/, '') || '/';
  return { url: u, path, ...info, text: args.full ? fullText(r.body) : '' };
})).filter(Boolean);

// Group by first path segment.
const groups = new Map();
for (const p of pages) {
  if (p.path === '/') continue;
  const seg = p.path.split('/').filter(Boolean)[0].toLowerCase();
  if (!groups.has(seg)) groups.set(seg, []);
  groups.get(seg).push(p);
}
const rank = (seg) => {
  const i = order.indexOf(seg);
  if (i >= 0) return i;
  if (/^(blog|blogs|news|insights|articles|posts|resources)$/.test(seg)) return 900;
  return 100;
};
const segs = [...groups.keys()].filter((s) => !optional.has(s))
  .sort((a, b) => rank(a) - rank(b) || groups.get(b).length - groups.get(a).length || a.localeCompare(b));
// Single top-level pages (e.g. /about, /contact) go together in one "Pages" section.
const singles = segs.filter((s) => groups.get(s).length === 1 && groups.get(s)[0].path.split('/').filter(Boolean).length === 1);
const multi = segs.filter((s) => !singles.includes(s));

const entry = (p) => {
  const t = stripBrand(p.title || p.h1 || p.path, name);
  const d = (p.description || '').replace(/\s+/g, ' ').trim();
  return `- [${t.replace(/[[\]]/g, '')}](${p.url})${d ? `: ${d}` : ''}`;
};
const lines = [`# ${name}`, ''];
if (summary) lines.push(`> ${summary.replace(/\s+/g, ' ')}`, '');
lines.push(`This file lists the pages on ${site} that are most useful to language models, grouped by section. Generated from the site's XML sitemap on ${new Date().toISOString().slice(0, 10)}.`, '');
if (singles.length) {
  lines.push('## Pages', '');
  for (const s of singles) lines.push(entry(groups.get(s)[0]));
  lines.push('');
}
for (const s of multi) {
  const list = groups.get(s).sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
  lines.push(`## ${titleCase(s)}`, '');
  for (const p of list) lines.push(entry(p));
  lines.push('');
}
const opt = [...groups.keys()].filter((s) => optional.has(s));
if (opt.length) {
  lines.push('## Optional', '');
  for (const s of opt) for (const p of groups.get(s)) lines.push(entry(p));
  lines.push('');
}
const txt = lines.join('\n').replace(/\n{3,}/g, '\n\n');
if (out === '-') process.stdout.write(txt);
else await writeFile(out, txt);

if (args.full) {
  const full = [`# ${name}`, '', summary ? `> ${summary}` : '', ''];
  for (const p of pages) full.push(`## ${stripBrand(p.title || p.path, name)}`, '', `Source: ${p.url}`, '', p.text, '');
  await writeFile(args.full, full.join('\n'));
}
console.error(`llms.txt: ${pages.length} pages in ${singles.length ? 1 : 0}+${multi.length} sections${opt.length ? ' + Optional' : ''} → ${out}${args.full ? ` and ${args.full}` : ''}`);
