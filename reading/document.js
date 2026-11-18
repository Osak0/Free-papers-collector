(function (root) {
  'use strict';
  const R = root.PaperReading;
  const MAX_BYTES = 25 * 1024 * 1024;
  let pdfModule;

  async function fetchBytes(url, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 45000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('readerSourceFailed');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('readerFileTooLarge');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('readerFileTooLarge'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, url: response.url, type: response.headers.get('content-type') || '' };
    } catch (error) {
      if (signal?.aborted) throw new Error('readerCancelled');
      if (controller.signal.aborted) throw new Error('readerSourceTimeout');
      if (/^reader[A-Z]/.test(error.message)) throw error;
      throw new Error('readerSourceFailed');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async function openPdf(bytes, signal, work) {
    if (bytes.byteLength > MAX_BYTES) throw new Error('readerFileTooLarge');
    pdfModule ||= await import(chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
    pdfModule.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
    const task = pdfModule.getDocument({ data: bytes.slice(), cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
      cMapPacked: true, isEvalSupported: false, useWasm: false, disableFontFace: true, useSystemFonts: true });
    const abort = () => { void task.destroy().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) throw new Error('readerCancelled');
      return await work(await task.promise);
    } catch (error) {
      if (signal?.aborted) throw new Error('readerCancelled');
      if (/^reader[A-Z]/.test(error.message)) throw error;
      throw new Error('readerPdfFailed');
    } finally {
      signal?.removeEventListener('abort', abort);
      await task.destroy().catch(() => {});
    }
  }

  async function pageRecord(page, document) {
    const content = await page.getTextContent();
    const text = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
    const { pageNumber } = page;
    const locator = [document.name, `PDF p. ${pageNumber}`].filter(Boolean).join(' · ');
    return { text, locator, section: locator, page: pageNumber, pdfId: document.id,
      url: document.url ? `${document.url.split('#')[0]}#page=${pageNumber}` : '', kind: 'paper' };
  }

  async function readPdf(bytes, url, signal, onProgress = () => {}, name = '') {
    return openPdf(bytes, signal, async pdf => {
      const pdfDocument = { bytes, url, name: name.slice(0, 120), pageCount: pdf.numPages, id: pdf.fingerprints.join(':') };
      const records = [];
      let characters = 0;
      const pages = Math.min(pdf.numPages, 120);
      for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
        if (signal?.aborted) throw new Error('readerCancelled');
        onProgress(pageNumber, pages);
        const page = await pdf.getPage(pageNumber);
        const record = await pageRecord(page, pdfDocument);
        records.push(record);
        characters += record.text.length;
        page.cleanup();
        if (characters >= 240000) break;
      }
      const result = R.makeSources(records);
      return { ...result, pdfDocument, scope: 'pdf-text', truncated: result.truncated || pdf.numPages > pages || characters >= 240000 };
    });
  }

  async function readPdfPage(pdfDocument, pageNumber, canvas, signal) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.pageCount) throw new Error('readerPageInvalid');
    return openPdf(pdfDocument.bytes, signal, async pdf => {
      const page = await pdf.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.6, 1100 / Math.max(original.width, original.height)) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const [record] = await Promise.all([pageRecord(page, pdfDocument), page.render({ canvas, viewport }).promise]);
      return R.makeSources([record]).sources.map(source => ({ ...source, id: `P${pageNumber}${source.id}` }));
    });
  }

  async function loadPaper(paper, tabId, signal, onProgress) {
    const htmlUrl = R.safeSourceUrl(paper.html_url);
    const pdfUrl = R.safeSourceUrl(paper.pdf_url);
    let pdfError;
    if (htmlUrl) {
      try {
        const resource = await fetchBytes(htmlUrl, signal);
        if (!resource.type.includes('pdf')) {
          const doc = new DOMParser().parseFromString(new TextDecoder().decode(resource.bytes), 'text/html');
          const extracted = root.PaperReadingExtractor.extractDocument(doc, resource.url);
          const result = R.makeSources(extracted.records);
          if (result.characters > 800) return { ...result, scope: 'html-text' };
        }
      } catch (error) { if (signal?.aborted) throw error; }
    }
    if (pdfUrl) {
      try {
        return await loadPdf(pdfUrl, signal, onProgress);
      } catch (error) {
        if (signal?.aborted) throw error;
        pdfError = error;
      }
    }
    const extracted = await chrome.tabs.sendMessage(tabId, { action: 'readingExtract' }).catch(() => null);
    const result = R.makeSources(extracted?.records || []);
    if (pdfError && (extracted?.scope === 'abstract' || result.characters < 800)) throw pdfError;
    if (!result.sources.length) throw new Error('readerNoText');
    return { ...result, scope: extracted.scope || 'page' };
  }

  async function loadPdf(url, signal, onProgress) {
    const resource = await fetchBytes(url, signal);
    if (!new TextDecoder('ascii').decode(resource.bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('readerPdfFailed');
    return readPdf(resource.bytes, resource.url, signal, onProgress);
  }

  root.PaperReadingDocument = { loadPaper, loadPdf, readPdf, readPdfPage };
})(globalThis);
