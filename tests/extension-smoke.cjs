/* Optional native MV3 QA. Uses a new, isolated profile and synthetic paper data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { samplePdf, paper, fixtureHtml } = require('./fixtures.cjs');
const root = path.resolve(process.env.EXTENSION_ROOT || path.join(__dirname, '..'));
const results = path.resolve(__dirname, '../test-results');
fs.mkdirSync(results, { recursive: true });
const profile = fs.mkdtempSync(path.join(results, 'native-profile-'));
const downloads = fs.mkdtempSync(path.join(results, 'native-downloads-'));

async function main() {
  const context = await chromium.launchPersistentContext(profile, { headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--enable-extensions'] });
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    await context.route('https://**/*', route => {
      const url = route.request().url();
      if (url.includes('/abs/')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="citation_title" content="${paper.title}"><meta name="citation_author" content="A. Researcher"><meta name="citation_date" content="2026/01/01"><meta name="citation_abstract" content="${paper.abstract}"></head><body><blockquote class="abstract">${paper.abstract}</blockquote></body></html>` });
      if (url.includes('/html/')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="citation_title" content="${paper.title}"></head><body>${fixtureHtml}</body></html>`, headers: { 'Access-Control-Allow-Origin': '*' } });
      if (url.includes('api.semanticscholar.org')) return route.fulfill({ json: { venue: 'Example Journal', year: 2026 }, headers: { 'Access-Control-Allow-Origin': '*' } });
      return route.abort();
    });
    const paperPage = await context.newPage();
    await paperPage.goto(paper.web_url);
    const popup = await context.newPage();
    await paperPage.bringToFront();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.locator('#form:not(.hidden)').waitFor();
    assert.equal(await popup.locator('#title').textContent(), paper.title);
    const worker = context.serviceWorkers().find(item => item.url().startsWith(`chrome-extension://${id}/`)) || await context.waitForEvent('serviceworker');
    assert.equal(await worker.evaluate(() => typeof handleSave), 'function');
    assert.equal(await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://unconfigured-model.example/*'] })), false);
    assert.equal(await worker.evaluate(async () => !!(await chrome.storage.local.get('readingConfig')).readingConfig?.enabled), false);
    await popup.locator('#readerPanel > summary').click();
    await popup.locator('#readerLoad').click();
    await popup.waitForFunction(() => {
      const status = document.querySelector('#readerStatus');
      if (status.classList.contains('reading-error')) throw new Error(status.textContent);
      return status.textContent === chrome.i18n.getMessage('readerTextReady');
    });
    await popup.locator('#readerSourceSummary').click();
    await popup.locator('#readerSources .reading-source').first().waitFor();
    assert.match(await popup.locator('#readerSources').textContent(), /x = y \+ z/);
    assert.equal(await popup.locator('#saveBtn').isEnabled(), true);

    // Exercise the content script and MathML-to-TeX selection on a real paper tab.
    await paperPage.goto(paper.html_url);
    await paperPage.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('math'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    const selection = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return chrome.tabs.sendMessage(tab.id, { action: 'readingSelection' });
    });
    assert.equal(selection.text, '$x = y + z$');
    assert.match(selection.url, /#eq1/);

    const pdfText = await popup.evaluate(async bytes => {
      const doc = await PaperReadingDocument.readPdf(new Uint8Array(bytes), '', new AbortController().signal);
      return { scope: doc.scope, text: doc.sources.map(source => source.text).join(' ') };
    }, [...samplePdf()]);
    assert.equal(pdfText.scope, 'pdf-text');
    assert.match(pdfText.text, /controlled study/);
    assert.equal(await popup.evaluate(() => {
      const node = document.createElement('div'); node.textContent = '$x = y + z$'; document.body.append(node);
      renderMathInElement(node, { trust: false, delimiters: [{ left: '$', right: '$', display: false }] });
      return !!node.querySelector('.katex');
    }), true);

    // Save through the actual background worker/downloads API, with notifications silenced in this test profile.
    await worker.evaluate(async paper => {
      chrome.notifications.create = async () => '';
      await chrome.storage.local.set({ saveSubdir: 'Papers/Test', filenameRule: '{{first_author}}_{{year}}',
        markdownTemplate: '# {{title}}\n## Note\n{{note}}\n{{reading_assistant}}' });
      return handleSave({ ...paper, note: 'Native manual note.', reading_assistant: '## Reading assistant\nNative analysis export.' }, [], false, { downloadPdf: false });
    }, paper);
    let saved;
    for (let attempt = 0; attempt < 30; attempt++) {
      const items = await worker.evaluate(() => chrome.downloads.search({ limit: 5, orderBy: ['-startTime'] }));
      saved = items.find(item => item.state === 'complete' && item.filename.endsWith('.md'));
      if (saved) break;
      await delay(100);
    }
    assert.ok(saved, 'Native Markdown download completed');
    assert.ok(path.resolve(saved.filename).startsWith(downloads + path.sep), saved.filename);
    const markdown = fs.readFileSync(saved.filename, 'utf8');
    assert.match(markdown, /Native manual note/);
    assert.match(markdown, /Native analysis export/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ nativeExtension: id, browser: context.browser().version(), assertions: 'passed',
      coverage: ['native manifest and service worker', 'optional origins remain ungranted', 'AI disabled by default', 'content-script metadata', 'HTML full text', 'MathML selection', 'local PDF worker under actual MV3 CSP', 'local math renderer', 'actual Markdown download and manual-note preservation'], extensionRoot: root, download: saved.filename }));
  } finally { await context.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
