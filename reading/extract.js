(function (root) {
  'use strict';

  function textWithMath(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('math').forEach(math => {
      const tex = math.getAttribute('alttext') || math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex) math.replaceWith(clone.ownerDocument.createTextNode(` $${tex}$ `));
    });
    clone.querySelectorAll('script[type^="math/tex"]').forEach(math => math.replaceWith(clone.ownerDocument.createTextNode(` $${math.textContent}$ `)));
    clone.querySelectorAll('script, style, nav, button').forEach(node => node.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function tablePassages(table) {
    const rows = Array.from(table.rows).filter(row => row.closest('table') === table);
    const rowText = row => Array.from(row.cells, cell => {
      const spans = [];
      if (cell.colSpan > 1) spans.push(`columns: ${cell.colSpan}`);
      if (cell.rowSpan !== 1) spans.push(`row span: ${cell.rowSpan || 'to end of group'}`);
      return `${textWithMath(cell)}${spans.length ? ` [${spans.join(', ')}]` : ''}`;
    }).join(' | ');
    const caption = table.caption || table.closest('figure')?.querySelector('figcaption');
    const captionText = caption ? textWithMath(caption) : '';
    const headers = rows.filter(row => row.parentElement.tagName === 'THEAD');
    if (!headers.length && rows[0]?.cells.length && Array.from(rows[0].cells).every(cell => cell.tagName === 'TH')) headers.push(rows[0]);
    const header = [captionText, ...headers.map(row => `Header | ${rowText(row)}`)].filter(Boolean).join('\n');
    const notes = Array.from(table.querySelectorAll('tfoot'), textWithMath);
    const figure = table.closest('figure');
    if (figure) notes.push(...Array.from(figure.querySelectorAll('.ltx_tabnote, .table-note'), textWithMath));
    const body = rows.filter(row => !headers.includes(row) && row.parentElement.tagName !== 'TFOOT');
    const passages = [];
    let lines = [];
    let length = header.length;
    const flush = () => {
      if (!lines.length) return;
      passages.push([header, ...lines].filter(Boolean).join('\n'));
      lines = [];
      length = header.length;
    };
    for (const [index, row] of body.entries()) {
      const line = `Row ${index + 1} | ${rowText(row)}`;
      if (lines.length && length + line.length > 1160) flush();
      lines.push(line);
      length += line.length + 1;
    }
    if (notes.length) {
      if (length + notes.join(' ').length > 1160) flush();
      lines.push(`Table notes | ${notes.join(' ')}`);
    }
    flush();
    return passages.length ? passages : [header || textWithMath(table)];
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
      const parent = element.parentElement?.closest('p,li,table,figure,.ltx_equation,.ltx_eqn_table');
      if (parent && !(element.tagName === 'TABLE' && parent.tagName === 'FIGURE')) continue;
      if (element.tagName === 'FIGURE' && element.querySelector('table')) continue;
      const anchor = element.id || element.closest('[id]')?.id;
      const sourceUrl = new URL(url);
      sourceUrl.hash = anchor || '';
      const isTable = element.tagName === 'TABLE' && !element.matches('.ltx_equation, .ltx_eqn_table, [role="presentation"]');
      const caption = isTable && (element.caption || element.closest('figure')?.querySelector('figcaption'));
      const locator = caption ? textWithMath(caption) : isTable ? `Table · ${section || anchor || records.length + 1}` : section;
      for (const text of isTable ? tablePassages(element) : [textWithMath(element)]) {
        const key = `${sourceUrl.hash}\n${text}`;
        if (text.length < 8 || seen.has(key)) continue;
        seen.add(key);
        records.push({ text, section, locator, url: sourceUrl.href, kind: 'paper', format: isTable ? 'table' : undefined });
        if (records.length >= 500) break;
      }
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
