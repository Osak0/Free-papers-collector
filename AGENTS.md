# PaperOneStep Agent Instructions

This repository contains a vanilla JavaScript Chrome Manifest V3 extension that clips academic papers to Obsidian-ready Markdown.

## Architecture & Constraints
- **No Build Toolchain:** There is no `package.json`, Node.js environment, or bundler. Do not suggest or attempt to run `npm install`, add dependencies, or migrate to TypeScript/React. The project is strictly vanilla HTML/CSS/JS.
- **Side Panel UI:** The extension interface uses the `chrome.sidePanel` API rather than a traditional popup (`default_popup`). UI logic lives in `popup/popup.html` and `popup.js`, but it remains persistent alongside the web page.
- **Service Worker Quirks:** `background.js` runs as an MV3 Service Worker. The `URL.createObjectURL()` API is unavailable in this context. All generated files (like the Markdown note) must be encoded as `data:text/markdown;charset=utf-8` URIs to be passed to `chrome.downloads.download()`.

## Development Conventions
- **Styling:** CSS is written by hand in `popup/popup.css` and `options/options.css`. It uses utility-like class names (similar to Tailwind) but no PostCSS/Tailwind build step exists. 
- **Dark Mode:** Do not try to compile a dark theme. Dark mode is implemented natively via the `@media (prefers-color-scheme: dark)` media query directly in the CSS files.
- **i18n Localization:** HTML text is localized dynamically. Use the `data-i18n="key"` or `data-i18n-placeholder="key"` attributes instead of hardcoded strings. Always update both `_locales/en/messages.json` and `_locales/zh_CN/messages.json` when adding new text.
- **Markdown Templates:** The `generateMarkdown()` function in `background.js` does not use a template engine like Handlebars. It strictly uses simple string interpolation replacing `{{variable_name}}` matches from the user's `markdownTemplate` config in `chrome.storage.local`.

## Data Flow
- **Scraping:** `content_script.js` uses domain-specific parsers (e.g., `extractArxiv`, `extractOpenReview`, `extractSemanticScholar`) based on the hostname, with a meta-tag fallback for generic domains.
- **Storage:** Use `chrome.storage.local` extensively for syncing configuration across UI components and the background worker (`saveSubdir`, `defaultTags`, `tagMappings`, `historyTags`, `markdownTemplate`).
