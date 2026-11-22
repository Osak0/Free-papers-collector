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

  function tableParts(table) {
    const rows = Array.from(table.rows).filter(row => row.closest('table') === table);
    const figure = table.closest('figure');
    const caption = table.caption || figure?.querySelector('figcaption');
    const noteNodes = new Set(Array.from(table.tFoot?.rows || []));
    const wrapper = figure || table.closest('.table-wrap');
    wrapper?.querySelectorAll('.ltx_tabnote, .table-note, .table-wrap-foot').forEach(node => noteNodes.add(node));
    const noteIds = (table.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    for (const link of table.querySelectorAll('sup a[href^="#"], a[role="doc-noteref"][href^="#"]')) noteIds.push(link.getAttribute('href').slice(1));
    for (const id of noteIds) {
      const note = table.ownerDocument.getElementById(id);
      if (note && note !== caption) noteNodes.add(note);
    }
    const notes = [...noteNodes].map(node => node.tagName === 'TR' ? Array.from(node.cells, textWithMath).join(' | ') : textWithMath(node));
    const headers = rows.filter(row => row.parentElement.tagName === 'THEAD');
    const body = rows.filter(row => !headers.includes(row) && row.parentElement.tagName !== 'TFOOT');
    while (!table.tHead && body[0]?.cells.length && Array.from(body[0].cells).every(cell => cell.tagName === 'TH' && cell.scope !== 'row')) {
      headers.push(body.shift());
    }
    // Some arXiv result tables use td throughout, with an explicit label for the row-name column.
    if (!headers.length && body[0] && /^(methods?|models?|datasets?|approach(es)?|groups?|方法|模型|数据集|组别)$/i.test(textWithMath(body[0].cells[0] || body[0]))) {
      headers.push(body.shift());
    }
    return { caption: caption ? textWithMath(caption) : '', headers, body, notes: [...new Set(notes.filter(Boolean))].join('\n') };
  }

  function tablePassages(table, { caption, headers, body, notes }) {
    const rowText = row => Array.from(row.cells, cell => {
      const spans = [];
      if (cell.colSpan > 1) spans.push(`columns: ${cell.colSpan}`);
      if (cell.rowSpan !== 1) spans.push(`row span: ${cell.rowSpan || 'to end of group'}`);
      return `${textWithMath(cell)}${spans.length ? ` [${spans.join(', ')}]` : ''}`;
    }).join(' | ');
    const header = [caption, ...headers.map(row => `Header | ${rowText(row)}`)].filter(Boolean).join('\n');
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
      if (length + notes.length > 1160) flush();
      lines.push(`Table notes | ${notes}`);
    }
    flush();
    return passages.length ? passages : [header || textWithMath(table)];
  }

  function gridForComparison(table, { headers, body, caption, notes }, budget) {
    const unavailable = reason => ({ reason });
    if (!headers.length) return unavailable('readerTableHeaders');
    if (headers.length > 6 || body.length > 120 || caption.length + notes.length > 3600) return unavailable('readerTableSize');
    if (body.length < 2) return unavailable('readerTableRows');
    const width = body[0].cells.length;
    if (width > 32 || width * body.length > 1000) return unavailable('readerTableSize');
    if (width < 2 || table.querySelector('table, [headers]') || body.some(row => row.cells.length !== width ||
      Array.from(row.cells).some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1))) return unavailable('readerTableLayout');
    // Expand header spans only when each coordinate has one unambiguous header path.
    const grid = headers.map(() => Array(width).fill(null));
    for (const [r, row] of headers.entries()) {
      let c = 0;
      for (const cell of row.cells) {
        while (c < width && grid[r][c] !== null) c++;
        const end = r + (cell.rowSpan || headers.length - r);
        if (end > headers.length || c + cell.colSpan > width) return unavailable('readerTableLayout');
        const label = textWithMath(cell);
        for (let y = r; y < end; y++) {
          for (let x = c; x < c + cell.colSpan; x++) {
            if (grid[y][x] !== null) return unavailable('readerTableLayout');
            grid[y][x] = label;
          }
        }
        c += cell.colSpan;
      }
    }
    if (grid.some(row => row.includes(null))) return unavailable('readerTableLayout');
    const columns = grid[0].map((_, col) => [...new Set(grid.map(row => row[col]).filter(Boolean))].join(' / '));
    if (columns.some(title => title.length > 160)) return unavailable('readerTableSize');
    if (columns.slice(1).some(title => !title) || new Set(columns.slice(1)).size !== width - 1) return unavailable('readerTableHeaders');
    let size = columns.join('').length + caption.length + notes.length;
    const rows = [];
    for (const row of body) {
      const cells = Array.from(row.cells, cell => {
        const text = textWithMath(cell);
        const anchor = cell.id || row.id || '';
        size += text.length + anchor.length + 12;
        return { text, anchor, annotated: Boolean(cell.querySelector('sup, sub, math, a, .ltx_sup, .ltx_sub')) };
      });
      if (size > budget || cells.some(cell => cell.text.length > 320)) return unavailable('readerTableSize');
      if (!cells[0].text) return unavailable('readerTableRows');
      cells[0].rowNumber = row.rowIndex + 1;
      rows.push(cells);
    }
    return { columns, rows, caption, notes, size };
  }

  function extractDocument(doc, url) {
    const article = doc.querySelector('article.ltx_document, article, [role="main"] article, main, [role="main"]');
    if (!article) return { records: [], scope: 'page' };
    let section = '';
    const records = [];
    const tables = [];
    let tableBudget = 160000;
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
      const parts = isTable && tableParts(element);
      const tableId = isTable ? `T${tables.length + 1}` : '';
      const locator = isTable ? parts.caption || `Table ${tables.length + 1} · ${section || anchor || ''}` : section;
      if (isTable) {
        const grid = gridForComparison(element, parts, Math.min(tableBudget, 32000));
        tableBudget -= grid.size || 0;
        tables.push({ id: tableId, locator: locator.slice(0, 180), url: sourceUrl.href, ...grid });
      }
      for (const text of isTable ? tablePassages(element, parts) : [textWithMath(element)]) {
        const key = `${tableId}\n${sourceUrl.hash}\n${text}`;
        if (text.length < 8 || seen.has(key)) continue;
        seen.add(key);
        records.push({ text, section, locator, url: sourceUrl.href, kind: 'paper', ...(isTable ? { format: 'table', tableId } : {}) });
        if (records.length >= 500) break;
      }
      if (records.length >= 500) break;
    }
    return { records, tables, scope: 'page' };
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
