const DEFAULT_MAPPINGS = {
  'cs.CL': ['nlp'],
  'cs.CV': ['cv'],
  'cs.LG': ['ml'],
  'cs.AI': ['ai'],
  'cs.IR': ['ir'],
  'cs.RO': ['robotics'],
  'cs.DS': ['ds'],
  'cs.HC': ['hci'],
  'cs.SE': ['se'],
  'stat.ML': ['ml', 'statistics']
};

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

**Authors**: {{authors}}
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

const saveSubdirInput = document.getElementById('saveSubdir');
const downloadPdfByDefaultInput = document.getElementById('downloadPdfByDefault');
const filenameRuleInput = document.getElementById('filenameRule');
const defaultTagsInput = document.getElementById('defaultTags');
const mappingsContainer = document.getElementById('mappingsContainer');
const templateInput = document.getElementById('markdownTemplate');
const addMappingBtn = document.getElementById('addMappingBtn');
const resetTemplateBtn = document.getElementById('resetTemplateBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');
let statusTimer;

function createMappingRow(category, tags) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.innerHTML = `
    <input type="text" class="input-reset mapping-category" placeholder="cs.CL">
    <span class="arrow">&rarr;</span>
    <input type="text" class="input-reset mapping-tags" placeholder="nlp, llm">
    <button type="button" class="btn-remove">&times;</button>
  `;
  const categoryInput = row.querySelector('.mapping-category');
  const tagsInput = row.querySelector('.mapping-tags');
  categoryInput.value = category || '';
  tagsInput.value = Array.isArray(tags) ? tags.join(', ') : '';
  categoryInput.setAttribute('aria-label', chrome.i18n.getMessage('optMappingCategory'));
  tagsInput.setAttribute('aria-label', chrome.i18n.getMessage('optDefaultTagsTitle'));
  const remove = row.querySelector('.btn-remove');
  remove.setAttribute('aria-label', chrome.i18n.getMessage('optDeleteMapping'));
  remove.addEventListener('click', () => {
    row.remove();
    addMappingBtn.focus();
  });
  return row;
}

function renderMappings(mappings) {
  mappingsContainer.innerHTML = '';
  for (const [category, tags] of Object.entries(mappings)) {
    mappingsContainer.appendChild(createMappingRow(category, tags));
  }
}

function getMappingsFromDOM() {
  const mappings = Object.create(null);
  const rows = mappingsContainer.querySelectorAll('.mapping-row');
  rows.forEach(row => {
    const category = row.querySelector('.mapping-category').value.trim();
    const tags = row.querySelector('.mapping-tags').value
      .split(',')
      .map(t => t.trim())
      .filter(t => t);
    if (category && tags.length > 0) {
      mappings[category] = tags;
    }
  });
  return mappings;
}

addMappingBtn.addEventListener('click', () => {
  mappingsContainer.appendChild(createMappingRow('', []));
});

resetTemplateBtn.addEventListener('click', () => {
  templateInput.value = DEFAULT_TEMPLATE;
});

function showStatus(msg, type) {
  clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
  statusEl.classList.remove('hidden');
  if (type === 'success') statusTimer = setTimeout(() => statusEl.classList.add('hidden'), 4000);
}

function isValidSaveSubdir(subdir) {
  const cleaned = (subdir || '').trim().replace(/\\/g, '/');
  if (!cleaned) return true;
  if (cleaned.startsWith('/') || /^[a-zA-Z]:\//.test(cleaned)) return false;
  return !cleaned.split('/').includes('..');
}

saveBtn.addEventListener('click', async () => {
  const saveSubdir = saveSubdirInput.value.trim() || 'Papers/arxiv';
  if (!isValidSaveSubdir(saveSubdir)) {
    showStatus(chrome.i18n.getMessage('optInvalidSavePath') || 'Save directory must be a relative path inside the browser download directory.', 'error');
    return;
  }

  const downloadPdfByDefault = downloadPdfByDefaultInput.checked;
  const filenameRule = filenameRuleInput.value.trim() || '{{safe_title}}';
  const defaultTags = defaultTagsInput.value
    .split(',')
    .map(t => t.trim())
    .filter(t => t);
  const tagMappings = getMappingsFromDOM();
  const markdownTemplate = templateInput.value;

  try {
    const readingConfig = globalThis.PaperReadingSettings.read();
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    // Request host access inside the original Save click gesture.
    if (!await globalThis.PaperReadingSettings.authorize(readingConfig)) throw new Error('readerPermissionNeeded');
    await chrome.storage.local.set({ saveSubdir, downloadPdfByDefault, filenameRule, defaultTags, tagMappings, markdownTemplate, readingConfig });
    showStatus(chrome.i18n.getMessage('optSettingsSaved') || 'Settings saved successfully!', 'success');
  } catch (error) {
    const key = /^reader[A-Z]/.test(error.message) ? error.message : 'readerStorageFailed';
    showStatus(chrome.i18n.getMessage(key), 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.removeAttribute('aria-busy');
  }
});

(async () => {
  const result = await chrome.storage.local.get(['saveSubdir', 'downloadPdfByDefault', 'filenameRule', 'defaultTags', 'tagMappings', 'markdownTemplate']);
  saveSubdirInput.value = result.saveSubdir || 'Papers/arxiv';
  downloadPdfByDefaultInput.checked = result.downloadPdfByDefault !== false;
  filenameRuleInput.value = result.filenameRule || '{{safe_title}}';
  defaultTagsInput.value = (Array.isArray(result.defaultTags) ? result.defaultTags : ['status/read']).join(', ');
  renderMappings(result.tagMappings || DEFAULT_MAPPINGS);
  templateInput.value = result.markdownTemplate || DEFAULT_TEMPLATE;
})().catch(() => showStatus(chrome.i18n.getMessage('readerStorageFailed'), 'error'));
