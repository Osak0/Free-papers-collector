(function (root) {
  'use strict';

  function textWithMath(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('math').forEach(math => {
      const tex = math.getAttribute('alttext') || math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) math.replaceWith(clone.ownerDocument.createTextNode(` $${tex}$ `));
    });
    clone.querySelectorAll('script[type^="math/tex"]').forEach(math => math.replaceWith(clone.ownerDocument.createTextNode(` $${math.textContent}$ `)));
    clone.querySelectorAll('script, style, nav, button, .ltx_tag_equation').forEach(node => node.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function extractDocument(doc, url) {
    const article = doc.querySelector('article.ltx_document, article, [role="main"] article, main, [role="main"]');
    if (!article) return { records: [], scope: 'page' };
    let section = '';
    const records = [];
    const seen = new Set();
    const selector = 'h1,h2,h3,h4,p,li,table,figure,.ltx_equation,.ltx_eqn_table';
    for (const element of article.querySelectorAll(selector)) {
      if (element.closest('nav, aside, footer, .ltx_bibliography, .references, [role="navigation"]')) continue;
      if (/^H[1-4]$/.test(element.tagName)) { section = textWithMath(element); continue; }
      // Keep one copy of nested paragraphs, equations, captions, and table cells.
      if (element.parentElement?.closest('p,li,table,figure,.ltx_equation,.ltx_eqn_table')) continue;
      const text = textWithMath(element);
      if (text.length < 8 || seen.has(text)) continue;
      seen.add(text);
      const anchor = element.id || element.closest('[id]')?.id;
      const sourceUrl = new URL(url);
      sourceUrl.hash = anchor || '';
      records.push({ text, section, locator: section, url: sourceUrl.href, kind: 'paper' });
      if (records.length >= 500) break;
    }
    return { records, scope: 'page' };
  }

  function selectionRecord(doc, url) {
    const selection = doc.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
    const element = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const container = doc.createElement('div');
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const formula = common?.closest('math');
    container.append(formula ? formula.cloneNode(true) : range.cloneContents());
    const text = textWithMath(container).slice(0, 12000);
    if (!text) return null;
    const sourceUrl = new URL(url);
    sourceUrl.hash = element?.closest('[id]')?.id || '';
    return { text, url: sourceUrl.href, kind: 'selection', locator: 'Selected passage', section: '' };
  }

  root.PaperReadingExtractor = { extractDocument, selectionRecord, textWithMath };
})(globalThis);
