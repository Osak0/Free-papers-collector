/* Shared, dependency-free helpers. Also usable with node:test. */
(function (root) {
  'use strict';

  const MODES = ['overview', 'screen', 'quick', 'explain', 'qa', 'method', 'formula', 'experiment', 'learning', 'research'];
  const MAX_CONTEXT = 24000;
  const MAX_DOCUMENT = 240000;
  const DEFAULT_CONFIG = { enabled: false, endpoint: '', model: '', apiKey: '', language: 'auto' };
  const MODE_HINTS = {
    overview: /abstract|introduction|conclusion|discussion|摘要|引言|结论/i,
    method: /method|approach|algorithm|procedure|framework|assumption|方法|过程|假设/i,
    formula: /equation|theorem|proof|deriv|notation|model|公式|定理|证明|推导|\$|[∑∫∂∇=]/i,
    experiment: /experiment|evaluation|result|ablation|baseline|dataset|participant|measure|实验|结果|数据|评估/i,
    learning: /background|preliminar|definition|theory|introduction|背景|基础|定义|理论/i,
    research: /limitation|discussion|future|conclusion|method|局限|讨论|展望|方法/i
  };

  function cleanText(value) {
    return String(value || '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function endpointInfo(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw new Error('readerInvalidEndpoint'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash) throw new Error('readerInvalidEndpoint');
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
    return { url: url.href, origin: `${url.origin}/*` };
  }

  function normalizeConfig(value = {}) {
    const config = { ...DEFAULT_CONFIG, ...value };
    config.enabled = config.enabled === true;
    config.endpoint = String(config.endpoint || '').trim();
    config.model = String(config.model || '').trim().slice(0, 160);
    config.apiKey = String(config.apiKey || '').trim();
    if (!['auto', 'en', 'zh_CN'].includes(config.language)) config.language = 'auto';
    if (config.enabled) {
      endpointInfo(config.endpoint);
      if (!config.model) throw new Error('readerMissingModel');
    }
    return config;
  }

  function paperKey(paper = {}) {
    const arxiv = String(paper.arxiv_id || '').replace(/v\d+$/, '');
    const identity = arxiv ? `arxiv:${arxiv}` : (paper.doi ? `doi:${String(paper.doi).toLowerCase()}` : paper.web_url || paper.title || '');
    const version = paper.arxiv_version || String(paper.arxiv_id || '').match(/v\d+$/)?.[0] || '';
    return `${identity}|${version}`;
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function makeSources(records) {
    const sources = [];
    let total = 0;
    let truncated = false;
    for (const record of records) {
      const text = cleanText(record.text);
      if (!text) continue;
      for (let offset = 0; offset < text.length; offset += 1400) {
        if (total >= MAX_DOCUMENT || sources.length >= 240) { truncated = true; break; }
        const part = text.slice(offset, Math.min(offset + 1400, offset + MAX_DOCUMENT - total));
        sources.push({ id: `S${sources.length + 1}`, text: part, section: cleanText(record.section).slice(0, 180),
          locator: cleanText(record.locator).slice(0, 180), url: safeSourceUrl(record.url), kind: record.kind || 'paper' });
        total += part.length;
      }
      if (truncated) break;
    }
    return { sources, truncated, characters: total };
  }

  function selectContext(document, mode = 'overview', question = '', excerpt = '') {
    const sources = document?.sources || [];
    const query = cleanText(question).toLowerCase();
    const words = new Set(query.match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 2 && !/^\p{Script=Han}+$/u.test(word)) || []);
    for (const phrase of query.match(/\p{Script=Han}{2,}/gu) || []) {
      for (let i = 0; i < phrase.length - 1; i++) words.add(phrase.slice(i, i + 2));
    }
    const terms = [...words].slice(0, 96);
    const hint = MODE_HINTS[mode] || MODE_HINTS.overview;
    const ranked = sources.map((source, index) => {
      let score = mode !== 'qa' && hint.test(source.section) ? 12 : 0;
      if (hint.test(source.text)) score += 3;
      if (terms.length) {
        const searchable = `${source.section} ${source.text}`.toLowerCase();
        for (const term of terms) if (searchable.includes(term)) score += 5;
      }
      if (index === 0 || index === sources.length - 1) score += 2;
      return { source, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen = [];
    let characters = 0;
    const provided = cleanText(excerpt).slice(0, 12000);
    if (provided) {
      const match = sources.find(source => source.text.includes(provided));
      chosen.push({ id: 'E1', text: provided, section: match?.section || '', locator: match?.locator || '',
        url: match?.url || '', kind: match ? 'selection' : 'provided' });
      characters = provided.length;
    }
    // Include high-scoring passages, with a few evenly spaced passages for broad context.
    const coverage = sources.length > 8 ? [0, Math.floor(sources.length / 3), Math.floor(2 * sources.length / 3), sources.length - 1] : [];
    const candidates = [...coverage.map(index => ({ source: sources[index], index })), ...ranked];
    const seen = new Set();
    const selected = [];
    for (const { source, index } of candidates) {
      if (seen.has(index) || characters + source.text.length > MAX_CONTEXT) continue;
      seen.add(index);
      selected.push({ source, index });
      characters += source.text.length;
    }
    selected.sort((a, b) => a.index - b.index).forEach(item => chosen.push(item.source));
    return { sources: chosen, characters, omitted: Math.max(0, sources.length - selected.length),
      scope: provided ? (sources.length ? `${document.scope}+excerpt` : 'provided') : document?.scope || 'abstract' };
  }

  function parseAnalysis(raw, sources, mode) {
    if (typeof raw !== 'string' || raw.length > 80000) throw new Error('readerInvalidResponse');
    let result;
    try { result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new Error('readerInvalidResponse'); }
    if (!result || typeof result.summary !== 'string' || !Array.isArray(result.sections) || !result.sections.length || result.sections.length > 12) {
      throw new Error('readerInvalidResponse');
    }
    const ids = new Set(sources.map(source => source.id));
    const sections = result.sections.map(section => {
      if (!section || !['paper', 'background', 'proposal', 'unknown'].includes(section.type) ||
          typeof section.title !== 'string' || typeof section.text !== 'string' || !section.text.trim()) throw new Error('readerInvalidResponse');
      const citations = Array.isArray(section.sources) ? [...new Set(section.sources)] : [];
      if (citations.some(id => !ids.has(id)) || (section.type === 'paper' && !citations.length)) throw new Error('readerInvalidCitations');
      return { title: section.title.slice(0, 180), type: section.type, text: section.text.slice(0, 4000), sources: citations };
    });
    const analysis = { summary: result.summary.slice(0, 2000), sections,
      followUp: (Array.isArray(result.followUp) ? result.followUp : []).filter(item => typeof item === 'string').slice(0, 6).map(item => item.slice(0, 500)) };
    if (mode === 'screen') {
      const screening = result.screening;
      if (!screening || !['high', 'medium', 'low', 'uncertain'].includes(screening.priority) || !Array.isArray(screening.tags)) {
        throw new Error('readerInvalidResponse');
      }
      analysis.screening = { priority: screening.priority, tags: normalizeSuggestedTags(screening.tags) };
    }
    return analysis;
  }

  function normalizeSuggestedTags(tags) {
    return [...new Set(tags.filter(tag => typeof tag === 'string').map(tag => tag.trim().replace(/^#/, ''))
      .filter(tag => tag.length <= 60 && /^[\p{L}\p{N}_/-]+$/u.test(tag) && /[\p{L}_-]/u.test(tag)))].slice(0, 8);
  }

  async function fingerprint(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function noteText(value) {
    // Preserve math while keeping model/source HTML and image embeds inert in Markdown exports.
    return String(value || '').split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g).map((part, index) => index % 2 ? part :
      part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/!\[/g, '\\![')).join('');
  }

  function formatReport(report) {
    const labels = { paper: 'Paper evidence', background: 'Background explanation', proposal: 'Proposal to validate', unknown: 'Not established by the supplied text' };
    const lines = ['## Reading assistant', '', `- Mode: ${noteText(report.mode)}`, `- Model: ${noteText(report.model)}`, `- Generated: ${report.createdAt}`,
      `- Source scope: ${report.context.scope}; ${report.context.sources.length} passages; ${report.context.omitted} passages omitted`,
      `- Paper/version: ${noteText(report.paperKey)}`, '', noteText(report.analysis.summary), ''];
    if (report.question) lines.push(`Question: ${noteText(report.question)}`, '');
    if (report.topic) lines.push(`Research topic: ${noteText(report.topic)}`, '');
    if (report.analysis.screening) {
      const { priority, tags } = report.analysis.screening;
      lines.push(`- Reading priority: ${priority}`, `- Suggested tags: ${tags.join(', ')}`, '');
    }
    for (const section of report.analysis.sections) {
      lines.push(`### ${noteText(section.title).replace(/\n/g, ' ')}`, '', `*${labels[section.type]}*${section.sources.length ? ` — ${section.sources.map(id => `[${id}]`).join(', ')}` : ''}`, '', noteText(section.text), '');
    }
    if (report.analysis.followUp.length) lines.push('### Questions to explore', '', ...report.analysis.followUp.map(item => `- ${noteText(item)}`), '');
    const cited = new Set(report.analysis.sections.flatMap(section => section.sources));
    lines.push('### Source passages', '');
    for (const source of report.context.sources.filter(source => cited.has(source.id))) {
      lines.push(`**[${source.id}] ${noteText(source.section || source.locator || source.kind).replace(/\n/g, ' ')}**`, '');
      const url = safeSourceUrl(source.url);
      if (url) lines.push(`[Open source](<${url.replace(/>/g, '%3E')}>)`, '');
      lines.push(...noteText(source.text).split('\n').map(line => `> ${line}`), '');
    }
    return lines.join('\n');
  }

  const api = { MODES, MAX_CONTEXT, DEFAULT_CONFIG, cleanText, endpointInfo, normalizeConfig, paperKey, safeSourceUrl, makeSources, selectContext, parseAnalysis, normalizeSuggestedTags, fingerprint, formatReport };
  root.PaperReading = Object.assign(root.PaperReading || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
