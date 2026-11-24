# PaperOneStep

> One click to save academic papers as Obsidian-ready Markdown files with optional PDF downloads.

PaperOneStep is a vanilla JavaScript Chrome Manifest V3 extension for researchers who collect papers from the browser into an Obsidian vault. It extracts paper metadata, lets you review tags and venue information in a side panel, then saves a Markdown note and, when available, the PDF file.

## Features

- **Multi-site metadata extraction**: supports arXiv, OpenReview, Semantic Scholar, ACL Anthology, IEEE Xplore, ACM Digital Library, Springer, Nature, Science, plus a meta-tag fallback for other pages.
- **Obsidian-ready Markdown**: generates YAML frontmatter, author links, abstract, DOI/PDF links, a reading note section, BibTeX, and optional inline tags.
- **PDF download support**: saves the PDF next to the Markdown note when a PDF URL is available; PDF download is enabled by default but can be disabled per save.
- **Publication enrichment**: uses page metadata, arXiv comments, Semantic Scholar, and Crossref to show the latest known publication venue while preserving the preprint timeline.
- **Optional reading assistant**: explore methods, formulas, experiments, prerequisite knowledge, and research verification plans using a model service you configure. Analysis separates paper evidence, background explanations, and proposals, with links to the supplied source passages.
- **Paper text and formulas**: read available arXiv HTML, extract text from PDFs, import a local PDF, or focus on a selected/pasted passage. Math is rendered locally; scanned PDFs require separately recognized text.
- **Read this table**: choose two labeled rows from an HTML table, inspect their differences and open the source cells. Captions and notes accompany the comparison. This runs locally, including when AI is disabled.
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

Chrome extensions cannot write to arbitrary absolute paths through the downloads API. PaperOneStep uses Chrome's download manager, so the configured save directory is always a relative subfolder inside the browser download directory.

1. Open Chrome Settings -> Downloads.
2. Turn off **Ask where to save each file before downloading**.
3. Set the browser download location to your Obsidian vault root or paper folder.
4. In PaperOneStep settings, set the save subdirectory, for example `Papers/arxiv` or `Papers/Reading`.

Do not enter an absolute path such as `C:\Vault\Papers`, `/home/user/Vault`, or a path containing `..`. If you need direct writes to an arbitrary local folder in the future, that should be implemented as a separate File System Access API workflow.

Files are saved as:

```text
{browser_download_dir}/{saveSubdir}/{filename}.md
{browser_download_dir}/{saveSubdir}/{filename}.pdf
```

If PDF downloading is disabled for the current save, or no PDF URL is found, only the Markdown file is saved.

## Usage

1. Open a supported paper page, for example an arXiv abstract page or OpenReview forum page.
2. Click the PaperOneStep extension icon to open the side panel.
3. Review title, authors, year, venue, abstract, and tags.
4. Review the latest publication venue, timeline, tags, note, and the PDF download option.
5. Click **Save & Close**.

The extension saves your note and records recently used tags for future autocomplete.

## Optional AI Reading

Collection works without AI configuration. To enable reading analysis:

1. Open settings and enable **AI reading**.
2. Enter your model service's API base URL (including its API prefix, such as `/v1`), model ID, and API key if required. The service must support the Chat Completions request/response format. HTTPS is required except for localhost services.
3. Save settings and grant access to that service origin.
4. On a paper page, expand **Reading assistant**. Load paper text, import a PDF, use a selected passage, or paste text/LaTeX. When an excerpt is provided, the default is to send only that excerpt; uncheck the excerpt-only option to include selected paper context.
5. Choose an analysis direction, optionally ask a question, review the source passages, and click **Analyze**.
6. Follow citation buttons to the supplied text. Choose whether to include the analysis when using the existing **Save & Close** action.

Analysis is on demand and never runs automatically. Personal research profiles are not required.
The existing template, manual note, tags, PDF option, and download-directory workflow remain available.
Use `{{reading_assistant}}` to place the analysis in a custom Markdown template; if the variable
is absent, an opted-in analysis is appended as a separate section without changing the stored template.

Read [Reading assistant usage and development](docs/reading-assistant.md) for source handling,
limits, privacy, and verification steps.

## Settings

Open the extension options page to configure:

| Setting | Default | Description |
| --- | --- | --- |
| Save Directory | `Papers/arxiv` | Subdirectory under the browser download directory. |
| Download PDF by Default | enabled | Controls whether the side panel starts with PDF downloading enabled. |
| File Naming Rule | `{{safe_title}}` | Supports `{{safe_title}}`, `{{first_author}}`, and `{{year}}`. |
| Default Tags | `status/read` | Tags added to every saved paper. |
| Tag Mappings | Built in | Maps paper categories such as `cs.CL` to tags such as `nlp`. |
| Markdown Template | Built in | User-editable template using `{{variable}}` interpolation. |

Template variables include `title`, `authors`, `authors_wikilinks`, `year`, `venue`, `latest_year`, `latest_venue`, `preprint_year`, `preprint_venue`, `published_year`, `published_venue`, `publication_status`, `publication_timeline`, `tags`, `inline_tags`, `safe_title`, `arxiv_id`, `doi`, `pdf_url`, `pdf_filename`, `pdf_link`, `web_url`, `abstract`, `citation_count`, `note`, `reading_assistant`, and `bibtex`.

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
├── icons/
├── reading/      # Optional text extraction, model client, reading UI and settings
├── vendor/       # Local PDF.js/KaTeX assets and licenses; no CDN execution
├── tests/        # Node tests and optional isolated-browser QA
└── docs/
```

## Development Notes

- This project is intentionally vanilla HTML/CSS/JS.
- There is no `package.json`, bundler, TypeScript, React, Tailwind, or build step.
- `background.js` runs as a Manifest V3 service worker. Use `data:text/markdown;charset=utf-8` URIs for generated Markdown downloads; `URL.createObjectURL()` is not available there.
- UI strings should use `data-i18n` or `data-i18n-placeholder`, and both locale files must be updated when text changes.
- Run `node --test tests/reading.test.cjs` with Node.js 22+ for dependency-free regression checks. Browser QA is optional; see the reading assistant development guide. Node.js is not required to install or use the extension.

## Browser Support

- **Chrome and Chromium browsers**: primary supported target.
- **Firefox/Safari**: not actively supported in this codebase. Porting would require browser-specific manifest and sidebar changes.

## Privacy

PaperOneStep runs client-side. Publication enrichment requests paper identifiers from Semantic Scholar and Crossref. Loading paper text requests the chosen paper source. When you explicitly click **Analyze**, the selected source passages, paper metadata, and your question are sent to the model endpoint you configured. The extension does not automatically send your browsing history, local vault contents, or personal research profile.

Model credentials are stored in this browser profile's `chrome.storage.local`, not encrypted or synced by this extension. They are sent only to the configured model endpoint. Up to ten completed analyses (including their source excerpts) are cached locally and can be cleared in settings. PDFs are parsed locally, and PDF.js, KaTeX, workers, character maps, and fonts are bundled with the extension. The model provider's own data-handling policies apply to submitted analysis requests.

## License

MIT License. See [LICENSE](./LICENSE).
