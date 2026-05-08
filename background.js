const DEFAULT_SUBDIR = 'Papers/arxiv';
const DEFAULT_TEMPLATE = `---
title: "{{title}}"
author: "{{authors}}"
year: {{year}}
venue: "{{venue}}"
tags: [{{tags}}]
arxiv_id: "{{arxiv_id}}"
doi: "{{doi}}"
pdf: "[[{{safe_title}}.pdf]]"
notes: ""
---

# {{title}}

**Authors**: {{authors_wikilinks}}
**Year**: {{year}}
**Venue**: {{venue}}
**URL**: [{{arxiv_id}}]({{web_url}})
**PDF**: [[{{safe_title}}.pdf]]
{{doi_link}}

## Abstract

{{abstract}}

---

> [!tip]- Tags & Properties
> Modify tags via the **Properties** panel. Allowed characters: \`a-z\`, \`0-9\`, \`/\`, \`-\`, \`_\`.
> - Spaces are **not** allowed — use \`-\` instead (e.g. \`computer-vision\`).
> - Use \`/\` for nested hierarchy (e.g. \`nlp/transformer\`).
> - Do **not** prefix tags with \`#\` in the Properties panel.

{{inline_tags}}

\`\`\`bibtex
{{bibtex}}
\`\`\`
`;

// Open side panel on action click (extension icon click)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
}

async function getConfig() {
  const result = await chrome.storage.local.get(['saveSubdir', 'filenameRule', 'defaultTags', 'markdownTemplate']);
  return {
    saveSubdir: result.saveSubdir || DEFAULT_SUBDIR,
    filenameRule: result.filenameRule || '{{safe_title}}',
    defaultTags: result.defaultTags || ['status/read'],
    markdownTemplate: result.markdownTemplate || DEFAULT_TEMPLATE
  };
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
  
  let authorStr = data.authors ? data.authors.join(' and ') : '';
  
  return `@article{${bibKey},
  title={${data.title}},
  author={${authorStr}},
  journal={${data.venue || 'arXiv preprint'}},
  year={${year}},
  url={${data.web_url}}
}`;
}

function generateMarkdown(data, tags, inlineTags, templateStr) {
  const safeTitle = sanitizeFilename(data.title);
  const doiLink = data.doi ? `**DOI**: [${data.doi}](https://doi.org/${data.doi})` : '';
  const inlineTagsStr = (inlineTags && tags.length > 0) ? tags.map(t => `#${t}`).join(' ') : '';
  const authorsWikilinks = data.authors ? data.authors.map(a => `[[${a}]]`).join(', ') : '';
  const bibtex = generateBibtex(data);

  const replacements = {
    'title': escapeYaml(data.title) || '',
    'authors': escapeYaml(data.authors.join(', ')) || '',
    'authors_wikilinks': authorsWikilinks,
    'year': data.year || '""',
    'venue': escapeYaml(data.venue) || '""',
    'preprint_year': data.preprint_year || '""',
    'preprint_venue': escapeYaml(data.preprint_venue) || '""',
    'published_year': data.published_year || '""',
    'published_venue': escapeYaml(data.published_venue) || '""',
    'tags': tags.join(', '),
    'arxiv_id': data.arxiv_id || '',
    'doi': data.doi || '',
    'pdf_url': data.pdf_url || '',
    'web_url': data.web_url || '',
    'abstract': data.abstract || '',
    'safe_title': safeTitle,
    'doi_link': doiLink,
    'inline_tags': inlineTagsStr,
    'citation_count': data.citationCount !== undefined ? data.citationCount : '""',
    'bibtex': bibtex
  };

  let result = templateStr;
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
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
    handleSave(message.data, message.tags, message.inlineTags)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleSave(data, tags, inlineTags) {
  const config = await getConfig();
  const subdir = config.saveSubdir.replace(/\/+$/, '');
  const filename = getFilename(data, config.filenameRule);

  const pdfFilename = `${subdir}/${filename}.pdf`;
  const mdFilename = `${subdir}/${filename}.md`;

  try {
    await chrome.downloads.download({
      url: data.pdf_url,
      filename: pdfFilename,
      saveAs: false
    });
  } catch (err) {
    console.warn('PDF download failed:', err);
  }

  const markdown = generateMarkdown(data, tags, inlineTags, config.markdownTemplate);
  const mdUri = markdownToDataUri(markdown);

  await chrome.downloads.download({
    url: mdUri,
    filename: mdFilename,
    saveAs: false
  });

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'PaperOneStep',
    message: `Saved: ${data.title || data.arxiv_id}`
  });
}
