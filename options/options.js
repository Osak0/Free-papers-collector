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
tags: [{{tags}}]
arxiv_id: "{{arxiv_id}}"
doi: "{{doi}}"
pdf: "[[{{safe_title}}.pdf]]"
notes: ""
---

# {{title}}

**Authors**: {{authors}}
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
`;

const saveSubdirInput = document.getElementById('saveSubdir');
const filenameRuleInput = document.getElementById('filenameRule');
const defaultTagsInput = document.getElementById('defaultTags');
const mappingsContainer = document.getElementById('mappingsContainer');
const templateInput = document.getElementById('markdownTemplate');
const addMappingBtn = document.getElementById('addMappingBtn');
const resetTemplateBtn = document.getElementById('resetTemplateBtn');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

function createMappingRow(category, tags) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.innerHTML = `
    <input type="text" class="input-reset mapping-category" value="${escapeHtml(category || '')}" placeholder="cs.CL">
    <span class="arrow">→</span>
    <input type="text" class="input-reset mapping-tags" value="${escapeHtml((tags || []).join(', '))}" placeholder="nlp, llm">
    <button class="btn-remove" title="删除">×</button>
  `;
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  return row;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMappings(mappings) {
  mappingsContainer.innerHTML = '';
  for (const [category, tags] of Object.entries(mappings)) {
    mappingsContainer.appendChild(createMappingRow(category, tags));
  }
}

function getMappingsFromDOM() {
  const mappings = {};
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
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
  statusEl.classList.remove('hidden');
  setTimeout(() => statusEl.classList.add('hidden'), 2500);
}

saveBtn.addEventListener('click', async () => {
  const saveSubdir = saveSubdirInput.value.trim() || 'Papers/arxiv';
  const filenameRule = filenameRuleInput.value.trim() || '{{safe_title}}';
  const defaultTags = defaultTagsInput.value
    .split(',')
    .map(t => t.trim())
    .filter(t => t);
  const tagMappings = getMappingsFromDOM();
  const markdownTemplate = templateInput.value;

  await chrome.storage.local.set({ saveSubdir, filenameRule, defaultTags, tagMappings, markdownTemplate });
  showStatus(chrome.i18n.getMessage('optSettingsSaved') || 'Settings saved successfully!', 'success');
});

(async () => {
  const result = await chrome.storage.local.get(['saveSubdir', 'filenameRule', 'defaultTags', 'tagMappings', 'markdownTemplate']);
  saveSubdirInput.value = result.saveSubdir || 'Papers/arxiv';
  filenameRuleInput.value = result.filenameRule || '{{safe_title}}';
  defaultTagsInput.value = (result.defaultTags || ['status/read']).join(', ');
  renderMappings(result.tagMappings || DEFAULT_MAPPINGS);
  templateInput.value = result.markdownTemplate || DEFAULT_TEMPLATE;
})();
