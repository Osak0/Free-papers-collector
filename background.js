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

function generateMarkdown(data, tags, inlineTags, templateStr, pdfDownloaded) {
  const safeTitle = sanitizeFilename(data.title);
  const doiLink = data.doi ? `**DOI**: [${data.doi}](https://doi.org/${data.doi})` : '';
  const inlineTagsStr = (inlineTags && tags.length > 0) ? tags.map(t => `#${t}`).join(' ') : '';
  const authors = Array.isArray(data.authors) ? data.authors : [];
  const authorsWikilinks = authors.map(a => `[[${a}]]`).join(', ');
  const bibtex = generateBibtex(data);
  const pdfFilename = `${safeTitle}.pdf`;
  const pdfLink = pdfDownloaded ? `[[${pdfFilename}]]` : '';

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
    'bibtex': bibtex
  };

  let result = templateStr;
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, () => String(value));
  }

  return result;
}

function escapeYaml(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function markdownToDataUri(markdown) {
  const encoded = encodeURIComponent(markdown);
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
    pdfError: ''
  };

  if (!shouldDownloadPdf) {
    result.pdfDisabled = true;
  } else if (data.pdf_url) {
    try {
      await chrome.downloads.download({
        url: data.pdf_url,
        filename: pdfFilename,
        saveAs: false
      });
      result.pdfDownloaded = true;
    } catch (err) {
      result.pdfError = err.message || String(err);
      console.warn('PDF download failed:', err);
    }
  } else {
    result.pdfSkipped = true;
    console.warn('PDF download skipped: no PDF URL was extracted.');
  }

  const markdown = generateMarkdown(data, tags, inlineTags, config.markdownTemplate, result.pdfDownloaded);
  const mdUri = markdownToDataUri(markdown);

  await chrome.downloads.download({
    url: mdUri,
    filename: mdFilename,
    saveAs: false
  });

  if (chrome.notifications && chrome.notifications.create) {
    const title = chrome.i18n.getMessage('notifySavedTitle') || 'PaperOneStep';
    let message = chrome.i18n.getMessage('notifySavedMessage', [data.title || data.arxiv_id || filename]) || `Saved: ${data.title || data.arxiv_id || filename}`;
    if (result.pdfSkipped) {
      message += ` ${chrome.i18n.getMessage('notifyPdfSkipped') || 'PDF skipped: no PDF URL.'}`;
    } else if (result.pdfError) {
      message += ` ${chrome.i18n.getMessage('notifyPdfFailed') || 'PDF download failed.'}`;
    } else if (result.pdfDisabled) {
      message += ` ${chrome.i18n.getMessage('notifyPdfDisabled') || 'PDF not downloaded.'}`;
    }
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message
    });
  }

  return result;
}
const NOTE_SECTION_HEADING_RE = /^#{1,6}\s+Note\s*$/im;

function appendNoteSectionToMarkdown(markdown) {
  if (typeof markdown !== 'string' || NOTE_SECTION_HEADING_RE.test(markdown)) {
    return markdown;
  }

  return `${markdown.replace(/\s+$/, '')}\n\n---\n\n# Note\n\n{{note}}\n`;
}

async function migrateSavedMarkdownTemplateNoteSection() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }

  const { markdownTemplate } = await chrome.storage.local.get('markdownTemplate');
  if (typeof markdownTemplate !== 'string' || !markdownTemplate.trim()) {
    return;
  }

  const nextTemplate = appendNoteSectionToMarkdown(markdownTemplate);
  if (nextTemplate !== markdownTemplate) {
    await chrome.storage.local.set({ markdownTemplate: nextTemplate });
  }
}

function decodeMarkdownDataUrl(url) {
  const commaIndex = url.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }

  const metadata = url.slice(0, commaIndex);
  const payload = url.slice(commaIndex + 1);
  const isBase64 = /;base64/i.test(metadata);

  try {
    return {
      metadata,
      isBase64,
      markdown: isBase64 ? atob(payload) : decodeURIComponent(payload),
    };
  } catch (error) {
    console.warn('Failed to decode markdown download URL:', error);
    return null;
  }
}

function encodeMarkdownDataUrl({ metadata, isBase64, markdown }) {
  const payload = isBase64 ? btoa(markdown) : encodeURIComponent(markdown);
  return `${metadata},${payload}`;
}

function patchMarkdownDownloadNoteSection() {
  if (
    typeof chrome === 'undefined' ||
    !chrome.downloads?.download ||
    chrome.downloads.download.__paperOneStepNotePatch
  ) {
    return;
  }

  const originalDownload = chrome.downloads.download.bind(chrome.downloads);

  chrome.downloads.download = function downloadWithNoteSection(options, callback) {
    if (
      options?.url?.startsWith('data:text/markdown') &&
      !NOTE_SECTION_HEADING_RE.test(options.url)
    ) {
      const decoded = decodeMarkdownDataUrl(options.url);
      if (decoded) {
        const markdown = appendNoteSectionToMarkdown(decoded.markdown).replace('{{note}}', '');
        options = {
          ...options,
          url: encodeMarkdownDataUrl({ ...decoded, markdown }),
        };
      }
    }

    return originalDownload(options, callback);
  };

  chrome.downloads.download.__paperOneStepNotePatch = true;
}

migrateSavedMarkdownTemplateNoteSection().catch((error) => {
  console.warn('Failed to migrate markdown template note section:', error);
});
patchMarkdownDownloadNoteSection();
