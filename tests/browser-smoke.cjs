/* Optional browser QA. Install Playwright separately; no build/runtime dependency. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });

const { samplePdf, paper, fixtureHtml } = require('./fixtures.cjs');
let calls = 0;
let responseStatus = 200;
let responseDelay = 0;
const requests = [];

const server = http.createServer(async (request, response) => {
  if (request.url === '/v1/chat/completions') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks));
    requests.push(data); calls++;
    const input = JSON.parse(data.messages[1].content);
    const evidence = input.passages;
    const cited = data.messages[0].content.includes('Answer the question directly')
      ? evidence.find(source => source.location.includes('PDF p.')) || evidence[0]
      : evidence[0];
    const output = { summary: 'A source-linked explanation of the supplied passage.', sections: [
      { title: 'Formula', type: 'paper', text: 'The supplied relationship is $x = y + z$. <img src="invalid" onerror="alert(1)">', sources: [cited.id] },
      { title: 'Background', type: 'background', text: 'For an illustrative example, take $y=1$ and $z=2$.', sources: [] },
      { title: 'Verification', type: 'proposal', text: 'Change one input while holding other conditions fixed.', sources: [] }
    ], followUp: ['Which assumptions need to hold?'] };
    if (input.topic) output.screening = { priority: 'high', tags: ['methods/control'] };
    const status = responseStatus;
    setTimeout(() => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    }, responseDelay);
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Content-Security-Policy': "script-src 'self'; object-src 'self'; worker-src 'self'" });
  fs.createReadStream(file).pipe(response);
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let releaseMetadata;
    const metadataReady = new Promise(resolve => { releaseMetadata = resolve; });
    await context.route('https://**/*', async route => {
      const url = route.request().url();
      if (url.includes('api.semanticscholar.org')) {
        await metadataReady;
        return route.fulfill({ json: { venue: 'Enriched Journal', year: 2026 }, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.includes('/html/')) return route.fulfill({ contentType: 'text/html', body: fixtureHtml, headers: { 'Access-Control-Allow-Origin': '*' } });
      if (url.includes('/pdf/')) return route.fulfill({ contentType: 'application/pdf', body: samplePdf(), headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.abort();
    });
    await context.addInitScript(({ paper, base }) => {
      const event = () => ({ listeners: [], addListener(callback) { this.listeners.push(callback); }, emit(...args) { this.listeners.forEach(callback => callback(...args)); } });
      const load = () => JSON.parse(localStorage.getItem('fixture-storage') || '{}');
      window.__tab = { id: 1, windowId: 1, url: paper.web_url };
      window.__permissionRequests = [];
      window.chrome = {
        i18n: { getUILanguage: () => 'en-US', getMessage: (key, substitutions) => {
          let message = window.__messages?.[key]?.message || '';
          for (const [index, value] of (Array.isArray(substitutions) ? substitutions : substitutions ? [substitutions] : []).entries()) message = message.replaceAll(`$${index + 1}`, value);
          return message;
        } },
        runtime: { getURL: file => `${base}/${file}`, openOptionsPage: () => { window.__settingsOpened = true; },
          sendMessage: async message => { window.__lastSaved = message; return { success: true }; } },
        scripting: { executeScript: async () => {} },
        tabs: { query: async () => [window.__tab], get: async () => window.__tab, onActivated: event(), onUpdated: event(),
          sendMessage: async (id, message) => message.action === 'readingSelection' ? { text: 'The formula is $x = y + z$.', kind: 'selection', url: paper.html_url + '#eq1', locator: 'Equation 1', section: 'Methods' } : structuredClone(paper) },
        permissions: { request: async options => { window.__permissionRequests.push(options); return true; }, contains: async () => true },
        storage: { local: { get: async keys => { const data = load(); if (typeof keys === 'string') return { [keys]: data[keys] }; return data; },
          set: async values => localStorage.setItem('fixture-storage', JSON.stringify({ ...load(), ...values })),
          remove: async key => { const data = load(); delete data[key]; localStorage.setItem('fixture-storage', JSON.stringify(data)); } } }
      };
    }, { paper, base });
    const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json'), 'utf8'));
    await context.addInitScript(value => { window.__messages = value; }, messages);
    const page = await context.newPage();
    await page.goto(`${base}/popup/popup.html`);
    await page.locator('#form:not(.hidden)').waitFor();
    assert.equal(await page.locator('#title').textContent(), paper.title);
    await page.locator('#venue').fill('Manual venue');
    releaseMetadata();
    await page.waitForFunction(() => document.querySelector('#publicationSummary').textContent.includes('Enriched Journal'));
    assert.equal(await page.locator('#venue').inputValue(), 'Manual venue');
    await page.locator('#readerPanel > summary').click();
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Open AI settings'));
    assert.equal(await page.locator('#saveBtn').isEnabled(), true);
    await page.evaluate(async base => chrome.storage.local.set({ readingConfig: { enabled: true, endpoint: base + '/v1', model: 'fixture-model', apiKey: 'fixture-only', language: 'en' } }), base);
    await page.locator('#readerMode').selectOption('qa');
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('before asking about the full text'));
    assert.equal(calls, 0);
    await page.locator('#readerMode').selectOption('overview');

    await page.locator('#readerLoad').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Paper text is ready'));
    await page.locator('#readerSourceSummary').click();
    await page.locator('#readerSources .reading-source').first().waitFor();
    assert.match(await page.locator('#readerSources').textContent(), /x = y \+ z/);
    assert.doesNotMatch(await page.locator('#readerSources').textContent(), /Excluded bibliography/);
    await page.locator('#readerSelection').click();
    await page.waitForFunction(() => document.querySelector('#readerExcerpt').value.includes('x = y + z'));
    await page.locator('#readerMode').selectOption('formula');
    await page.locator('#readerAnalyze').click();
    await page.locator('.reading-result-section').first().waitFor();
    assert.ok(await page.locator('#readerResults .katex').count() > 0);
    assert.equal(await page.locator('#readerResults img').count(), 0);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(requests[0].messages[1].content).passages.length, 1);
    await page.locator('.reading-citation').first().click();
    assert.equal(await page.locator('#readerCitations').getAttribute('open'), '');
    assert.match(await page.locator('#readerCitedSources a').first().getAttribute('href'), /#eq1/);
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('cached analysis'));
    assert.equal(calls, 1);
    await page.locator('#noteInput').fill('My manual research note.');
    const exported = await page.evaluate(() => PaperReadingUI.getExport());
    assert.match(exported, /Reading assistant/);
    assert.match(exported, /Background explanation/);
    assert.match(exported, /#eq1/);
    await page.locator('#readerInclude').uncheck();
    assert.equal(await page.evaluate(() => PaperReadingUI.getExport()), '');
    await page.locator('#readerInclude').check();
    await page.locator('#readerPin').click();
    await page.waitForFunction(() => document.querySelector('#readerJournalStatus').textContent.includes('Added this answer'));
    await page.locator('#readerJournalNotes').fill('My private annotation on the control.');
    await page.locator('#readerSaveNotes').click();
    await page.waitForFunction(() => document.querySelector('#readerJournalStatus').textContent.includes('saved locally'));

    await page.setViewportSize({ width: 320, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(results, 'reading-light.png'), fullPage: true, animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: path.join(results, 'reading-dark.png'), fullPage: true, animations: 'disabled' });

    responseStatus = 429;
    await page.locator('#readerQuestion').fill('A different question');
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('rate or usage limit'));
    assert.equal(await page.locator('#saveBtn').isEnabled(), true);
    responseStatus = 200; responseDelay = 1500;
    await page.locator('#readerQuestion').fill('Cancel this question');
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.startsWith('Analyzing'));
    await page.locator('#readerCancel').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.startsWith('Request cancelled'));
    responseDelay = 0;

    await page.locator('#readerExcerpt').fill('');
    await page.locator('#readerSection').selectOption('table:T2');
    const callsBeforeTable = calls;
    await page.locator('#readerReadTable').click();
    await page.getByText('Calculated from table cells', { exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(results, 'table-comparison.png'), animations: 'disabled' });
    const tableNote = await page.evaluate(() => PaperReadingUI.getExport());
    assert.match(tableNote, /higher in Accuracy \(%\) \/ Dataset A; lower in Accuracy \(%\) \/ Dataset B/);
    assert.match(tableNote, /\+7 percentage points/);
    assert.match(tableNote, /-2 percentage points/);
    assert.match(tableNote, /Five examples per class/);
    assert.match(tableNote, /#new-b/);
    await page.locator('#readerResults summary').filter({ hasText: '-2 percentage points' }).click();
    await page.getByRole('button', { name: /R4C3/ }).click();
    assert.match(await page.locator('#reader-cite-R4C3').textContent(), /Proposed.*Dataset B.*79/s);
    assert.equal(await page.locator('#reader-cite-R4C3').evaluate(node => node === document.activeElement), true);
    await page.locator('#readerTableSecond').selectOption('2');
    await page.locator('#readerReadTable').click();
    await page.getByText(/No directly comparable numeric pair/).waitFor();
    assert.equal(await page.evaluate(() => PaperReadingUI.getExport()), '');
    await page.locator('#readerTableSecond').selectOption('0');
    assert.equal(await page.locator('#readerReadTable').isDisabled(), true);
    assert.equal(calls, callsBeforeTable);
    const fallback = await page.evaluate(() => {
      const extract = inner => PaperReadingExtractor.extractDocument(new DOMParser().parseFromString(
        '<article><table>' + inner + '</table></article>', 'text/html'), 'https://example.org/paper').tables[0];
      const merged = extract('<thead><tr><th>Model</th><th>A</th></tr></thead><tr><td rowspan="2">One</td><td>1</td></tr><tr><td>2</td></tr>');
      const unknown = extract('<tr><td>Blue</td><td>10</td></tr><tr><td>Red</td><td>20</td></tr>');
      return [merged.reason, unknown.reason];
    });
    assert.deepEqual(fallback, ['readerTableLayout', 'readerTableHeaders']);
    await page.locator('#readerSection').selectOption('table:T1');
    await page.locator('#readerMode').selectOption('experiment');
    await page.locator('#readerQuestion').fill('How does the table compare variance?');
    await page.locator('#readerAnalyze').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Analysis is ready'));
    const tableRequest = JSON.parse(requests.at(-1).messages[1].content);
    assert.equal(tableRequest.focus, 'Table 1: Stability');
    assert.ok(tableRequest.passages.some(source => source.text.includes('Group | Variance') &&
      source.text.includes('Treatment | 2.0') && source.text.includes('Lower is better')));
    assert.ok(tableRequest.passages.some(source => source.text.includes('same measurements')));
    assert.doesNotMatch(JSON.stringify(tableRequest), /My private annotation/);
    await page.locator('#readerPin').click();
    await page.waitForFunction(() => document.querySelectorAll('#readerJournalEntries input').length === 2);

    await page.locator('#readerOnlinePdf').click();
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('PDF text is ready'));
    assert.equal(await page.locator('#readerPageNumber').getAttribute('max'), '1');
    await page.locator('#readerFile').setInputFiles({ name: 'example.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Imported: example.pdf'), undefined, { timeout: 15000 });
    await page.locator('#readerExcerpt').fill('');
    await page.waitForFunction(() => document.querySelector('#readerSources').textContent.includes('controlled study'));
    async function analyzeMode(mode) {
      await page.locator('#readerMode').selectOption(mode);
      await page.locator('#readerAnalyze').click();
      await page.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Analysis is ready'));
      return requests.at(-1);
    }
    await page.locator('#readerMode').selectOption('screen');
    await page.locator('#readerTopic').fill('Controlled studies');
    const screening = await analyzeMode('screen');
    assert.equal(JSON.parse(screening.messages[1].content).topic, 'Controlled studies');
    await page.locator('#readerPriority').selectOption('medium');
    await page.locator('#readerSuggestedTags').fill('methods/controls');
    await page.getByRole('button', { name: 'Add to paper tags' }).click();
    assert.match(await page.locator('#tagsContainer').textContent(), /methods\/controls/);
    const screenExport = await page.evaluate(() => PaperReadingUI.getExport());
    assert.match(screenExport, /Reading priority: medium/);
    assert.match(screenExport, /Suggested tags: methods\/controls/);
    const quick = await analyzeMode('quick');
    assert.match(quick.messages[0].content, /Answer in Simplified Chinese/);
    assert.match(quick.messages[0].content, /Source scope: abstract/);
    await page.locator('#readerExcerpt').fill('Focus on $x = y + z$.');
    const explain = await analyzeMode('explain');
    assert.deepEqual(JSON.parse(explain.messages[1].content).passages.map(source => source.id), ['E1']);
    await page.locator('#readerQuestion').fill('How was the controlled study designed?');
    const qa = await analyzeMode('qa');
    assert.ok(JSON.parse(qa.messages[1].content).passages.some(source => source.location.includes('PDF p. 1')));
    assert.match(await page.evaluate(() => PaperReadingUI.getExport()), /PDF p\. 1/);
    await page.locator('.reading-citation').first().click();
    await page.locator('#readerCitations').getByRole('button', { name: 'View PDF page 1' }).click();
    await page.locator('#readerPageView').waitFor();
    assert.ok(await page.locator('#readerPageCanvas').evaluate(canvas => canvas.width > 100));
    await page.locator('#readerQuestion').fill('Which formula is on page one?');
    const pageQa = await analyzeMode('qa');
    const pdfRequest = JSON.parse(pageQa.messages[1].content);
    assert.equal(pdfRequest.focus, 'PDF p. 1');
    assert.ok(pdfRequest.passages.some(source => source.id.startsWith('P1')));
    await page.evaluate(() => { window.__tab = { id: 2, windowId: 1, url: 'https://example.org/other' }; chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 }); });
    assert.equal(await page.locator('#readerAnalyze').isDisabled(), true);
    assert.equal(await page.locator('#readerRefresh').isVisible(), true);
    assert.equal(await page.locator('#saveBtn').isDisabled(), true);
    assert.equal(await page.evaluate(() => PaperReadingUI.getExport()), '');
    await page.evaluate(paper => {
      window.__tab = { id: 1, windowId: 1, url: paper.web_url };
      chrome.tabs.onActivated.emit({ tabId: 1, windowId: 1 });
      chrome.runtime.sendMessage = async () => ({ success: false, error: 'Fixture download error' });
    }, paper);
    await page.locator('#readerRefresh').waitFor({ state: 'hidden' });
    const draft = page.locator('#noteInput');
    assert.equal(await draft.inputValue(), 'My manual research note.');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('Fixture download error'));
    assert.equal(await draft.isVisible(), true);
    assert.equal(await page.locator('#saveBtn').isEnabled(), true);
    await page.evaluate(() => { chrome.runtime.sendMessage = async () => ({ success: true, pdfPending: true }); });
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('PDF download is still in progress'));
    assert.equal(await page.locator('#saveBtn').textContent(), 'Close');

    await page.close();
    const resumed = await context.newPage();
    await resumed.goto(`${base}/popup/popup.html`);
    await resumed.locator('#form:not(.hidden)').waitFor();
    await resumed.locator('#readerPanel > summary').click();
    await resumed.locator('#readerJournal > summary').click();
    await resumed.waitForFunction(() => document.querySelectorAll('#readerJournalEntries input').length === 2);
    assert.equal(await resumed.locator('#readerJournalNotes').inputValue(), 'My private annotation on the control.');
    for (const entry of await resumed.locator('#readerJournalEntries input').all()) await entry.check();
    await resumed.locator('#readerIncludeNotes').check();
    const merged = await resumed.evaluate(() => PaperReadingUI.getExport());
    assert.equal((merged.match(/^### Analysis$/gm) || []).length, 2);
    assert.match(merged, /My private annotation/);
    await resumed.getByRole('button', { name: 'How does the table compare variance?' }).click();
    await resumed.locator('#readerFollow').click();
    await resumed.locator('#readerQuestion').fill('Does the caption define the comparison?');
    await resumed.locator('#readerAnalyze').click();
    await resumed.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('Analysis is ready'));
    const follow = JSON.parse(requests.at(-1).messages[1].content);
    assert.equal(follow.previous.question, 'How does the table compare variance?');
    assert.ok(follow.passages.some(source => source.text.includes('Treatment | 2.0')));
    assert.doesNotMatch(JSON.stringify(follow), /My private annotation/);

    if (process.env.PAPER_FIXTURE_DIR) {
      const fixtureDir = process.env.PAPER_FIXTURE_DIR;
      const html = fs.readFileSync(path.join(fixtureDir, 'mevis.html'), 'utf8');
      const htmlStats = await resumed.evaluate(html => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const { records, tables } = PaperReadingExtractor.extractDocument(parsed, 'https://arxiv.org/html/2512.10945');
        const results = tables.find(table => table.url.endsWith('#S5.T2.19'));
        const comparison = PaperReadingTable.compare(results, 0, 1);
        const mevis = comparison.find(item => item.heading === 'MeViS');
        if (!mevis || mevis.delta !== 3.2 || results.rows[1][mevis.col].anchor !== 'S5.T2.19.3.6') throw new Error('Published MeViS cells do not match');
        return { table: records.some(item => item.format === 'table' && /Table (?:\d+|[IVXLCDM]+)\s*:/i.test(item.locator) && item.text.includes('Row ')),
          math: records.some(item => /\$[^$]+\$/.test(item.text)), sections: new Set(records.map(item => item.section)).size };
      }, html);
      assert.ok(htmlStats.table && htmlStats.math && htmlStats.sections > 3, JSON.stringify(htmlStats));
      const pdf = path.join(fixtureDir, 'microwave-lensing.pdf');
      await resumed.locator('#readerFile').setInputFiles(pdf);
      await resumed.waitForFunction(() => document.querySelector('#readerStatus').textContent.includes('PDF text is ready'), undefined, { timeout: 20000 });
      await resumed.locator('#readerPageNumber').fill('2');
      await resumed.locator('#readerOpenPage').click();
      await resumed.locator('#readerPageView').waitFor();
      assert.match(await resumed.locator('#readerPageCaption').textContent(), /PDF page 2 of/);
      assert.ok(await resumed.locator('#readerPageCanvas').evaluate(canvas => canvas.width > 100));
      console.log('Verified published computer-vision HTML tables and astrophysics PDF page rendering.');
    }

    const settings = await context.newPage();
    await settings.goto(`${base}/options/options.html`);
    await settings.waitForFunction(() => document.querySelector('#readingModel').value === 'fixture-model');
    await settings.locator('#saveSubdir').fill('Papers/Existing');
    await settings.locator('#markdownTemplate').fill('## Note\n{{note}}\nCustom template stays.');
    await settings.locator('#readingEndpoint').fill('http://insecure.example/v1');
    await settings.locator('#saveBtn').click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('HTTPS'));
    await settings.locator('#readingEndpoint').fill(base + '/v1');
    await settings.locator('#saveBtn').click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('successfully'));
    const stored = await settings.evaluate(async () => ({ data: await chrome.storage.local.get(), permissions: window.__permissionRequests }));
    assert.equal(stored.data.saveSubdir, 'Papers/Existing');
    assert.match(stored.data.markdownTemplate, /Custom template stays/);
    assert.deepEqual(stored.permissions.at(-1), { origins: [base + '/*'] });
    await settings.locator('#readingClearCache').click();
    await settings.waitForFunction(() => document.querySelector('#readingSettingsStatus').textContent.includes('cache cleared'));
    assert.equal((await settings.evaluate(() => chrome.storage.local.get('readingCache'))).readingCache, undefined);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browser.version(), assertions: 'passed', modelCalls: calls, realModelCalls: 0,
      coverage: ['metadata and save coexistence', 'optional model setup', 'HTML formula extraction', 'source citations', 'KaTeX under MV3-style CSP', 'cache', 'quota error', 'cancel', 'real PDF.js extraction', 'page changes', 'settings and custom templates', '320px light/dark layout'], screenshots: results }));
    await context.close();
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
