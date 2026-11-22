(function (root) {
  'use strict';

  const units = '%|％|ms|µs|ns|s|mm|cm|km|m|mg|kg|g|mL|L|Hz|kHz|MHz|GHz|W|kW|K|°C|mV|V';
  const printedNumber = new RegExp(`^([+−-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*(${units})?$`);
  const headerUnit = new RegExp(`[（(\\[]\\s*(${units})\\s*[）)\\]]`, 'g');

  function scalar(cell) {
    if (cell.annotated) return null;
    const match = printedNumber.exec(cell.text);
    if (!match || match[1].replace(/\D/g, '').length > 12) return null;
    return { value: Number(match[1].replace('−', '-')), decimals: (match[1].split('.')[1] || '').length, unit: (match[2] || '').replace('％', '%') };
  }

  function compare(table, first, second) {
    if (first === second || !table.rows?.[first] || !table.rows[second]) return [];
    const comparisons = [];
    for (let col = 1; col < table.columns.length; col++) {
      const heading = table.columns[col];
      if (/^(year|id|rank|年份|编号)$/i.test(heading)) continue;
      const a = scalar(table.rows[first][col]);
      const b = scalar(table.rows[second][col]);
      if (!a || !b || a.unit !== b.unit) continue;
      const delta = Number((b.value - a.value).toFixed(Math.max(a.decimals, b.decimals)));
      // A bare number under an ordinary header stays in the column's printed scale.
      const markedUnits = new Set(Array.from(heading.matchAll(headerUnit), match => match[1].replace('％', '%')));
      if (/(?:^|\s)[%％](?:\s|$)/.test(heading)) markedUnits.add('%');
      if (markedUnits.size > 1 || a.unit && markedUnits.size && !markedUnits.has(a.unit)) continue;
      const unit = a.unit || [...markedUnits][0] || '';
      comparisons.push({ col, heading, delta, unit, percent: unit === '%' });
    }
    return comparisons;
  }

  function reportFor(table, first, second, t) {
    const values = compare(table, first, second);
    if (!values.length) throw new Error('readerTableNoValues');
    const rowLabel = index => t('readerTableRow', [String(table.rows[index][0].rowNumber), table.rows[index][0].text]);
    const duplicate = table.rows[first][0].text === table.rows[second][0].text;
    const rowNames = [first, second].map(i => duplicate ? rowLabel(i) : table.rows[i][0].text);
    const shown = values.slice(0, 6);
    const higher = values.find(item => item.delta > 0);
    const lower = values.find(item => item.delta < 0);
    const lead = higher && lower && !values[0].delta ? higher : values[0];
    const opposite = higher && lower ? (lead.delta > 0 ? lower : higher) : undefined;
    const other = opposite || values.find(item => Math.sign(item.delta) !== Math.sign(lead.delta));
    if (!shown.includes(lead)) shown[0] = lead;
    if (other && !shown.includes(other)) shown[shown.length - 1] = other;
    const sections = [];
    const sources = [];
    function cite(id, locator, text, anchor) {
      const url = new URL(table.url);
      if (anchor) url.hash = anchor;
      sources.push({ id, kind: 'paper', locator, text, url: url.href });
      return id;
    }
    // Preserve non-numeric settings (e.g. input length) alongside the printed caption and notes.
    const contextLines = [table.caption, table.notes];
    for (const index of [first, second]) {
      const settings = table.columns.flatMap((name, col) => col && !values.some(item => item.col === col) ?
        [`${name}: ${table.rows[index][col].text || '—'}`] : []);
      if (settings.length) contextLines.push(`${rowLabel(index)} · ${settings.join(' | ')}`);
    }
    const conditions = contextLines.filter(Boolean).join('\n');
    if (conditions) {
      sections.push({ type: 'paper', title: t('readerTableConditions'), text: conditions,
        sources: [cite('T0', table.locator, conditions)] });
    }
    const relation = item => t(item.delta > 0 ? 'readerTableAbove' : item.delta < 0 ? 'readerTableBelow' : 'readerTableEqual', [item.heading]);
    const summary = t('readerTableFinding', [rowNames[1], rowNames[0], [lead, ...(other ? [other] : [])].map(relation).join(t('readerTableJoin'))]);
    for (const { col, heading, delta, unit, percent } of shown) {
      const refs = [first, second].map(index => {
        const cell = table.rows[index][col];
        const location = t('readerTableCell', [String(table.rows[index][0].rowNumber), String(col + 1), table.rows[index][0].text, heading]);
        return cite(`R${table.rows[index][0].rowNumber}C${col + 1}`, location, `${location} · ${cell.text}`, cell.anchor);
      });
      const difference = String(delta > 0 ? '+' + delta : delta);
      const amount = percent ? t('readerTablePoints', [difference]) : [difference, unit].filter(Boolean).join(' ');
      const raw = [first, second].map((index, i) => `${rowNames[i]} · ${table.rows[index][col].text}`);
      const calculation = t('readerTableDifference', [amount]);
      const higherPreferred = /↑|\bhigher is better\b|越高越好/i.test(heading);
      const lowerPreferred = /↓|\blower is better\b|越低越好/i.test(heading);
      const guidance = [];
      if (delta && higherPreferred !== lowerPreferred) {
        guidance.push(t('readerTableFavors', [(delta > 0) === higherPreferred ? rowNames[1] : rowNames[0]]));
      } else if (higherPreferred === lowerPreferred) guidance.push(t('readerTableDirectionUnknown'));
      if (!unit) guidance.push(t('readerTablePrintedScale'));
      sections.push({ type: 'derived', title: heading, calculation, operands: raw, guidance,
        text: [...raw, calculation, ...guidance].join('\n'), sources: refs });
    }
    const limits = [t(higher && lower ? 'readerTableMixedLimit' : 'readerTableScopeLimit'), t('readerTableCheck')];
    if (values.length > shown.length) limits.push(t('readerTableCoverage', [String(shown.length), String(values.length)]));
    sections.push({ type: 'unknown', title: t('readerTableLimits'), text: limits.join('\n'), sources: [] });
    return { analysis: { summary, sections, followUp: [] }, context: { scope: 'html-table', focus: table.locator, sources,
      characters: sources.reduce((n, source) => n + source.text.length, 0), omitted: 0 } };
  }

  const api = { compare, reportFor };
  root.PaperReadingTable = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
