const DEFAULT_SUBDIR = 'Papers/arxiv';
const DEFAULT_TEMPLATE = `---
title: "{{title}}"
author: "{{authors}}"
year: {{year}}
venue: "{{venue}}"
preprint_year: {{preprint_year}}
preprint_venue: "{{preprint_venue}}"
published_year: {{published_year}}
published_venue: "{{published_venue}}"
publication_status: "{{publication_status}}"
tags: [{{tags}}]
arxiv_id: "{{arxiv_id}}"
doi: "{{doi}}"
pdf: "{{pdf_link}}"
---

# {{title}}

**Authors**: {{authors_wikilinks}}
**Year**: {{latest_year}}
**Venue**: {{latest_venue}}
**URL**: [{{arxiv_id}}]({{web_url}})
**PDF**: {{pdf_link}}
{{doi_link}}

## Publication Timeline

{{publication_timeline}}

## Abstract

{{abstract}}

---

> [!tip]- Tags & Properties
> Modify tags via the **Properties** panel. Allowed characters: \`a-z\`, \`0-9\`, \`/\`, \`-\`, \`_\`.
> - Spaces are **not** allowed — use \`-\` instead (e.g. \`computer-vision\`).
> - Use \`/\` for nested hierarchy (e.g. \`nlp/transformer\`).
> - Do **not** prefix tags with \`#\` in the Properties panel.

{{inline_tags}}

## Note

{{note}}

{{reading_assistant}}

\`\`\`bibtex
{{bibtex}}
\`\`\`
`;

// Open side panel on action click (extension icon click)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
}

async function getConfig() {
  const result = await chrome.storage.local.get(['saveSubdir', 'filenameRule', 'defaultTags', 'markdownTemplate', 'downloadPdfByDefault']);
  return {
    saveSubdir: result.saveSubdir || DEFAULT_SUBDIR,
    filenameRule: result.filenameRule || '{{safe_title}}',
    defaultTags: result.defaultTags || ['status/read'],
    markdownTemplate: result.markdownTemplate || DEFAULT_TEMPLATE,
    downloadPdfByDefault: result.downloadPdfByDefault !== false
  };
}

function normalizeSaveSubdir(subdir) {
  const cleaned = (subdir || DEFAULT_SUBDIR).trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  const segments = cleaned.split('/').filter(Boolean);
  const isAbsolute = cleaned.startsWith('/') || /^[a-zA-Z]:\//.test(cleaned);
  const hasTraversal = segments.includes('..');

  if (isAbsolute || hasTraversal) {
    throw new Error(chrome.i18n.getMessage('extInvalidSavePath') || 'Save directory must be a relative path inside the browser download directory.');
  }

  return segments.join('/');
}

function getFilename(data, rule) {
  const safeTitle = sanitizeFilename(data.title);
  let firstAuthor = "Unknown";
  if (data.authors && data.authors.length > 0) {
    firstAuthor = sanitizeFilename(data.authors[0].split(' ').pop());
  }
  const year = data.year || 'YYYY';
  
  return (rule || '{{safe_title}}')
    .replace(/\{\{safe_title\}\}/g, safeTitle)
    .replace(/\{\{first_author\}\}/g, firstAuthor)
    .replace(/\{\{year\}\}/g, year);
}

function sanitizeFilename(title) {
  if (!title) return 'untitled';
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 150);
}

function generateBibtex(data) {
  let firstAuthorLast = "Unknown";
  if (data.authors && data.authors.length > 0) {
    firstAuthorLast = sanitizeFilename(data.authors[0].split(' ').pop());
  }
  const year = data.year || 'YYYY';
  const bibKey = `${firstAuthorLast}${year}${sanitizeFilename(data.title).substring(0, 10)}`;
  
  const authors = Array.isArray(data.authors) ? data.authors : [];
  let authorStr = authors.join(' and ');
  
  return `@article{${bibKey},
  title={${data.title}},
  author={${authorStr}},
  journal={${data.venue || 'arXiv preprint'}},
  year={${year}},
  url={${data.web_url}}
}`;
}

function formatPublicationTimeline(data) {
  const timeline = Array.isArray(data.publication_timeline) ? data.publication_timeline : [];
  if (timeline.length > 0) {
    return timeline.map(item => `- ${item}`).join('\n');
  }

  const fallback = [];
  if (data.preprint_year || data.preprint_venue) {
    fallback.push(`- ${[data.preprint_year, data.preprint_venue].filter(Boolean).join(' ')}`);
  }
  if (data.published_year || data.published_venue) {
    fallback.push(`- ${[data.published_venue, data.published_year].filter(Boolean).join(' ')}`);
  }
  return fallback.join('\n');
}

function generateMarkdown(data, tags, inlineTags, templateStr, pdfDownloaded, filename, pdfSource = '') {
  const safeTitle = sanitizeFilename(data.title);
  const doiLink = data.doi ? `**DOI**: [${data.doi}](https://doi.org/${data.doi})` : '';
  const inlineTagsStr = (inlineTags && tags.length > 0) ? tags.map(t => `#${t}`).join(' ') : '';
  const authors = Array.isArray(data.authors) ? data.authors : [];
  const authorsWikilinks = authors.map(a => `[[${a}]]`).join(', ');
  const bibtex = generateBibtex(data);
  const pdfFilename = `${filename || safeTitle}.pdf`;
  const pdfLink = pdfDownloaded ? `[[${pdfFilename}]]` : pdfSource ? `[PDF](<${pdfSource}>)` : '';

  const replacements = {
    'title': escapeYaml(data.title) || '',
    'authors': escapeYaml(authors.join(', ')) || '',
    'authors_wikilinks': authorsWikilinks,
    'year': data.year || '""',
    'venue': escapeYaml(data.venue) || '""',
    'latest_year': data.latest_year || data.year || '""',
    'latest_venue': escapeYaml(data.latest_venue || data.venue) || '""',
    'preprint_year': data.preprint_year || '""',
    'preprint_venue': escapeYaml(data.preprint_venue) || '""',
    'published_year': data.published_year || '""',
    'published_venue': escapeYaml(data.published_venue) || '""',
    'publication_status': data.publication_status || (data.published_venue || data.published_year ? 'published' : 'preprint'),
    'publication_timeline': formatPublicationTimeline(data),
    'tags': tags.join(', '),
    'arxiv_id': data.arxiv_id || '',
    'doi': data.doi || '',
    'pdf_url': data.pdf_url || '',
    'pdf_filename': pdfDownloaded ? pdfFilename : '',
    'pdf_link': pdfLink,
    'web_url': data.web_url || '',
    'abstract': data.abstract || '',
    'safe_title': safeTitle,
    'doi_link': doiLink,
    'inline_tags': inlineTagsStr,
    'citation_count': data.citationCount !== undefined ? data.citationCount : '""',
    'note': data.note || '',
    'reading_assistant': typeof data.reading_assistant === 'string' ? data.reading_assistant : '',
    'bibtex': bibtex
  };

  let result = templateStr.replace(/\{\{(\w+)\}\}/g, (token, key) =>
    Object.hasOwn(replacements, key) ? String(replacements[key]) : token);

  if (!templateStr.includes('{{note}}')) {
    const hasHeading = /^#{1,6}[ \t]+Note[ \t]*$/im.test(templateStr);
    if (!hasHeading || data.note) {
      result = `${result.trimEnd()}\n\n---\n\n${hasHeading ? '## Personal note' : '# Note'}\n\n${data.note || ''}\n`;
    }
  }

  // Existing user templates remain unchanged. Opted-in analyses get a separate section.
  if (replacements.reading_assistant && !templateStr.includes('{{reading_assistant}}')) {
    result = `${result.trimEnd()}\n\n${replacements.reading_assistant}\n`;
  }

  return result;
}

function escapeYaml(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function markdownToDataUri(markdown) {
  const encoded = encodeURIComponent(markdown.toWellFormed());
  return `data:text/markdown;charset=utf-8,${encoded}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'save') {
    handleSave(message.data, message.tags, message.inlineTags, message.options || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleSave(data, tags, inlineTags, options) {
  const config = await getConfig();
  const subdir = normalizeSaveSubdir(config.saveSubdir);
  const filename = getFilename(data, config.filenameRule);
  const shouldDownloadPdf = options.downloadPdf !== undefined ? options.downloadPdf : config.downloadPdfByDefault;

  const pdfFilename = `${subdir}/${filename}.pdf`;
  const mdFilename = `${subdir}/${filename}.md`;
  const result = {
    pdfDownloaded: false,
    pdfDisabled: false,
    pdfSkipped: false,
    pdfPending: false,
    pdfError: ''
  };
  let pdfSource = '';
  try {
    const url = new URL(data.pdf_url);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) pdfSource = url.href;
  } catch { /* Some papers provide no PDF URL. */ }
  let localPdfBase = filename;

  if (!shouldDownloadPdf) {
    result.pdfDisabled = true;
  } else if (pdfSource) {
    try {
      const id = await chrome.downloads.download({
        url: pdfSource,
        filename: pdfFilename,
        conflictAction: 'uniquify',
        saveAs: false
      });
      const download = await observeDownload(id, 1200);
      if (download?.state === 'interrupted') {
        result.pdfError = download.error || 'interrupted';
      } else if (download?.state === 'complete') {
        const finalName = download.filename?.split(/[\\/]/).pop();
        result.pdfDownloaded = Boolean(finalName && /\.pdf$/i.test(finalName) &&
          (!download.mime || /pdf|octet-stream/i.test(download.mime)));
        if (result.pdfDownloaded) localPdfBase = finalName.slice(0, -4);
        else result.pdfError = 'invalid PDF';
      } else {
        result.pdfPending = true;
      }
    } catch (err) {
      result.pdfError = err.message || String(err);
      console.warn('PDF download failed:', err);
    }
  } else {
    result.pdfSkipped = true;
    console.warn('PDF download skipped: no PDF URL was extracted.');
  }

  const markdown = generateMarkdown(data, tags, inlineTags, config.markdownTemplate, result.pdfDownloaded, localPdfBase,
    shouldDownloadPdf ? pdfSource : '');
  const mdUri = markdownToDataUri(markdown);

  const markdownId = await chrome.downloads.download({
    url: mdUri,
    filename: mdFilename,
    conflictAction: 'uniquify',
    saveAs: false
  });
  const note = await observeDownload(markdownId, 1600);
  if (note?.state === 'interrupted') throw new Error(chrome.i18n.getMessage('extNoteInterrupted'));
  result.markdownPending = note?.state !== 'complete';

  if (!result.markdownPending && chrome.notifications?.create) {
    const title = chrome.i18n.getMessage('notifySavedTitle') || 'PaperOneStep';
    let message = chrome.i18n.getMessage('notifySavedMessage', [data.title || data.arxiv_id || filename]) || `Saved: ${data.title || data.arxiv_id || filename}`;
    if (result.pdfSkipped) {
      message += ` ${chrome.i18n.getMessage('notifyPdfSkipped') || 'PDF skipped: no PDF URL.'}`;
    } else if (result.pdfError) {
      message += ` ${chrome.i18n.getMessage('notifyPdfFailed') || 'PDF download failed.'}`;
    } else if (result.pdfDisabled) {
      message += ` ${chrome.i18n.getMessage('notifyPdfDisabled') || 'PDF not downloaded.'}`;
    }
    Promise.resolve().then(() => chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message
    })).catch(error => console.warn('Notification failed:', error));
  }

  return result;
}

async function observeDownload(id, waitMs) {
  const deadline = Date.now() + waitMs;
  do {
    let item;
    try { [item] = await chrome.downloads.search({ id }); }
    catch { return null; }
    if (item?.state === 'complete' || item?.state === 'interrupted') return item;
    if (Date.now() >= deadline) return item;
    await new Promise(resolve => setTimeout(resolve, 120));
  } while (true);
}
