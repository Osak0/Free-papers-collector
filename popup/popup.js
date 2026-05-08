let paperData = null;
let tagsSet = new Set();

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const formEl = document.getElementById('form');
const titleEl = document.getElementById('title');
const authorsEl = document.getElementById('authors');
const yearEl = document.getElementById('year');
const venueEl = document.getElementById('venue');
const tagsContainer = document.getElementById('tagsContainer');
const tagInput = document.getElementById('tagInput');
const abstractToggle = document.getElementById('abstractToggle');
const abstractContent = document.getElementById('abstractContent');
const inlineTagsCheckbox = document.getElementById('inlineTagsCheckbox');
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

async function enrichWithS2(data) {
  let query = null;
  if (data.doi) query = `DOI:${data.doi}`;
  else if (data.arxiv_id) query = `ArXiv:${data.arxiv_id}`;
  
  if (!query) return data;
  
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${query}?fields=venue,year,citationCount,authors,publicationVenue,publicationTypes`;
    const res = await fetch(url);
    if (res.ok) {
      const s2Data = await res.json();
      
      // Preserve original as preprint info
      data.preprint_year = data.year;
      data.preprint_venue = data.venue;
      
      // S2 data as published info
      if (s2Data.venue || s2Data.publicationVenue) {
        data.published_venue = s2Data.venue || (s2Data.publicationVenue && s2Data.publicationVenue.name) || '';
      }
      if (s2Data.year) {
        data.published_year = s2Data.year;
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
  return data;
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

function updatePathCard(data, subdir, filenameRule) {
  const filename = getFilename(data, filenameRule);
  const cleaned = subdir.replace(/\/+$/, '');
  pathDir.textContent = (cleaned ? cleaned + '/' : '');
  pathFiles.innerHTML = `
    <span class="ext-md">${filename}.md</span>
    <span class="ext-pdf">${filename}.pdf</span>`;
}

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = '';
  }
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
  saveBtn.textContent = 'Saving...';

  const tags = Array.from(tagsSet);
  const updatedData = {
    ...paperData,
    year: parseInt(yearEl.value, 10) || paperData.year,
    venue: venueEl.value.trim() || paperData.venue
  };

  try {
    await chrome.runtime.sendMessage({
      action: 'save',
      data: updatedData,
      tags: tags,
      inlineTags: inlineTagsCheckbox.checked
    });

    const config = await chrome.storage.local.get(['historyTags']);
    const history = new Set(config.historyTags || []);
    tags.forEach(t => history.add(t));
    await chrome.storage.local.set({ historyTags: Array.from(history) });

    window.close();
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Close';
    showError('Save failed: ' + err.message);
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

    loadingEl.innerHTML = `<svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span data-i18n="extExtracting">Querying Semantic Scholar API...</span>`;
    
    paperData = await enrichWithS2(response);

    titleEl.textContent = paperData.title || '';
    authorsEl.textContent = paperData.authors.join(', ') || '';
    
    // Display original/preprint info in the main inputs
    const displayYear = paperData.year || '';
    const displayVenue = paperData.venue || '';
    
    yearEl.value = displayYear;
    venueEl.value = displayVenue;
    
    // Timeline Hint
    const timelineHint = document.getElementById('timelineHint');
    if (paperData.published_year && paperData.published_venue && 
        (paperData.published_year !== paperData.year || paperData.published_venue !== paperData.venue)) {
      timelineHint.textContent = `Timeline: ${paperData.year || 'Preprint'} ➔ ${paperData.published_year} (${paperData.published_venue})`;
      timelineHint.classList.remove('hidden');
    }

    const config = await chrome.storage.local.get(['saveSubdir', 'filenameRule', 'defaultTags', 'tagMappings']);
    const userDefaultTags = config.defaultTags || [];

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
    updatePathCard(paperData, config.saveSubdir || 'Papers/arxiv', config.filenameRule || '{{safe_title}}');

    loadingEl.classList.add('hidden');
    formEl.classList.remove('hidden');
    pathCard.classList.remove('hidden');
  } catch (err) {
    showError('Extraction failed: ' + err.message);
  }
})();
