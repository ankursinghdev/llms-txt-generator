// Tests llms-txt-generator against a small mock website.
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'index.mjs');
const PAGES = {
  '/': ['Acme Labs | Software Development Company', 'We build AI and software for enterprises.', '<meta property="og:site_name" content="Acme Labs">'],
  '/about': ['About Us | Acme Labs', 'Who we are.'],
  '/contact': ['Contact | Acme Labs', 'Talk to us.'],
  '/services/ai': ['AI Development Services | Acme Labs', 'Production AI systems.'],
  '/services/web': ['Web Development | Acme Labs', 'Fast websites.'],
  '/case-studies/medtech': ['MedTech Case Study | Acme Labs', 'A healthcare platform.'],
  '/blog/what-is-rag': ['What is RAG? [2026 guide] | Acme Labs', 'Retrieval augmented generation explained.'],
  '/blog/agents': ['AI Agents Explained | Acme Labs', ''],
  '/privacy': ['Privacy Policy | Acme Labs', 'How we handle data.'],
  '/hidden': ['Hidden | Acme Labs', 'x', '<meta name="robots" content="noindex">'],
};
const srv = http.createServer((req, res) => {
  const b = `http://127.0.0.1:${srv.address().port}`;
  const u = new URL(req.url, b);
  if (u.pathname === '/robots.txt') { res.writeHead(200); return res.end(`User-agent: *\nAllow: /\nSitemap: ${b}/sitemap_index.xml`); }
  if (u.pathname === '/sitemap_index.xml') { res.writeHead(200); return res.end(`<sitemapindex><sitemap><loc>${b}/s.xml</loc></sitemap></sitemapindex>`); }
  if (u.pathname === '/s.xml') {
    res.writeHead(200);
    return res.end(`<urlset>${Object.keys(PAGES).map((p) => `<url><loc>${b}${p}</loc></url>`).join('')}<url><loc>https://other.example.com/x</loc></url></urlset>`);
  }
  const p = PAGES[u.pathname.replace(/\/$/, '') || '/'];
  if (!p) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><head><title>${p[0]}</title><meta name="description" content="${p[1]}">${p[2] || ''}</head><body><header><nav>Menu</nav></header><main><h1>${p[0].split(' | ')[0]}</h1><p>Body of ${u.pathname}.</p></main><footer>Footer</footer></body></html>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const dir = await mkdtemp(path.join(tmpdir(), 'llms-'));
const out = path.join(dir, 'llms.txt');
const full = path.join(dir, 'llms-full.txt');
await run('node', [BIN, '--site', base, '--out', out, '--full', full, '--order', 'services,case-studies']);
const txt = await readFile(out, 'utf8');
const fullTxt = await readFile(full, 'utf8');
console.log(txt);

const pos = (s) => txt.indexOf(s);
const checks = [
  [txt.startsWith('# Acme Labs\n'), 'H1 uses og:site_name'],
  [/\n> We build AI and software for enterprises\.\n/.test(txt), 'summary blockquote from home description'],
  [pos('## Services') < pos('## Case Studies') && pos('## Case Studies') < pos('## Blog'), 'sections follow --order, blog last'],
  [/- \[AI Development Services\]\(http:\/\/127\.0\.0\.1:\d+\/services\/ai\): Production AI systems\./.test(txt), 'entries strip brand suffix and include description'],
  [/- \[What is RAG\? 2026 guide\]/.test(txt), 'square brackets removed from link text'],
  [/- \[AI Agents Explained\]\([^)]+\)\n/.test(txt), 'entry without description has no trailing colon'],
  [/## Pages\n\n- \[About Us\][\s\S]*- \[Contact\]/.test(txt), 'single top-level pages grouped under Pages'],
  [/## Optional\n\n- \[Privacy Policy\]/.test(txt), 'privacy under Optional'],
  [!/Hidden/.test(txt), 'noindex page skipped'],
  [!/other\.example\.com/.test(txt), 'other-host URLs skipped'],
  [/Source: .*\/services\/ai\n\nAI Development Services\nBody of \/services\/ai\./.test(fullTxt) && !/Menu|Footer/.test(fullTxt), 'llms-full.txt has main text without nav/footer'],
];
srv.close();
for (const [ok, m] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`);
if (checks.some(([ok]) => !ok)) assert.fail('llms-txt-generator test failed');
console.log(`\nALL ${checks.length} CHECKS PASSED`);
