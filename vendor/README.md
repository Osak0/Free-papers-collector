# Bundled reading dependencies

The extension still uses vanilla HTML/CSS/JavaScript and needs no build step.
Dependencies are shipped locally; no scripts, workers, fonts, or styles are loaded from a CDN.

| Dependency | Version | Included assets | License |
| --- | --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js/releases/tag/v5.6.205) | 5.6.205 | Display/core modules and packed character maps for text extraction | Apache-2.0; see `pdfjs/LICENSE` and `pdfjs/cmaps/LICENSE` |
| [KaTeX](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.1) | 0.19.1 | Browser renderer, auto-render helper, stylesheet and WOFF2 fonts | MIT; see `katex/LICENSE` |

PDF.js assets come from the `pdfjs-dist@5.6.205` npm distribution. PDF rendering,
image decoders, WebAssembly, and remote font loading are not used. Character maps
remain local so embedded CJK fonts can be decoded when the PDF supplies sufficient information.

KaTeX assets come from `https://registry.npmjs.org/katex/-/katex-0.19.1.tgz`.
The package integrity was checked against npm metadata:

```text
sha512-jG8uKntjSEcm2EpQOh0XturpPuuC9r3Sq5HLHdsFdWZT27E672SF19QEi+of0/YeOy15lDgRhKvr5614uRrEfA==
```

KaTeX runs with `trust: false` and `throwOnError: false`. Generated prose is inserted
with `textContent` before local math rendering. Model responses never become executable HTML.
Update each library's modules/assets and license together when changing its pinned version.
