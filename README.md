# llms.txt generator

Generate an [`llms.txt`](https://llmstxt.org) for any website from its XML sitemap — plus an optional `llms-full.txt` with the main text of every page.

`llms.txt` is a plain Markdown file at the root of your site that tells language models what your site is and which pages matter, grouped by section. This tool builds it from the sitemap you already have, so it stays in sync as you publish.

- **Zero dependencies.** One file, Node 18+.
- **Works on any site** with an XML sitemap (including sitemap indexes and `.xml.gz`).
- **Skips** `noindex` pages and URLs on other hosts.
- **Runs as a CLI or a GitHub Action**, so you can regenerate on every deploy or every week.

## Quick start

```bash
npx github:ankursinghdev/llms-txt-generator --site https://www.example.com
```

That writes `llms.txt` in the current folder. Upload it to your site root so it is served at `https://www.example.com/llms.txt`.

## Example output

```markdown
# Acme Labs

> We build AI and software for enterprises.

## Services

- [AI Development Services](https://www.example.com/services/ai): Production AI systems.
- [Web Development](https://www.example.com/services/web): Fast websites.

## Case Studies

- [MedTech Case Study](https://www.example.com/case-studies/medtech): A healthcare platform.

## Blog

- [What is RAG? 2026 guide](https://www.example.com/blog/what-is-rag): Retrieval augmented generation explained.

## Optional

- [Privacy Policy](https://www.example.com/privacy): How we handle data.
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--site <url>` | required | Website root. The sitemap is found via `robots.txt`, then `/sitemap.xml`. |
| `--sitemap <url>` | discovered | Use a specific sitemap. |
| `--out <file>` | `llms.txt` | Output file; `-` prints to stdout. |
| `--full <file>` | off | Also write a full-text version, e.g. `llms-full.txt`. |
| `--name <text>` | `og:site_name` or home title | The H1. |
| `--summary <text>` | home meta description | The one-line summary. |
| `--order <list>` | by size | Section order, e.g. `services,case-studies,blog`. Blog-like sections go last by default. |
| `--optional <list>` | privacy, terms, careers… | Sections listed under `## Optional`. |
| `--exclude <regex>` | none | Skip matching URLs. |
| `--max-pages <n>` | 500 | Page limit. |
| `--concurrency <n>` | 4 | Parallel requests. |

Titles come from each page's `<title>` with the site name removed; descriptions come from the meta description.

## GitHub Action

Regenerate weekly and commit the result to your site's `public/` folder:

```yaml
name: Update llms.txt
on:
  schedule: [{ cron: '0 6 * * 1' }]
  workflow_dispatch: {}
permissions:
  contents: write
jobs:
  llms:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ankursinghdev/llms-txt-generator@v1
        with:
          site: https://www.example.com
          out: public/llms.txt
          full: public/llms-full.txt
          order: services,case-studies,blog
      - run: |
          git config user.name "llms-bot"
          git config user.email "llms-bot@users.noreply.github.com"
          git add public/llms.txt public/llms-full.txt
          git commit -m "Update llms.txt" || echo "No changes"
          git push
```

## Does llms.txt help AI visibility?

It is a proposed standard, not a ranking factor. No major AI provider has committed to reading it, so treat it as cheap insurance rather than a lever. It costs nothing, it documents your site structure clearly, and some AI tools and coding assistants already fetch it. The bigger wins for AI visibility are still clear page titles, direct answers near the top of pages, structured data, and being cited on sites AI tools trust.

## Development

```bash
npm test   # runs the generator against a local mock site
```

## Licence

MIT © Ankur ([@ankursinghdev](https://github.com/ankursinghdev))

---

Built and maintained by [Ankur](https://github.com/ankursinghdev). Used in production for [Ellocent Labs](https://www.ellocentlabs.com), an AI and enterprise software development company. Issues and pull requests welcome.
