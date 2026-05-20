# PaperOneStep

> One click to save academic papers as Obsidian-ready Markdown files with optional PDF downloads.

PaperOneStep is a vanilla JavaScript Chrome Manifest V3 extension for researchers who collect papers from the browser into an Obsidian vault. It extracts paper metadata, lets you review tags and venue information in a side panel, then saves a Markdown note and, when available, the PDF file.

## Features

- **Multi-site metadata extraction**: supports arXiv, OpenReview, Semantic Scholar, ACL Anthology, IEEE Xplore, Springer, Nature, Science, plus a meta-tag fallback for other pages.
- **Obsidian-ready Markdown**: generates YAML frontmatter, author links, abstract, DOI/PDF links, BibTeX, and optional inline tags.
- **PDF download support**: saves the PDF next to the Markdown note when a PDF URL is available; missing or failed PDF downloads do not block Markdown generation.
- **Semantic Scholar enrichment**: uses the public Semantic Scholar Graph API to enrich year, venue, citation count, and publication venue when DOI or arXiv ID is available.
- **Configurable workflow**: customize save subdirectory, filename rule, default tags, category-to-tag mappings, and the Markdown template.
- **Side panel UI**: uses Chrome's `sidePanel` API so the paper page remains visible while you edit metadata.
- **Light/dark mode and i18n**: native CSS dark mode and English/Simplified Chinese localization.

## Installation

1. Clone or download this repository.
2. Open Chrome or another Chromium browser and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Pin the extension if you want quick access.

## Configure Downloads

Chrome extensions cannot write to arbitrary absolute paths without a native host. PaperOneStep uses Chrome's download manager.

1. Open Chrome Settings -> Downloads.
2. Turn off **Ask where to save each file before downloading**.
3. Set the browser download location to your Obsidian vault root or paper folder.
4. In PaperOneStep settings, set the save subdirectory, for example `Papers/arxiv`.

Files are saved as:

```text
{browser_download_dir}/{saveSubdir}/{filename}.md
{browser_download_dir}/{saveSubdir}/{filename}.pdf
```

If no PDF URL is found, only the Markdown file is saved.

## Usage

1. Open a supported paper page, for example an arXiv abstract page or OpenReview forum page.
2. Click the PaperOneStep extension icon to open the side panel.
3. Review title, authors, year, venue, abstract, and tags.
4. Adjust tags or venue if needed.
5. Click **Save & Close**.

The extension saves your note and records recently used tags for future autocomplete.

## Settings

Open the extension options page to configure:

| Setting | Default | Description |
| --- | --- | --- |
| Save Directory | `Papers/arxiv` | Subdirectory under the browser download directory. |
| File Naming Rule | `{{safe_title}}` | Supports `{{safe_title}}`, `{{first_author}}`, and `{{year}}`. |
| Default Tags | `status/read` | Tags added to every saved paper. |
| Tag Mappings | Built in | Maps paper categories such as `cs.CL` to tags such as `nlp`. |
| Markdown Template | Built in | User-editable template using `{{variable}}` interpolation. |

Template variables include `title`, `authors`, `authors_wikilinks`, `year`, `venue`, `preprint_year`, `preprint_venue`, `published_year`, `published_venue`, `tags`, `inline_tags`, `safe_title`, `arxiv_id`, `doi`, `pdf_url`, `web_url`, `abstract`, `citation_count`, and `bibtex`.

## Project Structure

```text
paper_one_step/
├── manifest.json
├── background.js
├── content_script.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   └── i18n.js
├── options/
│   ├── options.html
│   ├── options.css
│   ├── options.js
│   └── i18n.js
├── _locales/
│   ├── en/messages.json
│   └── zh_CN/messages.json
└── icons/
```

## Development Notes

- This project is intentionally vanilla HTML/CSS/JS.
- There is no `package.json`, bundler, TypeScript, React, Tailwind, or build step.
- `background.js` runs as a Manifest V3 service worker. Use `data:text/markdown;charset=utf-8` URIs for generated Markdown downloads; `URL.createObjectURL()` is not available there.
- UI strings should use `data-i18n` or `data-i18n-placeholder`, and both locale files must be updated when text changes.

## Browser Support

- **Chrome and Chromium browsers**: primary supported target.
- **Firefox/Safari**: not actively supported in this codebase. Porting would require browser-specific manifest and sidebar changes.

## Privacy

PaperOneStep runs client-side. The only external API call is an anonymous request to Semantic Scholar when DOI or arXiv ID is available. No personal data, browsing history, or user account information is collected by this extension.

## License

MIT License. See [LICENSE](./LICENSE).
