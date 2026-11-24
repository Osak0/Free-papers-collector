const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../reading/core.js');
const Model = require('../reading/model.js');
const Table = require('../reading/table.js');
const root = path.resolve(__dirname, '..');
const sources = [{ id: 'S1', text: 'A randomized control is compared using the same measurements.', kind: 'paper', section: 'Study design', url: 'https://example.org/paper#study' }];
const good = { summary: 'A study-design explanation.', sections: [
  { title: 'Design', type: 'paper', text: 'The measurements are shared between conditions.', sources: ['S1'] },
  { title: 'Check', type: 'proposal', text: 'Test sensitivity to the control choice.', sources: [] }
], followUp: ['What potential confound remains?'] };

test('custom endpoints reject credentials, query-string keys, insecure remote HTTP and non-web schemes', () => {
  assert.equal(R.endpointInfo('https://models.example/v1/').url, 'https://models.example/v1/chat/completions');
  assert.equal(R.endpointInfo('https://models.example/v1/chat/completions').url, 'https://models.example/v1/chat/completions');
  assert.equal(R.endpointInfo('http://127.0.0.1:11434/v1').origin, 'http://127.0.0.1:11434/*');
  for (const url of ['http://models.example/v1', 'https://user:key@models.example/v1', 'https://models.example/v1?key=secret', 'https://models.example/v1#secret', 'file:///tmp/key', 'javascript:alert(1)']) {
    assert.throws(() => R.endpointInfo(url), /readerInvalidEndpoint/);
  }
  assert.equal(R.normalizeConfig().enabled, false);
  assert.throws(() => R.normalizeConfig({ enabled: true, endpoint: 'https://example.org/v1' }), /readerMissingModel/);
});

test('paper identity distinguishes revisions and normalizes DOI case', () => {
  assert.equal(R.paperKey({ arxiv_id: '2401.00001v2' }), 'arxiv:2401.00001|v2');
  assert.notEqual(R.paperKey({ arxiv_id: '2401.00001v1' }), R.paperKey({ arxiv_id: '2401.00001v2' }));
  assert.equal(R.paperKey({ doi: '10.123/ABC' }), R.paperKey({ doi: '10.123/abc' }));
});

test('large documents remain bounded and context selection finds late experiment evidence', () => {
  const records = Array.from({ length: 210 }, (_, index) => ({ text: `${index} ${'A general introduction. '.repeat(55)}`,
    section: index === 180 ? 'Experiments and evaluation' : 'Background', url: 'https://example.org/paper' }));
  records[180].text = 'The experimental control is measured here. '.repeat(25);
  const doc = R.makeSources(records);
  const selected = R.selectContext({ ...doc, scope: 'html-text' }, 'experiment');
  assert.ok(doc.characters <= 240000);
  assert.equal(doc.truncated, true);
  assert.ok(selected.characters <= R.MAX_CONTEXT);
  assert.ok(selected.omitted > 0);
  assert.ok(selected.sources.some(source => source.section === 'Experiments and evaluation'));
  assert.equal(new Set(selected.sources.map(source => source.id)).size, selected.sources.length);
});

test('provided formulas remain distinct from extracted paper evidence', () => {
  const selected = R.selectContext({ sources: [], scope: 'provided' }, 'formula', '', '$x = y + z$');
  assert.equal(selected.sources[0].id, 'E1');
  assert.equal(selected.sources[0].kind, 'provided');
  assert.equal(selected.scope, 'provided');
  assert.equal(R.safeSourceUrl('javascript:alert(1)'), '');
});

test('model output rejects fabricated and missing source citations', () => {
  assert.deepEqual(R.parseAnalysis(JSON.stringify(good), sources), good);
  const fabricated = structuredClone(good);
  fabricated.sections[0].sources = ['S999'];
  assert.throws(() => R.parseAnalysis(JSON.stringify(fabricated), sources), /readerInvalidCitations/);
  fabricated.sections[0].sources = [];
  assert.throws(() => R.parseAnalysis(JSON.stringify(fabricated), sources), /readerInvalidCitations/);
  assert.throws(() => R.parseAnalysis('<html>not JSON</html>', sources), /readerInvalidResponse/);
  assert.throws(() => R.parseAnalysis(JSON.stringify({ summary: 'No sections', sections: [] }), sources), /readerInvalidResponse/);
});

test('analysis sends bounded evidence as data and uses the configured endpoint without cookies or redirects', async () => {
  const config = { enabled: true, endpoint: 'https://models.example/v1', model: 'test-model', apiKey: 'fixture-only' };
  let sent;
  const result = await Model.analyze({ config, paper: { title: 'A test study' }, context: { sources, scope: 'page', omitted: 3 },
    mode: 'experiment', question: 'Which controls are missing?', language: 'en', fetchImpl: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }));
    } });
  assert.equal(result.sections[0].type, 'paper');
  assert.equal(sent.url, 'https://models.example/v1/chat/completions');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.headers.Authorization, 'Bearer fixture-only');
  assert.match(sent.body.messages[0].content, /untrusted content/);
  assert.match(sent.body.messages[0].content, /omitted passages: 3/);
  assert.deepEqual(JSON.parse(sent.body.messages[1].content).passages[0].id, 'S1');
});

test('authentication, quota, cancellation and timeout have actionable independent states', async () => {
  const args = { config: { enabled: true, endpoint: 'https://models.example/v1', model: 'fixture' }, paper: {},
    context: { sources, scope: 'abstract', omitted: 0 }, mode: 'overview', language: 'en' };
  for (const [status, code] of [[401, 'readerAuthFailed'], [429, 'readerRateLimited'], [500, 'readerServiceFailed']]) {
    await assert.rejects(Model.analyze({ ...args, fetchImpl: async () => new Response('', { status }) }), new RegExp(code));
  }
  const hangingFetch = (url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  await assert.rejects(Model.analyze({ ...args, timeoutMs: 5, fetchImpl: hangingFetch }), /readerTimeout/);
  const controller = new AbortController();
  const pending = Model.analyze({ ...args, signal: controller.signal, fetchImpl: hangingFetch });
  controller.abort();
  await assert.rejects(pending, /readerCancelled/);
});

test('models using max_completion_tokens get one retry only after an explicit parameter rejection', async () => {
  const bodies = [];
  await Model.analyze({ config: { enabled: true, endpoint: 'https://models.example/v1', model: 'fixture' }, paper: {},
    context: { sources, scope: 'page', omitted: 0 }, mode: 'method', language: 'en', fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? new Response(JSON.stringify({ error: { code: 'unsupported_parameter', param: 'max_tokens' } }), { status: 400 }) :
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }));
    } });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].max_completion_tokens, 3500);
  assert.equal(bodies[1].max_tokens, undefined);
});

test('cache keys vary with evidence, mode and paper revision', async () => {
  const first = await R.fingerprint({ paper: 'paper|v1', sources, mode: 'method' });
  assert.notEqual(first, await R.fingerprint({ paper: 'paper|v2', sources, mode: 'method' }));
  assert.notEqual(first, await R.fingerprint({ paper: 'paper|v1', sources, mode: 'formula' }));
});

function background() {
  const downloads = [];
  const store = {};
  const context = vm.createContext({ console, encodeURIComponent, decodeURIComponent, URL, atob, btoa,
    chrome: { i18n: { getMessage: () => '' }, runtime: { onMessage: { addListener() {} } },
      storage: { local: { get: async () => store, set: async values => Object.assign(store, values) } },
      downloads: { download: async options => { downloads.push(options); return downloads.length; },
        search: async ({ id }) => [{ state: 'complete', filename: '/downloads/' + downloads[id - 1].filename }] } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  return { context, downloads, store };
}

test('existing custom templates and manual notes survive optional reading export', () => {
  const { context } = background();
  context.paper = { title: 'A title', authors: ['A. Researcher'], year: 2026, note: 'My own note', reading_assistant: '## Reading assistant\nIndependent AI content' };
  context.template = '# {{title}}\n## Note\n{{note}}';
  const md = vm.runInContext("generateMarkdown(paper, ['topic/test'], true, template, true, 'Researcher_2026')", context);
  assert.match(md, /My own note/);
  assert.match(md, /Independent AI content/);
  assert.equal(md.match(/## Reading assistant/g).length, 1);
  context.template = '{{reading_assistant}}\n## Note\n{{note}}';
  const placed = vm.runInContext("generateMarkdown(paper, [], false, template, false)", context);
  assert.equal(placed.match(/## Reading assistant/g).length, 1);
  const old = vm.runInContext("generateMarkdown({...paper, reading_assistant: ''}, [], false, '{{note}}', false)", context);
  assert.equal(old, 'My own note');
});

test('custom filename PDF links match the actual save request', async () => {
  const { context, downloads, store } = background();
  Object.assign(store, { saveSubdir: 'Papers/Test', filenameRule: '{{first_author}}_{{year}}', markdownTemplate: '## Note\n{{note}}\nPDF: {{pdf_link}}', downloadPdfByDefault: true });
  context.paper = { title: 'Different title', authors: ['A Researcher'], year: 2026, pdf_url: 'https://example.org/paper.pdf', note: 'Manual note' };
  await vm.runInContext('handleSave(paper, [], false, {})', context);
  assert.equal(downloads[0].filename, 'Papers/Test/Researcher_2026.pdf');
  const markdown = decodeURIComponent(downloads[1].url.split(',').slice(1).join(','));
  assert.match(markdown, /\[\[Researcher_2026\.pdf\]\]/);
  assert.match(markdown, /Manual note/);
});

test('a renamed PDF links to its actual filename and interrupted PDF leaves an online link', async () => {
  const { context, downloads } = background();
  context.paper = { title: 'A study', pdf_url: 'https://example.org/paper.pdf', note: 'Draft' };
  context.chrome.downloads.search = async ({ id }) => [id === 1
    ? { state: 'complete', filename: 'C:\\Downloads\\A_study (1).pdf', mime: 'application/pdf' }
    : { state: 'complete', filename: 'A_study.md' }];
  await vm.runInContext('handleSave(paper, [], false, {})', context);
  const markdown = index => decodeURIComponent(downloads[index].url.split(',').slice(1).join(','));
  assert.match(markdown(1), /\[\[A_study \(1\)\.pdf\]\]/);
  context.chrome.downloads.search = async ({ id }) => [{ state: id === 3 ? 'interrupted' : 'complete' }];
  await vm.runInContext('handleSave(paper, [], false, {})', context);
  assert.match(markdown(3), /\[PDF\]\(<https:\/\/example.org\/paper\.pdf>\)/);
  assert.doesNotMatch(markdown(3), /\[\[A_study\.pdf\]\]/);
});

test('legacy templates render notes without rewriting storage or expanding tokens typed inside the note', () => {
  const { context, store } = background();
  context.paper = { title: 'A study', note: 'Compare {{bibtex}} and {{reading_assistant}}' };
  store.markdownTemplate = '# {{title}}';
  const output = vm.runInContext('generateMarkdown(paper, [], false, "# {{title}}", false)', context);
  assert.match(output, /# Note/);
  assert.match(output, /Compare \{\{bibtex\}\} and \{\{reading_assistant\}\}/);
  assert.equal(store.markdownTemplate, '# {{title}}');
});

test('reading exports record source scope, revision, model and the cited text', () => {
  const output = R.formatReport({ analysis: good, context: { sources, scope: 'page', omitted: 5 }, mode: 'experiment', model: 'fixture-model', paperKey: 'paper|v2', createdAt: '2026-01-01T00:00:00Z' });
  assert.match(output, /5 passages omitted/);
  assert.match(output, /paper\|v2/);
  assert.match(output, /Source passages/);
  assert.match(output, /https:\/\/example.org\/paper#study/);
});

test('reading exports preserve LaTeX while escaping model HTML and image transclusion', () => {
  const analysis = structuredClone(good);
  analysis.sections[0].text = 'Formula $a<b$ and <img src="https://example.org/track"> ![[private-note]]';
  const output = R.formatReport({ analysis, context: { sources, scope: 'page', omitted: 0 }, mode: 'formula', model: 'fixture', paperKey: 'test', createdAt: '2026-01-01' });
  assert.match(output, /\$a<b\$/);
  assert.doesNotMatch(output, /<img/);
  assert.match(output, /&lt;img/);
  assert.match(output, /\\!\[\[private-note\]\]/);
});

function numericTable(columns, first, second) {
  return { columns: ['Method', ...columns], rows: [first, second].map((row, index) => [
    { text: index ? 'New' : 'Base', rowNumber: index + 2 }, ...row.map(text => ({ text }))
  ]), url: 'https://example.org/paper#results', caption: 'Control conditions', locator: 'Table 1' };
}

test('local table arithmetic preserves direction, percentage points and matching printed units', () => {
  const table = numericTable(['Accuracy (%)', 'Rate', 'Latency', 'Score'], ['70', '81%', '3.3 ms', '−2'], ['77', '79%', '3.1 ms', '−2']);
  assert.deepEqual(Table.compare(table, 0, 1).map(v => [v.delta, v.percent, v.unit]),
    [[7, true, '%'], [-2, true, '%'], [-0.2, false, 'ms'], [0, false, '']]);
  assert.equal(Table.compare(table, 1, 0)[0].delta, -7);
  assert.deepEqual(Table.compare(table, 1, 1), []);
});

test('missing values, uncertainty, incompatible units and marked-up numbers cannot become scalar evidence', () => {
  const table = numericTable(['A', 'B', 'C', 'D', 'E', 'F'], ['—', '2 ± 1', '5 ms', '40%', '10', '4–5'], ['2', '4', '1 s', '44', '12', '6']);
  table.rows[0][5].annotated = true;
  assert.deepEqual(Table.compare(table, 0, 1), []);
  assert.throws(() => Table.reportFor(table, 0, 1, key => key), /readerTableNoValues/);
});

test('a counterexample beyond the first six columns remains visible, cited and exportable', () => {
  const table = numericTable(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], Array(8).fill('10'), ['10', '11', '12', '13', '14', '15', '16', '9']);
  const t = (key, args = []) => [key, ...args].join(' ');
  const report = Table.reportFor(table, 0, 1, t);
  assert.match(report.analysis.summary, /readerTableAbove B.*readerTableBelow H/);
  const proof = report.analysis.sections.find(section => section.title === 'H');
  assert.deepEqual(proof.sources, ['R2C9', 'R3C9']);
  assert.deepEqual(proof.operands, ['Base · 10', 'New · 9']);
  assert.match(report.analysis.sections.at(-1).text, /readerTableCoverage 6 8/);
  assert.equal(report.context.sources.length, 13);
});

test('different tables with the same caption have distinct focus targets', () => {
  const records = ['T1', 'T2'].map(tableId => ({ text: 'Matching caption and contents', locator: 'Results', format: 'table', tableId }));
  const document = R.makeSources(records);
  const focus = R.focusSources(document, { table: 'T2' });
  assert.deepEqual([...focus.priority], ['S2']);
  assert.equal(focus.focus, 'Results');
});

test('only explicit metric directions support preference; incompatible printed units are skipped', () => {
  const table = numericTable(['Time (ms) ↓', 'Accuracy ↑', 'Score', 'Mass (kg)'], ['30', '80', '20', '15 mg'], ['35', '82', '25', '30 mg']);
  const t = (key, args = []) => [key, ...args].join(' ');
  const report = Table.reportFor(table, 0, 1, t);
  const derived = report.analysis.sections.filter(section => section.type === 'derived');
  assert.equal(derived.length, 3);
  assert.match(derived[0].text, /readerTableFavors Base/);
  assert.match(derived[1].text, /readerTableFavors New/);
  assert.match(derived[2].text, /readerTableDirectionUnknown/);
});

test('new UI and error strings exist in both locales and executable assets are local', () => {
  const en = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(root, '_locales/zh_CN/messages.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const file of ['popup/popup.html', 'options/options.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) assert.ok(en[match[1]] && zh[match[1]], match[1]);
    for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      assert.ok(!/^https?:/.test(match[1]));
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), match[1])), match[1]);
    }
  }
  for (const file of ['reading/core.js', 'reading/model.js', 'reading/document.js', 'reading/ui.js']) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/new Error\('(reader\w+)'\)/g)) assert.ok(en[match[1]], match[1]);
  }
});
