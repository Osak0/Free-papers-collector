(function (root) {
  'use strict';
  const R = root.PaperReading;
  const $ = id => document.getElementById(id);
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const controls = ['readerLoad', 'readerSelection', 'readerImport', 'readerMode', 'readerTopic', 'readerQuestion', 'readerExcerpt', 'readerExcerptOnly', 'readerAnalyze'];
  let current;
  let sourceDocument = { sources: [], scope: 'abstract' };
  let abstractDocument = sourceDocument;
  let report;
  let operation;
  let generation = 0;
  let stale = false;
  let selectedExcerpt;
  let previewTimer;
  let analyzing = false;

  function status(message, error = false) {
    $('readerStatus').textContent = message;
    $('readerStatus').classList.toggle('reading-error', error);
  }

  function busy(value) {
    for (const id of controls) $(id).disabled = value || stale;
    $('readerCancel').hidden = !value;
    $('readerPanel').setAttribute('aria-busy', String(value));
  }

  function context() {
    const mode = $('readerMode').value;
    const useAbstract = ['screen', 'quick'].includes(mode) && abstractDocument.sources.length > 0;
    const excerpt = useAbstract ? '' : $('readerExcerpt').value;
    const excerptOnly = mode === 'explain' || (mode !== 'qa' && $('readerExcerptOnly').checked && excerpt.trim());
    const source = useAbstract ? abstractDocument : sourceDocument;
    const query = mode === 'screen' ? $('readerTopic').value : $('readerQuestion').value;
    const selected = R.selectContext(excerptOnly ? { sources: [], scope: 'provided' } : source, mode, query, excerpt);
    selected.truncated = !excerptOnly && Boolean(source.truncated);
    if (selectedExcerpt && $('readerExcerpt').value === selectedExcerpt.text) {
      const excerpt = selected.sources.find(source => source.id === 'E1');
      if (excerpt) Object.assign(excerpt, selectedExcerpt, { id: 'E1' });
      if (excerptOnly) selected.scope = 'selection';
    }
    return selected;
  }

  function updateMode() {
    const mode = $('readerMode').value;
    $('readerTopicField').hidden = mode !== 'screen';
    const hint = { screen: 'readerScreenHint', quick: 'readerQuickHint', explain: 'readerExplainHint', qa: 'readerQaHint' }[mode];
    $('readerModeHint').hidden = !hint;
    $('readerModeHint').textContent = hint ? t(hint) : '';
    renderSources();
  }

  function scopeLabel(scope) {
    return t(({ abstract: 'readerScopeAbstract', 'html-text': 'readerScopeHtml', 'pdf-text': 'readerScopePdf', page: 'readerScopePage', provided: 'readerScopeProvided', selection: 'readerScopeSelection' })[scope] || 'readerScopeProvided');
  }

  function renderSources(selected = context()) {
    $('readerSourceSummary').textContent = t('readerContextSummary', [scopeLabel(selected.scope.split('+')[0]), String(selected.sources.length), String(selected.characters)]);
    $('readerCoverage').textContent = selected.omitted || selected.truncated ? t('readerPartialContext') : '';
    if ($('readerSourceDetails').open) buildSources($('readerSources'), selected.sources, 'preview');
  }

  function buildSources(list, sources, prefix) {
    const fragment = document.createDocumentFragment();
    for (const source of sources) {
      const block = document.createElement('div');
      block.className = 'reading-source';
      block.id = `reader-${prefix}-${source.id}`;
      block.tabIndex = -1;
      const label = document.createElement('strong');
      label.textContent = `[${source.id}] ${source.section || source.locator || t('readerScopeProvided')}`;
      const text = document.createElement('blockquote');
      text.textContent = source.text;
      block.append(label, text);
      const safeUrl = R.safeSourceUrl(source.url);
      if (safeUrl) {
        const link = document.createElement('a');
        link.textContent = t('readerOpenSource');
        link.href = safeUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
        block.append(link);
      }
      fragment.append(block);
    }
    list.replaceChildren(fragment);
  }

  function renderReport(value) {
    report = structuredClone(value);
    const cited = new Set(value.analysis.sections.flatMap(section => section.sources));
    $('readerCitations').open = false;
    $('readerCitations').hidden = !cited.size;
    buildSources($('readerCitedSources'), value.context.sources.filter(source => cited.has(source.id)), 'cite');
    const result = $('readerResults');
    result.replaceChildren();
    const meta = document.createElement('p');
    meta.className = 'reading-meta';
    meta.textContent = `${t('readerMode' + value.mode[0].toUpperCase() + value.mode.slice(1))} · ${value.model} · ${scopeLabel(value.context.scope.split('+')[0])} · ${new Date(value.createdAt).toLocaleString()}`;
    const summary = document.createElement('p');
    summary.textContent = value.analysis.summary;
    result.append(meta, summary);
    if (value.analysis.screening) renderScreening(result, report);
    if (value.question) {
      const question = document.createElement('p');
      question.className = 'reading-hint';
      question.textContent = `${t('readerQuestion')}: ${value.question}`;
      result.append(question);
    }
    for (const section of value.analysis.sections) {
      const node = document.createElement('section');
      node.className = 'reading-result-section';
      const heading = document.createElement('h3');
      heading.textContent = section.title;
      const label = document.createElement('span');
      label.className = `reading-kind reading-kind-${section.type}`;
      label.textContent = t(`readerKind${section.type[0].toUpperCase()}${section.type.slice(1)}`);
      const text = document.createElement('div');
      text.className = 'reading-prose';
      text.textContent = section.text;
      node.append(heading, label, text);
      for (const id of section.sources) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'reading-citation'; button.textContent = `[${id}]`;
        button.setAttribute('aria-label', `${t('readerOpenSource')} ${id}`);
        button.addEventListener('click', () => {
          $('readerCitations').open = true;
          const source = $(`reader-cite-${id}`);
          source?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          source?.focus();
        });
        node.append(button);
      }
      result.append(node);
    }
    if (value.analysis.followUp.length) {
      const heading = document.createElement('h3');
      heading.textContent = t('readerFollowUp');
      const list = document.createElement('ul');
      for (const question of value.analysis.followUp) { const item = document.createElement('li'); item.textContent = question; list.append(item); }
      result.append(heading, list);
    }
    $('readerExportField').hidden = false;
    $('readerInclude').checked = true;
    $('readerResultNotice').hidden = false;
    if (root.renderMathInElement) root.renderMathInElement(result, { throwOnError: false, trust: false, strict: 'ignore',
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }] });
  }

  function renderScreening(result, value) {
    const screening = value.analysis.screening;
    const fields = document.createElement('div');
    const label = (key, id) => {
      const element = document.createElement('label');
      element.htmlFor = id;
      element.textContent = t(key);
      fields.append(element);
    };
    label('readerPriority', 'readerPriority');
    const priority = document.createElement('select');
    priority.id = 'readerPriority';
    priority.className = 'reading-select';
    for (const level of ['high', 'medium', 'low', 'uncertain']) {
      priority.add(new Option(t('readerPriority' + level[0].toUpperCase() + level.slice(1)), level));
    }
    priority.value = screening.priority;
    priority.onchange = () => { screening.priority = priority.value; };
    fields.append(priority);
    label('readerSuggestedTags', 'readerSuggestedTags');
    const tags = document.createElement('input');
    tags.id = 'readerSuggestedTags';
    tags.className = 'reading-select';
    tags.maxLength = 500;
    tags.value = screening.tags.join(', ');
    tags.oninput = () => { screening.tags = R.normalizeSuggestedTags(tags.value.split(/[,，]/)); };
    fields.append(tags);
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'reading-link';
    apply.textContent = t('readerApplyTags');
    apply.onclick = () => {
      document.dispatchEvent(new CustomEvent('reading-tags', { detail: screening.tags }));
      status(t('readerTagsApplied'));
    };
    fields.append(apply);
    result.append(fields);
  }

  async function boundTab() {
    if (!current || stale) throw new Error('readerPageChanged');
    const expected = current.tabId;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== expected || !matchesPaper(active)) {
      markStale();
      throw new Error('readerPageChanged');
    }
  }

  function matchesPaper(tab) {
    return !!current && tab?.id === current.tabId && tab.url?.split('#')[0] === current.tabUrl?.split('#')[0];
  }

  function markStale() {
    if (!current || stale) return;
    stale = true;
    generation++;
    operation?.abort();
    busy(false);
    $('paperSwitch').hidden = false;
    document.dispatchEvent(new CustomEvent('paper-availability', { detail: false }));
    status(t('readerPageChanged'), true);
  }

  async function run(task) {
    if (operation || stale || !current) return;
    const token = generation;
    const controller = new AbortController();
    operation = controller;
    busy(true);
    try { await task(controller.signal, token); }
    catch (error) {
      if (generation === token) {
        const key = controller.signal.aborted ? 'readerCancelled' : error?.message;
        status(t(/^reader[A-Z]/.test(key) ? key : 'readerSourceFailed'), key !== 'readerCancelled');
      }
    }
    finally { if (operation === controller) { operation = null; analyzing = false; busy(false); } }
  }

  async function setPaper(detail) {
    generation++;
    operation?.abort();
    current = { ...detail, key: R.paperKey(detail.paper) };
    stale = false;
    report = null;
    selectedExcerpt = null;
    $('readerResults').replaceChildren();
    $('readerExcerpt').value = '';
    $('readerQuestion').value = '';
    $('paperSwitch').hidden = true;
    $('readerCitations').hidden = true;
    $('readerExportField').hidden = true;
    $('readerResultNotice').hidden = true;
    sourceDocument = abstractDocument = { ...R.makeSources(detail.paper.abstract ? [{ text: detail.paper.abstract, section: t('extAbstract'), url: detail.paper.web_url, kind: 'paper' }] : []), scope: 'abstract' };
    busy(false);
    updateMode();
    status(t('readerReady'));
    const token = generation;
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (generation === token && !matchesPaper(active)) markStale();
  }

  $('readerLoad').addEventListener('click', () => {
    if (!current || stale || operation) return;
    // Request directly in the click gesture, before reading storage or parsing files.
    const origins = [...new Set([current.paper.html_url, current.paper.pdf_url].map(R.safeSourceUrl)
      .filter(Boolean).map(url => `${new URL(url).origin}/*`))];
    const permission = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
    void run(async (signal, token) => {
      if (!await permission) throw new Error('readerPermissionNeeded');
      await boundTab();
      status(t('readerLoading'));
      const loaded = await root.PaperReadingDocument.loadPaper(current.paper, current.tabId, signal,
        (page, count) => { if (generation === token) status(t('readerPdfProgress', [String(page), String(count)])); });
      if (generation !== token || signal.aborted) return;
      sourceDocument = loaded;
      renderSources();
      status(t(loaded.scope === 'pdf-text' ? 'readerPdfReady' : 'readerTextReady'));
    });
  });

  $('readerSelection').addEventListener('click', () => void run(async (signal, token) => {
    await boundTab();
    const extracted = await chrome.tabs.sendMessage(current.tabId, { action: 'readingSelection' });
    if (!extracted?.text) throw new Error('readerNoSelection');
    if (generation !== token || signal.aborted) return;
    $('readerExcerpt').value = extracted.text;
    selectedExcerpt = extracted;
    if (['screen', 'quick'].includes($('readerMode').value)) {
      $('readerMode').value = 'explain';
      updateMode();
    }
    renderSources();
    status(t('readerSelectionReady'));
  }));

  $('readerImport').addEventListener('click', () => $('readerFile').click());
  $('readerFile').addEventListener('change', () => {
    const file = $('readerFile').files[0];
    if (!file) return;
    void run(async (signal, token) => {
      if (file.size > 25 * 1024 * 1024) throw new Error('readerFileTooLarge');
      status(t('readerLoading'));
      const loaded = await root.PaperReadingDocument.readPdf(new Uint8Array(await file.arrayBuffer()), '', signal,
        (page, count) => { if (generation === token) status(t('readerPdfProgress', [String(page), String(count)])); });
      if (generation !== token || signal.aborted) return;
      sourceDocument = { ...loaded, scope: 'pdf-text', sources: loaded.sources.map(source => ({ ...source,
        section: `${file.name.slice(0, 120)} · ${source.section}`, locator: `${file.name.slice(0, 120)} · ${source.locator}` })) };
      renderSources();
      status(`${t('readerPdfReady')} ${t('readerImportedFile', [file.name])}`);
    }).finally(() => { $('readerFile').value = ''; });
  });

  $('readerAnalyze').addEventListener('click', () => void run(async (signal, token) => {
    await boundTab();
    const mode = $('readerMode').value;
    const question = $('readerQuestion').value.trim();
    const topic = mode === 'screen' ? $('readerTopic').value.trim() : '';
    if (mode === 'screen' && !topic) throw new Error('readerTopicRequired');
    if (mode === 'explain' && !$('readerExcerpt').value.trim()) throw new Error('readerExcerptRequired');
    if (mode === 'qa' && (!sourceDocument.sources.length || !['html-text', 'pdf-text', 'page'].includes(sourceDocument.scope))) {
      throw new Error('readerFullTextRequired');
    }
    if (mode === 'qa' && !question) throw new Error('readerQuestionRequired');
    const config = R.normalizeConfig((await chrome.storage.local.get('readingConfig')).readingConfig);
    if (!config.enabled) throw new Error('readerConfigureFirst');
    if (!await chrome.permissions.contains({ origins: [R.endpointInfo(config.endpoint).origin] })) throw new Error('readerPermissionNeeded');
    clearTimeout(previewTimer);
    const selected = context();
    renderSources(selected);
    if (!selected.sources.length) throw new Error('readerNoText');
    const language = mode === 'quick' ? 'zh_CN' : config.language === 'auto' ? (chrome.i18n.getUILanguage().startsWith('zh') ? 'zh_CN' : 'en') : config.language;
    const key = await R.fingerprint({ paper: current.key, context: selected, mode, question, topic, language, endpoint: config.endpoint, model: config.model, promptVersion: 2 });
    const cached = (await chrome.storage.local.get('readingCache').catch(() => ({}))).readingCache || {};
    if (generation !== token || signal.aborted) return;
    if (cached[key]) { renderReport(cached[key]); status(t('readerCached')); return; }
    analyzing = true;
    status(t('readerAnalyzing'));
    const paper = current.paper;
    const paperIdentity = current.key;
    const analysis = await root.PaperReadingModel.analyze({ config, paper, context: selected, mode, question, language, topic, signal });
    if (generation !== token || signal.aborted) return;
    const value = { analysis, context: selected, mode, question, topic, model: config.model, paperKey: paperIdentity, createdAt: new Date().toISOString() };
    renderReport(value);
    status(t('readerDone'));
    // Keep only ten completed analyses; never cache credentials or entire PDFs.
    try {
      const latest = (await chrome.storage.local.get('readingCache')).readingCache || {};
      latest[key] = value;
      const entries = Object.entries(latest).filter(([, entry]) => typeof entry?.createdAt === 'string')
        .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt)).slice(0, 10);
      await chrome.storage.local.set({ readingCache: Object.fromEntries(entries) });
    } catch { /* The result remains available even when local storage is full. */ }
  }));

  $('readerCancel').addEventListener('click', () => {
    operation?.abort();
    status(t('readerCancelled'));
  });
  $('readerSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('readerMode').addEventListener('change', updateMode);
  for (const id of ['readerTopic', 'readerQuestion', 'readerExcerpt', 'readerExcerptOnly']) {
    $(id).addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderSources, 160);
    });
  }
  $('readerSourceDetails').addEventListener('toggle', () => {
    if ($('readerSourceDetails').open) {
      clearTimeout(previewTimer);
      renderSources();
    } else {
      $('readerSources').replaceChildren();
    }
  });
  document.addEventListener('paper-ready', event => { void setPaper(event.detail).catch(markStale); });
  document.addEventListener('paper-enriched', event => { if (current) current.paper = event.detail; });
  async function resumeIfActive() {
    if (!stale) return;
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!matchesPaper(active)) return;
      stale = false;
      $('paperSwitch').hidden = true;
      busy(Boolean(operation));
      document.dispatchEvent(new CustomEvent('paper-availability', { detail: true }));
      status(t('readerPaperResumed'));
    } catch { /* Keep the draft visible if the original tab closed. */ }
  }
  chrome.tabs.onActivated.addListener(info => {
    if (!current || info.windowId !== current.windowId) return;
    if (info.tabId !== current.tabId) markStale();
    else void resumeIfActive();
  });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (!current || id !== current.tabId || !change.url) return;
    if (change.url.split('#')[0] !== current.tabUrl?.split('#')[0]) markStale();
    else void resumeIfActive();
  });
  chrome.tabs.onRemoved?.addListener(id => { if (id === current?.tabId) markStale(); });
  addEventListener('pagehide', () => operation?.abort());
  root.PaperReadingUI = {
    getExport: () => report && !stale && $('readerInclude').checked && report.paperKey === current?.key ? R.formatReport(report) : '',
    hasWork: () => Boolean(report || operation || $('readerExcerpt').value || $('readerQuestion').value || $('readerTopic').value),
    isAnalyzing: () => analyzing,
    canSave: async () => { try { await boundTab(); return true; } catch { return false; } }
  };
})(globalThis);
