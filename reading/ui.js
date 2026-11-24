(function (root) {
  'use strict';
  const R = root.PaperReading;
  const $ = id => document.getElementById(id);
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const controls = ['readerLoad', 'readerSelection', 'readerImport', 'readerMode', 'readerTopic', 'readerQuestion', 'readerExcerpt', 'readerExcerptOnly',
    'readerAnalyze', 'readerOnlinePdf', 'readerSection', 'readerTableFirst', 'readerTableSecond', 'readerReadTable',
    'readerPageNumber', 'readerOpenPage', 'readerClearPage', 'readerClearFollow', 'readerPin', 'readerFollow'];
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
  let focusedPage;
  let followReport;
  let journal = { notes: '', entries: [] };
  let journalBusy = false;
  const chosenEntries = new Set();

  function status(message, error = false) {
    $('readerStatus').textContent = message;
    $('readerStatus').classList.toggle('reading-error', error);
  }

  function busy(value) {
    for (const id of controls) $(id).disabled = value || stale;
    if (followReport) {
      for (const id of ['readerMode', 'readerExcerpt', 'readerExcerptOnly']) $(id).disabled = true;
    }
    $('readerFollow').disabled ||= !report?.context.sources.length;
    $('readerReadTable').disabled ||= !canReadTable();
    $('readerCancel').hidden = !value;
    $('readerPanel').setAttribute('aria-busy', String(value));
  }

  function context() {
    if (followReport) {
      const previous = followReport.context;
      if (previous.characters <= R.MAX_CONTEXT) return previous;
      return R.selectContext({ ...previous, focusOmitted: previous.omitted }, 'qa', $('readerQuestion').value);
    }
    const mode = $('readerMode').value;
    const useAbstract = ['screen', 'quick'].includes(mode) && abstractDocument.sources.length > 0;
    const excerpt = useAbstract ? '' : $('readerExcerpt').value;
    const excerptOnly = mode !== 'qa' && $('readerExcerptOnly').checked && excerpt.trim();
    const source = useAbstract ? abstractDocument : focusedDocument();
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

  function focusedDocument() {
    if (!focusedPage) {
      const selection = $('readerSection').value;
      if (!selection) return sourceDocument;
      return R.focusSources(sourceDocument, selection.startsWith('table:') ? { table: selection.slice(6) } : { section: selection.slice(8) });
    }
    const page = focusedPage.number;
    const near = sourceDocument.sources.filter(source => source.page === page - 1 || source.page === page + 1);
    const sources = [...focusedPage.sources, ...near];
    return { ...sourceDocument, sources, focus: `PDF p. ${page}`,
      focusOmitted: sourceDocument.sources.filter(source => Math.abs(source.page - page) > 1).length,
      priority: new Set(focusedPage.sources.map(source => source.id)) };
  }

  function useDocument(document) {
    sourceDocument = document;
    clearPage();
    const pdf = document.pdfDocument;
    $('readerPageControl').hidden = !pdf;
    $('readerOnlinePdf').hidden = Boolean(pdf) || document.scope === 'abstract' || !R.safeSourceUrl(current.paper.pdf_url);
    $('readerPageNumber').value = '';
    $('readerPageNumber').max = pdf?.pageCount || '';
    const sections = pdf || document.scope === 'abstract' ? [] : [...new Set(document.sources.map(source => source.section).filter(Boolean))];
    const tables = new Map(document.sources.filter(source => source.format === 'table').map(source => [source.tableId || source.locator, source.locator]));
    const select = $('readerSection');
    select.replaceChildren(new Option(t('readerAllSections'), ''), ...sections.map(section => new Option(section, `section:${section}`)),
      ...Array.from(tables, ([id, label]) => new Option(`▦ ${label}`, `table:${id}`)));
    $('readerSectionControl').hidden = !sections.length && !tables.size;
    $('readerEvidence').hidden = !pdf && !sections.length && !tables.size;
    updateTableTools();
    renderSources();
  }

  function selectedTable() {
    const selection = $('readerSection').value;
    return selection.startsWith('table:') && sourceDocument.tables?.find(table => table.id === selection.slice(6));
  }

  function canReadTable() {
    const table = selectedTable();
    return table?.rows && $('readerTableFirst').value !== $('readerTableSecond').value;
  }

  function resetTableResult() {
    if (report?.mode !== 'table') return;
    report = null;
    $('readerResults').replaceChildren();
    for (const id of ['readerResultActions', 'readerResultNotice', 'readerCitations', 'readerExportField']) $(id).hidden = true;
    $('readerInclude').checked = false;
    status('');
  }

  function updateTableTools() {
    resetTableResult();
    const table = selectedTable();
    $('readerTableTools').hidden = !table;
    if (!table) return;
    const url = R.safeSourceUrl(table.url);
    $('readerTableOriginal').hidden = !url;
    $('readerTableOriginal').href = url;
    $('readerTableRows').hidden = !table.rows;
    $('readerReadTable').hidden = !table.rows;
    $('readerTableHint').textContent = t(table.reason || 'readerTableLocalHint');
    if (!table.rows) return;
    for (const id of ['readerTableFirst', 'readerTableSecond']) {
      $(id).replaceChildren(...table.rows.map((row, i) => new Option(t('readerTableRow', [String(row[0].rowNumber), row[0].text]), String(i))));
    }
    $('readerTableSecond').selectedIndex = 1;
    $('readerReadTable').disabled = Boolean(operation) || stale;
  }

  function clearPage() {
    focusedPage = null;
    $('readerPageView').hidden = true;
    $('readerClearPage').hidden = true;
    $('readerPageCanvas').width = 0;
  }

  function viewPage(number) {
    void run(async (signal, token) => {
      await boundTab();
      const pdf = sourceDocument.pdfDocument;
      if (!pdf) throw new Error('readerPageInvalid');
      status(t('readerLoading'));
      const canvas = document.createElement('canvas');
      const sources = await root.PaperReadingDocument.readPdfPage(pdf, number, canvas, signal);
      if (generation !== token || signal.aborted) return;
      endFollow();
      focusedPage = { number, sources };
      $('readerPageNumber').value = String(number);
      $('readerPageCanvas').replaceWith(canvas);
      canvas.id = 'readerPageCanvas';
      canvas.setAttribute('role', 'img');
      const caption = t('readerPagePreview', [String(number), String(pdf.pageCount)]);
      canvas.setAttribute('aria-label', caption);
      $('readerPageCaption').textContent = caption;
      $('readerPageView').hidden = false;
      $('readerClearPage').hidden = false;
      if (['quick', 'screen'].includes($('readerMode').value)) $('readerMode').value = 'qa';
      updateMode();
      status(t(sources.length ? 'readerPageFocused' : 'readerPdfNoText'));
    });
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
    return t(({ abstract: 'readerScopeAbstract', 'html-text': 'readerScopeHtml', 'html-table': 'readerModeTable', 'pdf-text': 'readerScopePdf', page: 'readerScopePage', provided: 'readerScopeProvided', selection: 'readerScopeSelection' })[scope] || 'readerScopeProvided');
  }

  function renderSources(selected = context()) {
    $('readerSourceSummary').textContent = t('readerContextSummary', [selected.focus || scopeLabel(selected.scope.split('+')[0]), String(selected.sources.length), String(selected.characters)]);
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
      label.textContent = `[${source.id}] ${source.locator || source.section || t('readerScopeProvided')}`;
      const text = document.createElement('blockquote');
      text.textContent = source.text;
      block.append(label, text);
      if (source.page && source.pdfId && source.pdfId === sourceDocument.pdfDocument?.id) {
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'reading-link';
        view.textContent = t('readerViewPdfPage', [String(source.page)]);
        view.onclick = () => {
          if (source.pdfId === sourceDocument.pdfDocument?.id) viewPage(source.page);
        };
        block.append(view);
      }
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
    meta.textContent = `${t('readerMode' + value.mode[0].toUpperCase() + value.mode.slice(1))} · ${value.model} · ${value.context.focus || scopeLabel(value.context.scope.split('+')[0])} · ${new Date(value.createdAt).toLocaleString()}`;
    const summary = document.createElement('p');
    summary.textContent = value.analysis.summary;
    result.append(meta, summary);
    if (value.mode === 'table') result.prepend(summary);
    if (value.analysis.screening) renderScreening(result, report);
    if (value.question) {
      const question = document.createElement('p');
      question.className = 'reading-hint';
      question.textContent = `${t('readerQuestion')}: ${value.question}`;
      result.append(question);
    }
    let firstComparison = true;
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
      let evidence = node;
      if (value.mode === 'table' && section.type === 'derived') {
        evidence = document.createElement('details');
        const difference = document.createElement('summary');
        difference.textContent = section.calculation;
        evidence.append(difference);
        evidence.open = firstComparison;
        firstComparison = false;
        node.append(heading, label, evidence);
      } else node.append(heading, label, text);
      for (const [index, id] of section.sources.entries()) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'reading-citation'; button.textContent = `[${id}]`;
        if (section.operands) button.textContent = `${section.operands[index]} [${id}]`;
        button.setAttribute('aria-label', `${t('readerOpenSource')} ${button.textContent}`);
        button.addEventListener('click', () => {
          $('readerCitations').open = true;
          const source = $(`reader-cite-${id}`);
          source?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          source?.focus();
        });
        evidence.append(button);
      }
      if (section.guidance?.length) {
        const hint = document.createElement('p');
        hint.className = 'reading-hint';
        hint.textContent = section.guidance.join(' ');
        evidence.append(hint);
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
    $('readerInclude').checked = !chosenEntries.has(value.id);
    $('readerResultActions').hidden = false;
    $('readerFollow').disabled = stale || !value.context.sources.length;
    $('readerResultNotice').hidden = value.mode === 'table';
    if (root.renderMathInElement) root.renderMathInElement(result, { throwOnError: false, trust: false, strict: 'ignore',
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }] });
  }

  function endFollow() {
    followReport = null;
    $('readerQuestionContext').hidden = true;
    $('readerClearFollow').hidden = true;
    $('readerExcerpt').disabled = Boolean(operation) || stale;
    $('readerExcerptOnly').disabled = Boolean(operation) || stale;
    $('readerMode').disabled = Boolean(operation) || stale;
  }

  function startFollow(value) {
    if (stale || operation || !value?.context.sources.length) return;
    followReport = value;
    $('readerMode').value = 'qa';
    $('readerQuestion').value = '';
    $('readerQuestionContext').textContent = t('readerFollowingEvidence', [(value.question || value.analysis.summary).slice(0, 160)]);
    $('readerQuestionContext').hidden = false;
    $('readerClearFollow').hidden = false;
    updateMode();
    busy(false);
    $('readerQuestion').focus();
  }

  function renderJournal() {
    const list = $('readerJournalEntries');
    const fragment = document.createDocumentFragment();
    for (const entry of journal.entries) {
      const item = document.createElement('li');
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'reading-link';
      title.textContent = (entry.question || entry.analysis.summary || entry.mode).slice(0, 170);
      title.onclick = () => {
        if (operation || stale) return;
        endFollow();
        renderReport(entry);
        renderSources();
        $('readerResults').scrollIntoView({ block: 'nearest' });
      };
      const label = document.createElement('label');
      label.className = 'reading-export';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = chosenEntries.has(entry.id);
      check.onchange = () => {
        if (check.checked) chosenEntries.add(entry.id);
        else chosenEntries.delete(entry.id);
      };
      label.append(check, document.createTextNode(t('readerIncludeEntry')));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'reading-link';
      remove.textContent = t('readerRemoveEntry');
      remove.onclick = () => void updateJournal(key => root.PaperReadingJournal.remove(key, entry.id), 'readerEntryRemoved');
      item.append(title, label, remove);
      fragment.append(item);
    }
    if (!journal.entries.length) {
      const empty = document.createElement('li');
      empty.className = 'reading-hint';
      empty.textContent = t('readerJournalEmpty');
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
  }

  async function updateJournal(action, success) {
    if (!current || stale || journalBusy) return;
    const key = current.key;
    journalBusy = true;
    try {
      const updated = await action(key);
      if (current?.key !== key) return;
      journal = updated;
      for (const id of chosenEntries) {
        if (!journal.entries.some(entry => entry.id === id)) chosenEntries.delete(id);
      }
      renderJournal();
      $('readerJournal').open = true;
      $('readerJournalStatus').textContent = t(success);
    } catch (error) {
      $('readerJournal').open = true;
      $('readerJournalStatus').textContent = t(error?.message === 'readerJournalFull' ? 'readerJournalFull' : 'readerJournalFailed');
    } finally {
      journalBusy = false;
    }
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
    endFollow();
    selectedExcerpt = null;
    journal = { notes: '', entries: [] };
    chosenEntries.clear();
    $('readerJournalNotes').value = '';
    $('readerIncludeNotes').checked = false;
    $('readerJournalStatus').textContent = '';
    $('readerSaveNotes').disabled = true;
    renderJournal();
    $('readerResults').replaceChildren();
    $('readerExcerpt').value = '';
    $('readerQuestion').value = '';
    $('paperSwitch').hidden = true;
    $('readerCitations').hidden = true;
    $('readerExportField').hidden = true;
    $('readerResultNotice').hidden = true;
    $('readerResultActions').hidden = true;
    abstractDocument = { ...R.makeSources(detail.paper.abstract ? [{ text: detail.paper.abstract, section: t('extAbstract'), url: detail.paper.web_url, kind: 'paper' }] : []), scope: 'abstract' };
    useDocument(abstractDocument);
    busy(false);
    updateMode();
    status(t('readerReady'));
    const token = generation;
    const key = current.key;
    void root.PaperReadingJournal.load(key).then(value => {
      if (current?.key !== key || journalBusy) return;
      journal = value;
      if (!$('readerJournalNotes').value) $('readerJournalNotes').value = value.notes;
      renderJournal();
    }).catch(() => { $('readerJournalStatus').textContent = t('readerJournalFailed'); })
      .finally(() => { if (current?.key === key) $('readerSaveNotes').disabled = false; });
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (generation === token && !matchesPaper(active)) markStale();
  }

  function loadDocument(pdfOnly) {
    if (!current || stale || operation) return;
    // Request directly in the click gesture, before reading storage or parsing files.
    const pdfUrl = R.safeSourceUrl(current.paper.pdf_url);
    if (pdfOnly && !pdfUrl) return;
    const origins = [...new Set([pdfOnly ? '' : current.paper.html_url, pdfUrl].map(R.safeSourceUrl)
      .filter(Boolean).map(url => `${new URL(url).origin}/*`))];
    const permission = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
    void run(async (signal, token) => {
      if (!await permission) throw new Error('readerPermissionNeeded');
      await boundTab();
      status(t('readerLoading'));
      const progress = (page, count) => { if (generation === token) status(t('readerPdfProgress', [String(page), String(count)])); };
      const loaded = pdfOnly
        ? await root.PaperReadingDocument.loadPdf(pdfUrl, signal, progress)
        : await root.PaperReadingDocument.loadPaper(current.paper, current.tabId, signal, progress);
      if (generation !== token || signal.aborted) return;
      endFollow();
      useDocument(loaded);
      status(t(loaded.scope === 'pdf-text' ? (loaded.sources.length ? 'readerPdfReady' : 'readerPdfNoText') : 'readerTextReady'));
    });
  }
  $('readerLoad').addEventListener('click', () => loadDocument(false));
  $('readerOnlinePdf').addEventListener('click', () => loadDocument(true));

  $('readerSelection').addEventListener('click', () => void run(async (signal, token) => {
    await boundTab();
    const extracted = await chrome.tabs.sendMessage(current.tabId, { action: 'readingSelection' });
    if (!extracted?.text) throw new Error('readerNoSelection');
    if (generation !== token || signal.aborted) return;
    $('readerExcerpt').value = extracted.text;
    endFollow();
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
        (page, count) => { if (generation === token) status(t('readerPdfProgress', [String(page), String(count)])); }, file.name);
      if (generation !== token || signal.aborted) return;
      endFollow();
      useDocument(loaded);
      status(`${t(loaded.sources.length ? 'readerPdfReady' : 'readerPdfNoText')} ${t('readerImportedFile', [file.name])}`);
    }).finally(() => { $('readerFile').value = ''; });
  });

  $('readerAnalyze').addEventListener('click', () => void run(async (signal, token) => {
    await boundTab();
    const mode = $('readerMode').value;
    const question = $('readerQuestion').value.trim();
    const topic = mode === 'screen' ? $('readerTopic').value.trim() : '';
    if (mode === 'screen' && !topic) throw new Error('readerTopicRequired');
    if (mode === 'explain' && !$('readerExcerpt').value.trim()) throw new Error('readerExcerptRequired');
    if (mode === 'qa' && !followReport && !focusedPage && (!sourceDocument.sources.length || !['html-text', 'pdf-text', 'page'].includes(sourceDocument.scope))) {
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
    const previous = followReport ? {
      question: (followReport.question || '').slice(0, 800),
      answer: [followReport.analysis.summary, ...followReport.analysis.sections.map(section => section.text)].join('\n').slice(0, 2500)
    } : null;
    const key = await R.fingerprint({ paper: current.key, context: selected, mode, question, topic, previous, language, endpoint: config.endpoint, model: config.model, promptVersion: 3 });
    const cached = (await chrome.storage.local.get('readingCache').catch(() => ({}))).readingCache || {};
    if (generation !== token || signal.aborted) return;
    if (cached[key]) { renderReport(cached[key]); status(t('readerCached')); return; }
    analyzing = true;
    status(t('readerAnalyzing'));
    const paper = current.paper;
    const paperIdentity = current.key;
    const analysis = await root.PaperReadingModel.analyze({ config, paper, context: selected, mode, question, language, topic, previous, signal });
    if (generation !== token || signal.aborted) return;
    const value = { id: key, analysis, context: selected, mode, question, topic, model: config.model, paperKey: paperIdentity, createdAt: new Date().toISOString() };
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
  $('readerSection').addEventListener('change', () => {
    endFollow();
    updateTableTools();
    if ($('readerSection').value && ['quick', 'screen'].includes($('readerMode').value)) $('readerMode').value = 'qa';
    updateMode();
  });
  for (const id of ['readerTableFirst', 'readerTableSecond']) {
    $(id).addEventListener('change', () => {
      endFollow();
      resetTableResult();
      $('readerReadTable').disabled = !canReadTable();
      $('readerTableHint').textContent = t(canReadTable() ? 'readerTableLocalHint' : 'readerTablePickTwo');
      renderSources();
    });
  }
  $('readerReadTable').addEventListener('click', () => void run(async (signal, token) => {
    await boundTab();
    if (!canReadTable() || signal.aborted || generation !== token) return;
    const table = selectedTable();
    const first = $('readerTableFirst').selectedIndex;
    const second = $('readerTableSecond').selectedIndex;
    let reading;
    try { reading = root.PaperReadingTable.reportFor(table, first, second, t); }
    catch (error) {
      if (error.message !== 'readerTableNoValues') throw error;
      $('readerTableHint').textContent = t(error.message);
      return;
    }
    const id = await R.fingerprint([current.key, table.id, first, second, reading]);
    if (signal.aborted || generation !== token) return;
    endFollow();
    renderReport({ ...reading, id, paperKey: current.key, mode: 'table', model: t('readerTableLocal'), createdAt: new Date().toISOString() });
    status('');
    $('readerResults').tabIndex = -1;
    $('readerResults').focus();
    $('readerResults').scrollIntoView({ block: 'start' });
  }));
  $('readerOpenPage').addEventListener('click', () => viewPage($('readerPageNumber').valueAsNumber));
  $('readerPageNumber').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); viewPage(event.currentTarget.valueAsNumber); }
  });
  $('readerClearPage').addEventListener('click', () => { clearPage(); endFollow(); renderSources(); });
  $('readerFollow').addEventListener('click', () => startFollow(report));
  $('readerClearFollow').addEventListener('click', () => { endFollow(); renderSources(); });
  $('readerPin').addEventListener('click', () => {
    if (!report || operation) return;
    const value = structuredClone(report);
    void updateJournal(key => root.PaperReadingJournal.pin(key, value), 'readerEntrySaved');
  });
  $('readerSaveNotes').addEventListener('click', () => {
    const notes = $('readerJournalNotes').value;
    void updateJournal(key => root.PaperReadingJournal.saveNotes(key, notes), 'readerNotesSaved');
  });
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
  function getExport() {
    if (stale || !current) return '';
    const entries = new Map(journal.entries.filter(entry => chosenEntries.has(entry.id)).map(entry => [entry.id, entry]));
    if (report?.paperKey === current.key && $('readerInclude').checked) entries.set(report.id, report);
    const notes = $('readerIncludeNotes').checked ? $('readerJournalNotes').value.trim() : '';
    if (!entries.size && !notes) return '';
    const reports = [...entries.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (reports.length === 1 && !notes) return R.formatReport(reports[0]);
    const parts = ['## Reading assistant'];
    if (notes) parts.push(`### Personal annotations\n\n${R.noteText(notes)}`);
    for (const entry of reports) parts.push(R.formatReport(entry, 3));
    return parts.join('\n\n');
  }

  root.PaperReadingUI = {
    getExport,
    hasWork: () => Boolean(report || operation || $('readerExcerpt').value || $('readerQuestion').value ||
      $('readerTopic').value || $('readerJournalNotes').value !== journal.notes),
    isAnalyzing: () => analyzing,
    canSave: async () => { try { await boundTab(); return true; } catch { return false; } }
  };
})(globalThis);
