let paperData = null;
let tagsSet = new Set();
let saveConfig = {};
let paperUnavailable = false;
let saving = false;
let saved = false;
let draftEdited = false;
const editedMetadata = new Set();

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
const saveStatus = document.getElementById('saveStatus');
const message = key => chrome.i18n.getMessage(key) || key;

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
  const chips = document.createDocumentFragment();
  for (const tag of tagsSet) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const remove = document.createElement('button');
    remove.className = 'tag-chip-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', chrome.i18n.getMessage('extRemoveTag', [tag]));
    remove.addEventListener('click', () => {
      removeTag(tag);
      tagInput.focus();
    });
    chip.append(document.createTextNode(tag), remove);
    chips.append(chip);
  }
  tagsContainer.replaceChildren(chips);
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
  draftEdited = true;
  tagsSet.add(trimmed);
  renderTags();
}

function removeTag(tag) {
  draftEdited = true;
  tagsSet.delete(tag);
  renderTags();
}

document.addEventListener('reading-tags', event => {
  if (paperUnavailable) return;
  draftEdited = true;
  for (const tag of event.detail) tagsSet.add(tag);
  renderTags();
});

document.addEventListener('paper-availability', event => {
  paperUnavailable = !event.detail;
  saveBtn.disabled = saving || (paperUnavailable && !saved);
});

function confirmDiscard() {
  return saved || (!draftEdited && !globalThis.PaperReadingUI?.hasWork()) || confirm(message('extDiscardDraft'));
}

document.getElementById('readerRefresh').addEventListener('click', () => {
  if (!saving && confirmDiscard()) location.reload();
});

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
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(data.doi)}`, { signal: AbortSignal.timeout(7000) });
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
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
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
  const displayFilename = escapeHtml(filename);
  const cleaned = normalizeSubdirForPreview(subdir);
  pathDir.textContent = (cleaned ? cleaned + '/' : '');
  const pdfLine = downloadPdf && data.pdf_url
    ? `<span class="ext-pdf">${displayFilename}.pdf</span>`
    : `<span class="ext-pdf muted">${chrome.i18n.getMessage('extPdfNotSaved') || 'PDF will not be saved'}</span>`;
  pathFiles.innerHTML = `
    <span class="ext-md">${displayFilename}.md</span>
    ${pdfLine}`;
}

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = '';
  }
});

function refreshPathPreview() {
  if (!paperData) return;
  const data = { ...paperData, year: parseInt(yearEl.value, 10) || paperData.year };
  updatePathCard(data, saveConfig.saveSubdir || 'Papers/arxiv', saveConfig.filenameRule || '{{safe_title}}', downloadPdfCheckbox.checked);
}

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  const pathSettings = ['saveSubdir', 'filenameRule'].filter(key => changes[key]);
  for (const key of pathSettings) saveConfig[key] = changes[key].newValue;
  if (pathSettings.length) refreshPathPreview();
});

for (const field of [yearEl, venueEl, noteInput, tagInput, inlineTagsCheckbox, downloadPdfCheckbox]) {
  field.addEventListener('input', () => {
    draftEdited = true;
    if (field === yearEl || field === venueEl) editedMetadata.add(field);
    if (field === yearEl || field === downloadPdfCheckbox) refreshPathPreview();
  });
}

abstractToggle.addEventListener('click', () => {
  const isHidden = abstractContent.classList.contains('hidden');
  abstractContent.classList.toggle('hidden');
  abstractToggle.classList.toggle('open', !isHidden);
  abstractToggle.setAttribute('aria-expanded', String(isHidden));
});

cancelBtn.addEventListener('click', () => { if (!saving && confirmDiscard()) window.close(); });

saveBtn.addEventListener('click', async () => {
  if (saved) { window.close(); return; }
  if (!paperData || paperUnavailable || saving) return;
  if (globalThis.PaperReadingUI?.isAnalyzing() && !confirm(message('extSaveWhileAnalyzing'))) return;
  saving = true;
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  document.getElementById('readerRefresh').disabled = true;
  saveStatus.hidden = true;
  saveBtn.textContent = chrome.i18n.getMessage('extSaving') || 'Saving...';

  const tags = Array.from(tagsSet);
  const updatedData = {
    ...paperData,
    year: parseInt(yearEl.value, 10) || paperData.year,
    venue: venueEl.value.trim() || paperData.venue,
    latest_year: parseInt(yearEl.value, 10) || paperData.latest_year || paperData.year,
    latest_venue: venueEl.value.trim() || paperData.latest_venue || paperData.venue,
    note: noteInput.value.trim(),
    reading_assistant: globalThis.PaperReadingUI?.getExport() || ''
  };

  try {
    if (globalThis.PaperReadingUI && !await globalThis.PaperReadingUI.canSave()) {
      throw new Error(message('readerPageChanged'));
    }
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
    saved = true;
    void rememberTags(tags);
    const notice = response.markdownPending ? 'extNotePending'
      : response.pdfPending ? 'extPdfPending'
      : response.pdfError ? 'extPdfFailed'
      : response.pdfSkipped ? 'extPdfSkipped' : '';
    if (!notice) { window.close(); return; }
    saveStatus.hidden = false;
    saveStatus.classList.remove('panel-notice-error');
    saveStatus.textContent = message(notice);
  } catch (err) {
    saveStatus.textContent = `${message('extSaveFailed')} ${err.message}`;
    saveStatus.classList.add('panel-notice-error');
    saveStatus.hidden = false;
  } finally {
    saving = false;
    saveBtn.disabled = paperUnavailable && !saved;
    saveBtn.textContent = message(saved ? 'extClosePanel' : 'extSaveClose');
    cancelBtn.disabled = false;
    const refresh = document.getElementById('readerRefresh');
    refresh.disabled = false;
  }
});

async function rememberTags(tags) {
  try {
    const { historyTags } = await chrome.storage.local.get('historyTags');
    const history = Array.isArray(historyTags) ? historyTags : [];
    await chrome.storage.local.set({ historyTags: [...new Set([...tags, ...history])].slice(0, 500) });
  } catch { /* Tag suggestions should never turn a saved note into a failed save. */ }
}

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || (tab.url && !/^https?:\/\//i.test(tab.url))) {
      showError(message('extUnsupportedPage'));
      return;
    }
    
    // Load historical tags for autocomplete
    const settings = chrome.storage.local.get(['historyTags', 'saveSubdir', 'filenameRule', 'defaultTags', 'tagMappings', 'downloadPdfByDefault'])
      .catch(() => ({}));
    const historyConfig = await settings;
    const historyTags = Array.isArray(historyConfig.historyTags) ? historyConfig.historyTags.slice(0, 500) : [];
    const datalist = document.getElementById('tagSuggestions');
    historyTags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      datalist.appendChild(option);
    });

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    } catch (error) {
      // activeTab permits the user's explicitly opened page without granting all sites at install time.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['reading/extract.js', 'content_script.js'] });
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    }
    if (!response?.title || response.error) {
      showError(response?.error || message('extUnsupportedPage'));
      return;
    }

    paperData = applyLatestPublication({ ...response });

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

    const config = saveConfig = historyConfig;
    const userDefaultTags = Array.isArray(config.defaultTags) ? config.defaultTags : [];
    downloadPdfCheckbox.checked = config.downloadPdfByDefault !== false;

    for (const tag of userDefaultTags) {
      tagsSet.add(tag);
    }
    if (paperData.suggested_tags) {
      for (const tag of paperData.suggested_tags) {
        tagsSet.add(tag);
      }
    }
    
    addVenueTags(paperData);

    if (config.tagMappings && paperData.categories) {
      for (const cat of paperData.categories) {
        const mappedTags = config.tagMappings[cat];
        if (Array.isArray(mappedTags)) {
          for (const t of mappedTags) {
            tagsSet.add(t);
          }
        }
      }
    }
    renderTags();

    abstractContent.textContent = paperData.abstract || '';
    
    // Initial path card update requires config
    refreshPathPreview();

    loadingEl.classList.add('hidden');
    formEl.classList.remove('hidden');
    pathCard.classList.remove('hidden');
    document.dispatchEvent(new CustomEvent('paper-ready', { detail: { paper: paperData, tabId: tab.id, tabUrl: tab.url, windowId: tab.windowId } }));
    void enrichWithS2({ ...response }).then(enriched => {
      if (saved || saving) return;
      paperData = enriched;
      if (!editedMetadata.has(yearEl)) yearEl.value = enriched.year || '';
      if (!editedMetadata.has(venueEl)) venueEl.value = enriched.venue || '';
      renderPublication(enriched);
      if (!draftEdited) {
        addVenueTags(enriched);
        renderTags();
      }
      refreshPathPreview();
      document.dispatchEvent(new CustomEvent('paper-enriched', { detail: enriched }));
    }).catch(() => {});
  } catch (err) {
    showError((chrome.i18n.getMessage('extExtractionFailed') || 'Extraction failed.') + ' ' + err.message);
  }
})();

function addVenueTags(data) {
  if (!data.published_venue) return;
  const word = data.published_venue.match(/\b([A-Z]{3,})\b/)?.[1] || data.published_venue.split(' ')[0];
  const tag = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!tag) return;
  tagsSet.add(`conf/${tag}`);
  if (data.published_year) tagsSet.add(`conf/${tag}${data.published_year}`);
}
