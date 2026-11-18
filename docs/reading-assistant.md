# Reading assistant

The assistant extends PaperOneStep's existing paper-to-Obsidian workflow. It does not
require personal research data, a new application framework, a build process, or a hosted backend.
The existing collector continues working when analysis is disabled or unavailable.

## Reading workflow

| Direction | Intended output |
| --- | --- |
| Overview | Research question, main ideas, assumptions and limits of the supplied evidence |
| Topic screening | Relevance to a topic entered for the current paper, with editable reading priority and tags |
| Chinese quick-read card | A short Simplified Chinese card covering the question, approach, claimed contribution, findings and next reading step |
| Explain a passage | Step-by-step explanation of a selected or pasted passage or formula |
| Full-text Q&A | Direct answers based on relevant passages from loaded HTML or PDF text, with section anchors or PDF page numbers when available |
| Method | Inputs, outputs, steps, assumptions, intuition and applicability |
| Formula | Original formula, symbol meanings, supported derivation steps, intuition and an illustrative example |
| Experiments | Hypothesis, study design, controls/baselines, measurements and what the evidence actually supports |
| Prerequisites | Up to three relevant background concepts, their connection to the paper and self-check questions |
| Research verification | A small proposed test, required inputs/resources, controls, measurements and possible failure conditions |

No field, institution, model provider, research topic, dataset, or compute budget is assumed.
Screening and the quick-read card use the abstract when available. A screening topic is sent
only for the screening request and can be included in its cached result and Markdown export.
Full-text questions require loaded text and use a bounded selection of passages, including
matches for Chinese and English queries. The source preview shows what will be sent.
Examples, additional derivations, and research applications are labeled as background or proposals.

## Sources and evidence

- Start with the extracted abstract, load paper text, import a PDF, or supply a passage/formula.
- arXiv HTML is preferred when available. PDF text is a fallback. Other paper pages can use
  their available article text or extracted PDF URL. Access restrictions may require importing
  a PDF the user has already obtained.
- The selected-text action preserves MathML's LaTeX annotation/`alttext` when present.
  Pasted text is labeled as provided text, not independently matched paper evidence.
- Source passages preserve available section anchors or PDF page numbers. Imported PDFs
  include the selected filename in source labels; the user must confirm they match the displayed paper.
- Preview shows the actual passages selected for the request. Excerpt-only analysis is the default
  when text is supplied in the excerpt box. Otherwise a deterministic, mode/question-aware selection
  of the loaded text is sent, including a few passages for broader context.
- Model responses must be structured JSON. Paper-evidence sections require citations to existing
  passage IDs; invented or missing IDs reject the response. This checks reference identity, not
  the semantic truth of the model's interpretation. Users should inspect cited passages.
- Every output separates paper evidence, background explanation, proposals to validate,
  and information not established by the supplied text.

PDFs are limited to 25 MB and 120 pages; loaded documents to 240,000 characters;
each analysis to 24,000 source characters. Omitted/truncated content is indicated in the UI.
PDF extraction may lose formula symbols, figures, table structure or column order. There is
no built-in OCR or figure understanding. Use HTML, a supplied LaTeX formula, or recognized
text when extraction is incomplete. General background explanations are not a sourced literature search.

## Model setup and data

Configure a service supporting `POST /chat/completions` with `model` and `messages`, returning
`choices[0].message.content`. The response content must follow the JSON format specified in the request.
Either enter the full endpoint or a base URL including its API prefix. HTTPS is required;
localhost HTTP is allowed for local services. Keys are optional for services that do not require them.
Responses-only interfaces need a compatible gateway; no provider SDK is embedded.

Saving enabled settings requests only the model service origin entered by the user. Loading
a source can request that source origin. The optional host patterns support different providers
and publisher/CDN hosts; they are not all granted on installation.

Nothing is sent to the model until Analyze is clicked. Requests send selected source text,
paper title/authors/year/URL and the optional question; not the entire PDF file or vault.
Keys remain in local browser extension storage, are not encrypted by this extension, and are
not included in cache keys or saved Markdown. Model requests omit browser cookies and reject redirects.

The last ten completed analyses are cached locally by paper/revision, source content,
mode, question, language, endpoint/model and prompt version. Clear them in settings.
Full PDFs and loaded documents are held in panel memory. Cancellation and panel closure
abort pending local requests. Analysis has a 90-second timeout and paper fetches a 45-second timeout.
Changing tabs pauses work on the original paper and cancels pending analysis. Returning to
the original tab and URL restores the draft. To open a different paper in the collector,
refresh it from the banner. The collector asks before discarding unsaved edits.

## Saving and compatibility

The original Markdown/PDF download workflow, manual Note field, tags, settings and templates
remain in place. The optional `{{reading_assistant}}` variable controls output placement.
If a custom template omits it, an analysis is appended only when its include checkbox is checked.
Stored custom templates are not migrated for the new field. Without an included analysis, there
is no new analysis section. Existing files are exported through downloads, not edited in place.

Analysis export records its mode, model, time, source scope, paper version and cited passages.
User notes are never replaced by model output. LaTeX remains available for Obsidian's math renderer.
Custom filename rules now also determine the PDF filename referenced inside Markdown.
The collector opens with information from the page and enriches publication details in the
background. Manual year and venue edits take precedence. A failed Markdown save keeps the
form open. If a PDF was renamed, the note uses the completed download's actual filename.
If the PDF is interrupted or still downloading, the note keeps its online link.

## Implementation and verification

The original `manifest.json`, `content_script.js`, `background.js`, `popup/`, `options/`
and locale layout are retained. New code is isolated in `reading/`:

- `core.js`: configuration, paper identity, bounded context selection, validation and export.
- `extract.js`: shared DOM and selection extraction; preserves available TeX.
- `document.js`: HTML/PDF loading and local PDF text extraction.
- `model.js`: provider-neutral Chat Completions client and reading prompts.
- `ui.js`, `reading.css`, `settings.js`: optional side-panel reading and model configuration.

Long model requests run in the visible extension page, not in the download service worker.
No runtime framework was added. Bundled parser/math libraries and their licenses are documented
in [`vendor/README.md`](../vendor/README.md). Model output is inserted as text, then locally typeset
with KaTeX's trust option disabled. Model-supplied HTML is never executed in the extension.

Run core tests without installing dependencies:

```sh
node --test tests/reading.test.cjs
```

For optional browser QA, install Playwright separately in your development environment and
provide `CHROME_PATH` if using an installed Chrome executable. `PLAYWRIGHT_MODULE` can point
to an existing Playwright package; there is no production dependency on it.

```sh
node tests/browser-smoke.cjs
node tests/extension-smoke.cjs
```

The first uses a local mock model and synthetic paper data under an MV3-style CSP. The second
loads the actual unpacked extension in a new headless Chrome profile through the
`Extensions.loadUnpacked` debug API, tests native content scripts/PDF workers, and verifies
a real Markdown download. It requires a recent Chrome supporting that debug API. These scripts
never use the daily browser profile or a real model key. Artifacts stay in ignored `test-results/`.
`EXTENSION_ROOT` can point native QA at another local checkout of the same extension.

Manual release checks should also cover the browser's permission dialog, a real model provider,
representative publisher pages/PDFs, and whether explanations faithfully interpret the paper.
