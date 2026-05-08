# PaperOneStep

> One click to save academic papers as Obsidian-ready Markdown files with auto-downloaded PDFs.

PaperOneStep is a Chrome extension that clips academic paper pages into clean Markdown files — complete with YAML frontmatter, metadata tables, auto-generated tags, and a local PDF copy. Designed specifically for the **Obsidian + browser** research workflow.

## Features

- **Universal Support** — Works on arXiv, OpenReview, Semantic Scholar, ACL Anthology, IEEE Xplore, Springer, Nature, Science, and falls back to generic meta-tag parsing for other domains.
- **Smart Metadata Enrichment** — Automatically queries the Semantic Scholar Graph API in the background to separate *preprint* dates/venues from actual *published* dates/venues.
- **Auto PDF Download** — PDF saved alongside the Markdown file, linked via Obsidian wikilink (`[[title.pdf]]`).
- **Obsidian Properties Ready** — All metadata stored in YAML frontmatter, editable via Obsidian's Properties GUI panel.
- **Customizable Markdown Templates** — Use variables like `{{title}}`, `{{authors}}`, `{{year}}`, `{{venue}}`, `{{abstract}}`, `{{bibtex}}` and more to format your notes exactly how you want.
- **Configurable Naming & Paths** — Set file naming rules (e.g. `{{first_author}}_{{year}}_{{safe_title}}`) and target subdirectories relative to your browser's download folder.
- **Smart Tags & Autocomplete** — Auto-generates tags based on conference names (e.g., `conf/neurips2024`) and arXiv categories (`cs.CL` → `nlp`). Remembers your historical tags for quick auto-completion.
- **Side Panel UI & Dark Mode** — Clean, distraction-free side panel interface matching Obsidian's native dark/light themes.
- **Multilingual** — Full support for English and Simplified Chinese (i18n).

## Installation

### From Source (Developer Mode)

1. Clone or download this repository.
2. Open Chrome (or Edge/Brave/Vivaldi) and navigate to `chrome://extensions/` (or equivalent).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `paper_one_step/` folder.
5. Pin the extension to your toolbar. Clicking the icon will instantly open the Side Panel.

### Configure Downloads (Crucial for Obsidian)

PaperOneStep uses Chrome's built-in download manager. To save files directly into your Obsidian vault:

1. Open **Chrome Settings** → **Downloads**.
2. **Crucial:** Turn *OFF* "Ask where to save each file before downloading", otherwise you'll get two save prompts (one for MD, one for PDF) for every paper.
3. Set your browser's Default Download Location to your Obsidian vault's root or paper folder (e.g., `/Users/you/Vault`).
4. In the extension **Settings**, set the subdirectory (e.g., `Papers/arxiv`).

Files will be saved as `{download_dir}/{subdir}/{filename}.md` and `{download_dir}/{subdir}/{filename}.pdf`.

## Usage

1. Open any supported paper page (e.g., an arXiv abstract, OpenReview forum, or ACL Anthology page).
2. Click the **PaperOneStep** extension icon to open the Side Panel.
3. Review and edit the extracted metadata:
   - The primary inputs show the original (preprint) info by default.
   - If a formal publication is found via Semantic Scholar, it's displayed as a timeline hint and automatically added to your tags (e.g. `conf/iclr`).
   - Add/remove tags (using the autocomplete history).
4. Click **Save Settings**. Both the `.md` and `.pdf` files will download automatically.

## Configuration & Customization

Right-click the extension icon and click **Options** (or click the Settings gear in the Side Panel) to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| **Save Directory** | `Papers/arxiv` | Relative path inside the browser download directory. |
| **File Naming Rule** | `{{safe_title}}` | Available variables: `{{safe_title}}`, `{{first_author}}`, `{{year}}` |
| **Default Tags** | `status/read` | Comma-separated tags added to every saved paper. |
| **Tag Mappings** | (built-in) | Rules to map arXiv/generic categories to specific tags (e.g., `cs.CV` → `cv`). |
| **Markdown Template** | (built-in Obsidian style) | Completely customize the structure and frontmatter of your generated markdown. |

### Available Template Variables

- `{{title}}`
- `{{authors}}` (Comma-separated string)
- `{{authors_wikilinks}}` (Obsidian wikilinks: `[[Author One]], [[Author Two]]`)
- `{{year}}`, `{{venue}}` (Best available, favors published over preprint)
- `{{preprint_year}}`, `{{preprint_venue}}`
- `{{published_year}}`, `{{published_venue}}`
- `{{abstract}}`
- `{{tags}}` (For YAML frontmatter arrays)
- `{{inline_tags}}` (For inline `#tag/format` display)
- `{{safe_title}}` (Used for PDF linking)
- `{{arxiv_id}}`, `{{doi}}`, `{{pdf_url}}`, `{{web_url}}`
- `{{citation_count}}`
- `{{bibtex}}`

## Tag Format Rules for Obsidian

Tags in Obsidian follow specific rules. PaperOneStep auto-generates compliant tags, but keep these in mind when adding custom tags:

- **No spaces** — use `-` (e.g., `computer-vision`).
- **Nest with `/`** (e.g., `nlp/transformer`).
- **No `#` prefix** needed in the extension UI. We handle formatting it for the YAML array automatically.

## Privacy & Data

PaperOneStep is entirely client-side. The only external network request it makes is an anonymous GET request to the `api.semanticscholar.org` Graph API to retrieve formal publication venues and citation counts based on the ArXiv ID or DOI. No personal data, browsing history, or user information is collected or transmitted.

## Project Architecture

- Vanilla HTML/CSS/JS (Manifest V3)
- No build tools, no bundlers, no external dependencies.
- `content_script.js`: DOM scraping & parsing based on hostname.
- `background.js`: Service worker for API intercept, Markdown/BibTeX generation, and triggering `chrome.downloads`.
- `popup/` & `options/`: Pure, responsive, Obsidian-styled UI elements supporting native dark mode.

## Browser Support

- **Google Chrome / Chromium Browsers**: Fully supported (utilizes the `chrome.sidePanel` API).
- **Firefox**: Manifest V3 is supported, but requires `sidebar_action` instead of `sidePanel`. Minor modifications to `manifest.json` and background UI triggers are required to port.
- **Safari**: Requires macOS and Xcode. Use Apple's converter tool: `xcrun safari-web-extension-converter ./paper_one_step`.

## License

MIT License — see [LICENSE](./LICENSE) file for details.
