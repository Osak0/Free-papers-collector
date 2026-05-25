let paperData = null;
let tagsSet = new Set();

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const formEl = document.getElementById('form');
const titleEl = document.getElementById('title');
const authorsEl = document.getElementById('authors');
const yearEl = document.getElementById('year');
const venueEl = document.getElementById('venue');
const publicationStatusEl = document.getElementById('publicationStatus');
const publicationSummaryEl = document.getElementById('publicationSummary');
const publicationTimelineEl = document.getElementById('publicationTimeline');
const tagsContainer = document.getElementById('tagsContainer');
const tagInput = document.getElementById('tagInput');
const noteInput = document.getElementById('noteInput');
const abstractToggle = document.getElementById('abstractToggle');
const abstractContent = document.getElementById('abstractContent');
const inlineTagsCheckbox = document.getElementById('inlineTagsCheckbox');
const downloadPdfCheckbox = document.getElementById('downloadPdfCheckbox');
const pathCard = document.getElementById('pathCard');
const pathDir = document.getElementById('pathDir');
const pathFiles = document.getElementById('pathFiles');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');

function sanitizeFilename(title) {
  if (!title) return 'untitled';
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 150);
}

function showError(msg) {
  loadingEl.classList.add('hidden');
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  formEl.classList.add('hidden');
  pathCard.classList.add('hidden');
}

function renderTags() {
  tagsContainer.innerHTML = '';
  for (const tag of tagsSet) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(tag)}<span class="tag-chip-remove" data-tag="${escapeHtml(tag)}">&times;</span>`;
    tagsContainer.appendChild(chip);
  }
  document.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTag(btn.dataset.tag);
    });
  });
}

function renderPublication(data) {
  const status = data.publication_status || 'preprint';
  publicationStatusEl.textContent = status === 'published'
    ? (chrome.i18n.getMessage('extPublished') || 'Published')
    : (chrome.i18n.getMessage('extPreprint') || 'Preprint');
  publicationStatusEl.classList.toggle('published', status === 'published');
  publicationSummaryEl.textContent = [data.latest_year || data.year, data.latest_venue || data.venue]
    .filter(Boolean)
    .join(' / ');

  const timeline = Array.isArray(data.publication_timeline) ? data.publication_timeline : buildPublicationTimeline(data);
  publicationTimelineEl.innerHTML = '';
  for (const item of timeline) {
    const node = document.createElement('div');
    node.className = 'timeline-item';
    node.textContent = item;
    publicationTimelineEl.appendChild(node);
  }
}

function addTag(tag) {
  const trimmed = tag.trim();
  if (!trimmed) return;
  if (tagsSet.has(trimmed)) return;
  tagsSet.add(trimmed);
  renderTags();
}

function removeTag(tag) {
  tagsSet.delete(tag);
  renderTags();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getBestVenue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || '';
}

function firstDateParts(parts) {
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return {};
  const [year, month, day] = parts[0];
  return {
    year,
    date: [year, month, day].filter(Boolean).join('-')
  };
}

function buildPublicationTimeline(data) {
  const timeline = [];
  if (data.preprint_year || data.arxiv_submitted_date) {
    timeline.push(`${data.preprint_year || data.arxiv_submitted_date} arXiv preprint`);
  }
  if (data.arxiv_version || data.arxiv_revision_date) {
    timeline.push([data.arxiv_revision_date, data.arxiv_version].filter(Boolean).join(' arXiv '));
  }
  if (data.published_venue || data.published_year) {
    timeline.push([data.published_venue, data.published_year].filter(Boolean).join(' '));
  }
  return timeline;
}

function applyLatestPublication(data) {
  const hasPublished = Boolean(data.published_venue || data.published_year);
  data.publication_status = hasPublished ? 'published' : 'preprint';
  data.latest_year = hasPublished ? (data.published_year || data.year) : (data.preprint_year || data.year);
  data.latest_venue = hasPublished ? (data.published_venue || data.venue) : (data.preprint_venue || data.venue || 'arXiv preprint');
  data.year = data.latest_year || data.year;
  data.venue = data.latest_venue || data.venue;
  data.publication_timeline = buildPublicationTimeline(data);
  return data;
}

async function enrichWithCrossref(data) {
  if (!data.doi || data.published_venue) return data;

  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(data.doi)}`);
    if (!res.ok) return data;

    const item = (await res.json()).message;
    if (!item) return data;

    const dateParts = firstDateParts(
      item['published-print']?.['date-parts'] ||
      item['published-online']?.['date-parts'] ||
      item.issued?.['date-parts']
    );
    const venue = Array.isArray(item['container-title']) ? item['container-title'][0] : '';

    if (venue) data.published_venue = venue;
    if (dateParts.year) data.published_year = dateParts.year;
    if (dateParts.date) data.published_date = dateParts.date;
  } catch (err) {
    console.warn('Crossref API failed:', err);
  }

  return data;
}

async function enrichWithS2(data) {
  let query = null;
  if (data.doi) query = `DOI:${data.doi}`;
  else if (data.arxiv_id) query = `ArXiv:${data.arxiv_id}`;
  
  if (!query) return applyLatestPublication(data);
  
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${query}?fields=venue,year,publicationDate,citationCount,authors,publicationVenue,publicationTypes,externalIds`;
    const res = await fetch(url);
    if (res.ok) {
      const s2Data = await res.json();
      
      // Preserve original as preprint info
      data.preprint_year = data.preprint_year || data.year;
      data.preprint_venue = data.preprint_venue || data.venue;
      
      // S2 data as published info
      if (!data.published_venue && (s2Data.venue || s2Data.publicationVenue)) {
        data.published_venue = s2Data.venue || getBestVenue(s2Data.publicationVenue);
      }
      if (!data.published_year && s2Data.year) {
        data.published_year = s2Data.year;
      }
      if (!data.published_date && s2Data.publicationDate) {
        data.published_date = s2Data.publicationDate;
      }
      const externalIds = s2Data.externalIds && typeof s2Data.externalIds === 'object'
        ? s2Data.externalIds
        : {};
      const s2Doi = externalIds.DOI || externalIds.Doi || externalIds.doi;
      if (!data.doi && s2Doi) {
        data.doi = s2Doi;
      }
      if (s2Data.citationCount !== undefined) {
        data.citationCount = s2Data.citationCount;
      }
    }
  } catch (err) {
    console.warn("Semantic Scholar API failed:", err);
    data.preprint_year = data.year;
    data.preprint_venue = data.venue;
  }
  await enrichWithCrossref(data);
  return applyLatestPublication(data);
}

function getFilename(data, rule) {
  const safeTitle = sanitizeFilename(data.title);
  let firstAuthor = "Unknown";
  if (data.authors && data.authors.length > 0) {
    firstAuthor = sanitizeFilename(data.authors[0].split(' ').pop()); // Last word of first author
  }
  const year = data.year || 'YYYY';
  
  let filename = (rule || '{{safe_title}}')
    .replace(/\{\{safe_title\}\}/g, safeTitle)
    .replace(/\{\{first_author\}\}/g, firstAuthor)
    .replace(/\{\{year\}\}/g, year);
    
  return filename;
}

function normalizeSubdirForPreview(subdir) {
  return (subdir || 'Papers/arxiv').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function updatePathCard(data, subdir, filenameRule, downloadPdf) {
  const filename = getFilename(data, filenameRule);
  const cleaned = normalizeSubdirForPreview(subdir);
  pathDir.textContent = (cleaned ? cleaned + '/' : '');
  const pdfLine = downloadPdf && data.pdf_url
    ? `<span class="ext-pdf">${filename}.pdf</span>`
    : `<span class="ext-pdf muted">${chrome.i18n.getMessage('extPdfNotSaved') || 'PDF will not be saved'}</span>`;
  pathFiles.innerHTML = `
    <span class="ext-md">${filename}.md</span>
    ${pdfLine}`;
}

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = '';
  }
});

downloadPdfCheckbox.addEventListener('change', () => {
  if (!paperData) return;
  chrome.storage.local.get(['saveSubdir', 'filenameRule']).then(config => {
    updatePathCard(paperData, config.saveSubdir || 'Papers/arxiv', config.filenameRule || '{{safe_title}}', downloadPdfCheckbox.checked);
  });
});

abstractToggle.addEventListener('click', () => {
  const isHidden = abstractContent.classList.contains('hidden');
  abstractContent.classList.toggle('hidden');
  abstractToggle.classList.toggle('open', !isHidden);
});

cancelBtn.addEventListener('click', () => window.close());

saveBtn.addEventListener('click', async () => {
  if (!paperData) return;
  saveBtn.disabled = true;
  saveBtn.textContent = chrome.i18n.getMessage('extSaving') || 'Saving...';

  const tags = Array.from(tagsSet);
  const updatedData = {
    ...paperData,
    year: parseInt(yearEl.value, 10) || paperData.year,
    venue: venueEl.value.trim() || paperData.venue,
    latest_year: parseInt(yearEl.value, 10) || paperData.latest_year || paperData.year,
    latest_venue: venueEl.value.trim() || paperData.latest_venue || paperData.venue,
    note: noteInput.value.trim()
  };

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'save',
      data: updatedData,
      tags: tags,
      inlineTags: inlineTagsCheckbox.checked,
      options: {
        downloadPdf: downloadPdfCheckbox.checked
      }
    });
    if (!response || !response.success) {
      throw new Error(response && response.error ? response.error : (chrome.i18n.getMessage('extSaveFailed') || 'Save failed.'));
    }
    if (response.pdfSkipped || response.pdfError || response.pdfDisabled) {
      console.warn(response.pdfDisabled
        ? (chrome.i18n.getMessage('extPdfDisabled') || 'Markdown saved without downloading the PDF.')
        : response.pdfSkipped
        ? (chrome.i18n.getMessage('extPdfSkipped') || 'Markdown saved, but no PDF URL was found.')
        : (chrome.i18n.getMessage('extPdfFailed') || 'Markdown saved, but PDF download failed.'));
    }

    const config = await chrome.storage.local.get(['historyTags']);
    const history = new Set(config.historyTags || []);
    tags.forEach(t => history.add(t));
    await chrome.storage.local.set({ historyTags: Array.from(history) });

    window.close();
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = chrome.i18n.getMessage('extSaveClose') || 'Save & Close';
    showError((chrome.i18n.getMessage('extSaveFailed') || 'Save failed.') + ' ' + err.message);
  }
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Load historical tags for autocomplete
    const historyConfig = await chrome.storage.local.get(['historyTags']);
    const historyTags = historyConfig.historyTags || [];
    const datalist = document.getElementById('tagSuggestions');
    historyTags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      datalist.appendChild(option);
    });

    let response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    if (response && response.error) {
      showError(response.error);
      return;
    }

    loadingEl.innerHTML = `<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>${chrome.i18n.getMessage('extQueryingSemanticScholar') || 'Querying Semantic Scholar API...'}</span>`;
    
    paperData = await enrichWithS2(response);

    titleEl.textContent = paperData.title || '';
    authorsEl.textContent = Array.isArray(paperData.authors) ? paperData.authors.join(', ') : '';
    
    // Display original/preprint info in the main inputs
    const displayYear = paperData.year || '';
    const displayVenue = paperData.venue || '';
    
    yearEl.value = displayYear;
    venueEl.value = displayVenue;
    renderPublication(paperData);
    
    // Timeline Hint
    const timelineHint = document.getElementById('timelineHint');
    if (paperData.published_year && paperData.published_venue && 
        (paperData.published_year !== paperData.year || paperData.published_venue !== paperData.venue)) {
      timelineHint.textContent = chrome.i18n.getMessage('extTimelineHint', [
        paperData.year || 'Preprint',
        paperData.published_year,
        paperData.published_venue
      ]) || `Timeline: ${paperData.year || 'Preprint'} -> ${paperData.published_year} (${paperData.published_venue})`;
      timelineHint.classList.remove('hidden');
    }

    const config = await chrome.storage.local.get(['saveSubdir', 'filenameRule', 'defaultTags', 'tagMappings', 'downloadPdfByDefault']);
    const userDefaultTags = config.defaultTags || [];
    downloadPdfCheckbox.checked = config.downloadPdfByDefault !== false;

    for (const tag of userDefaultTags) {
      tagsSet.add(tag);
    }
    if (paperData.suggested_tags) {
      for (const tag of paperData.suggested_tags) {
        tagsSet.add(tag);
      }
    }
    
    // Auto-generate tags from published venue
    if (paperData.published_venue) {
      let vTag = "";
      const acronymMatch = paperData.published_venue.match(/\b([A-Z]{3,})\b/);
      if (acronymMatch) {
        vTag = acronymMatch[1].toLowerCase();
      } else {
        vTag = paperData.published_venue.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      }
      
      if (vTag) {
        // We'll guess it's a conference for now
        tagsSet.add(`conf/${vTag}`);
        if (paperData.published_year) {
          tagsSet.add(`conf/${vTag}${paperData.published_year}`);
        }
      }
    }

    if (config.tagMappings && paperData.categories) {
      for (const cat of paperData.categories) {
        const mappedTags = config.tagMappings[cat];
        if (mappedTags) {
          for (const t of mappedTags) {
            tagsSet.add(t);
          }
        }
      }
    }
    renderTags();

    abstractContent.textContent = paperData.abstract || '';
    
    // Initial path card update requires config
    updatePathCard(paperData, config.saveSubdir || 'Papers/arxiv', config.filenameRule || '{{safe_title}}', downloadPdfCheckbox.checked);

    loadingEl.classList.add('hidden');
    formEl.classList.remove('hidden');
    pathCard.classList.remove('hidden');
  } catch (err) {
    showError((chrome.i18n.getMessage('extExtractionFailed') || 'Extraction failed.') + ' ' + err.message);
  }
})();
const PDF_MISSING_NON_FATAL_MESSAGE = 'Markdown saved without downloading the PDF.';

function isPdfMissingNonFatalMessage(value) {
  if (!value) {
    return false;
  }

  const message = value instanceof Error ? value.message : String(value);
  return message.includes(PDF_MISSING_NON_FATAL_MESSAGE);
}

function installPdfMissingNonFatalGuard() {
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args) => {
    if (args.some(isPdfMissingNonFatalMessage)) {
      return;
    }

    originalWarn(...args);
  };

  console.error = (...args) => {
    if (args.some(isPdfMissingNonFatalMessage)) {
      return;
    }

    originalError(...args);
  };

  window.addEventListener(
    'error',
    (event) => {
      if (isPdfMissingNonFatalMessage(event.error) || isPdfMissingNonFatalMessage(event.message)) {
        event.preventDefault();
      }
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      if (isPdfMissingNonFatalMessage(event.reason)) {
        event.preventDefault();
      }
    },
    true
  );
}

installPdfMissingNonFatalGuard();
