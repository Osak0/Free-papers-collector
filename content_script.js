const TAG_MAPPINGS = {
  'cs.CL': ['nlp'],
  'cs.CV': ['cv'],
  'cs.LG': ['ml'],
  'cs.AI': ['ai'],
  'cs.IR': ['ir'],
  'cs.NE': ['neural'],
  'cs.RO': ['robotics'],
  'cs.AR': ['architecture'],
  'cs.DB': ['database'],
  'cs.DC': ['distributed'],
  'cs.DS': ['ds'],
  'cs.GR': ['graphics'],
  'cs.HC': ['hci'],
  'cs.IT': ['info-theory'],
  'cs.MM': ['multimedia'],
  'cs.PL': ['pl'],
  'cs.SE': ['se'],
  'cs.SI': ['social'],
  'stat.ML': ['ml', 'statistics'],
  'math': ['math'],
  'q-bio': ['bio'],
  'physics': ['physics'],
  'eess': ['signal'],
  'econ': ['economics']
};

function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  return el ? el.getAttribute('content') : null;
}

function getAllMeta(name) {
  return Array.from(document.querySelectorAll(`meta[name="${name}"], meta[property="${name}"]`))
    .map(el => el.getAttribute('content'));
}

function sanitizeTagName(raw) {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\/\-_]/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .substring(0, 100);
}

function generateSuggestedTags(categories, comments, defaultTags, domain) {
  const tags = new Set([...(defaultTags || ['status/read'])]);
  
  if (domain === 'arxiv') {
    for (const cat of categories) {
      const cleanCat = sanitizeTagName(cat.replace(/\./g, '-'));
      for (const [pattern, mappedTags] of Object.entries(TAG_MAPPINGS)) {
        if (cat.startsWith(pattern) || cat === pattern) {
          mappedTags.forEach(t => tags.add(sanitizeTagName(t)));
        }
      }
      tags.add(cleanCat);
    }
  } else if (categories) {
    for (const cat of categories) {
      tags.add(sanitizeTagName(cat));
    }
  }

  if (comments) {
    const venuePatterns = [
      { pattern: /NeurIPS|NIPS/i, tag: 'conf/neurips' },
      { pattern: /ICML(?![A-Z])/i, tag: 'conf/icml' },
      { pattern: /ICLR/i, tag: 'conf/iclr' },
      { pattern: /CVPR/i, tag: 'conf/cvpr' },
      { pattern: /EMNLP/i, tag: 'conf/emnlp' },
      { pattern: /ACL(?!\w)/i, tag: 'conf/acl' },
      { pattern: /NAACL/i, tag: 'conf/naacl' },
      { pattern: /EACL/i, tag: 'conf/eacl' },
      { pattern: /AAAI/i, tag: 'conf/aaai' },
      { pattern: /IJCAI/i, tag: 'conf/ijcai' },
      { pattern: /SIGIR/i, tag: 'conf/sigir' },
      { pattern: /WWW/i, tag: 'conf/www' },
      { pattern: /KDD/i, tag: 'conf/kdd' },
      { pattern: /ECCV/i, tag: 'conf/eccv' },
      { pattern: /ICCV/i, tag: 'conf/iccv' }
    ];
    for (const { pattern, tag } of venuePatterns) {
      if (pattern.test(comments)) {
        tags.add(tag);
      }
    }
    const yearMatch = comments.match(/'?(\d{4})'?/);
    if (yearMatch) {
      for (const tag of [...tags]) {
        if (tag.startsWith('conf/')) {
          tags.add(tag + yearMatch[1]);
        }
      }
    }
  }
  return Array.from(tags);
}

// Extractors
function extractArxiv() {
  const arxivId = (window.location.pathname.match(/\/abs\/([^\/]+)/) || window.location.pathname.match(/\/(\d+\.\d+)/))?.[1];
  if (!arxivId) return null;

  const categories = [];
  const subjectEl = document.querySelector('.subjects, .list-subjects');
  if (subjectEl) {
    const found = subjectEl.textContent.match(/\(([^)]+)\)/g);
    if (found) found.forEach(m => categories.push(m.replace(/[()]/g, '').trim()));
  }

  let comments = '';
  const tds = document.querySelectorAll('.metatable td');
  for (const td of tds) {
    if (td.textContent.trim() === 'Comments:') {
      comments = td.nextElementSibling ? td.nextElementSibling.textContent.trim() : '';
      break;
    }
  }

  let venue = 'arXiv preprint';
  const vMatch = comments.match(/(?:Accepted (?:at|to|by|in)|Published (?:at|in|as)|Appears (?:at|in)|Proceedings of (?:the\s+)?)(.+?)(?:\.|$)/i);
  if (vMatch) venue = vMatch[1].trim();

  let year = null;
  const dateStr = getMeta('citation_date') || getMeta('citation_online_date');
  if (dateStr) year = parseInt(dateStr.split(/[\/-]/)[0], 10);

  return {
    title: getMeta('citation_title') || document.querySelector('h1.title')?.textContent.replace('Title:', '').trim(),
    authors: getAllMeta('citation_author'),
    year,
    abstract: getMeta('citation_abstract') || document.querySelector('blockquote.abstract')?.textContent.replace('Abstract:', '').trim(),
    pdf_url: getMeta('citation_pdf_url') || `https://arxiv.org/pdf/${arxivId}`,
    html_url: `https://arxiv.org/html/${arxivId}`,
    web_url: `https://arxiv.org/abs/${arxivId}`,
    arxiv_id: arxivId,
    categories,
    venue,
    comments,
    doi: getMeta('citation_doi') || document.querySelector('.abs-license a[href*="doi.org"]')?.href.match(/doi\.org\/(.+)/)?.[1],
    domain: 'arxiv'
  };
}

function extractOpenReview() {
  // OpenReview uses citation_* meta tags extensively
  const title = getMeta('citation_title');
  if (!title) return null;
  
  let year = null;
  const dateStr = getMeta('citation_publication_date') || getMeta('citation_date');
  if (dateStr) year = parseInt(dateStr.split(/[\/-]/)[0], 10);

  const venue = getMeta('citation_journal_title') || 'OpenReview';
  const arxivId = null;

  return {
    title,
    authors: getAllMeta('citation_author'),
    year,
    abstract: getMeta('citation_abstract') || document.querySelector('.note-content-value')?.textContent.trim() || '',
    pdf_url: getMeta('citation_pdf_url'),
    html_url: '',
    web_url: window.location.href,
    arxiv_id: arxivId,
    categories: [],
    venue,
    comments: venue,
    doi: null,
    domain: 'openreview'
  };
}

function extractSemanticScholar() {
  const title = getMeta('og:title') || getMeta('twitter:title') || document.querySelector('h1[data-test-id="paper-detail-title"]')?.textContent;
  if (!title) return null;

  const authors = Array.from(document.querySelectorAll('span[data-test-id="author-list"] a')).map(el => el.textContent) || getAllMeta('citation_author');
  
  let year = null;
  const yearEl = document.querySelector('span[data-test-id="paper-year"]');
  if (yearEl) year = parseInt(yearEl.textContent.match(/\d{4}/)?.[0], 10);

  let venue = document.querySelector('span[data-test-id="paper-venue"]')?.textContent || 'Semantic Scholar';

  return {
    title,
    authors,
    year,
    abstract: document.querySelector('div[data-test-id="abstract-text"]')?.textContent.trim() || getMeta('og:description'),
    pdf_url: document.querySelector('a[data-test-id="paper-link"]')?.href || '',
    html_url: '',
    web_url: window.location.href,
    arxiv_id: null,
    categories: [],
    venue,
    comments: venue,
    doi: null,
    domain: 'semanticscholar'
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract') {
    const hostname = window.location.hostname;
    let data = null;

    if (hostname.includes('arxiv.org')) {
      data = extractArxiv();
    } else if (hostname.includes('openreview.net')) {
      data = extractOpenReview();
    } else if (hostname.includes('semanticscholar.org')) {
      data = extractSemanticScholar();
    } else {
      // Fallback
      const title = getMeta('citation_title') || getMeta('og:title') || document.title;
      if (title) {
        data = {
          title,
          authors: getAllMeta('citation_author'),
          year: parseInt((getMeta('citation_date') || '').split('-')[0], 10) || null,
          abstract: getMeta('citation_abstract') || getMeta('og:description') || '',
          pdf_url: getMeta('citation_pdf_url') || '',
          html_url: '',
          web_url: window.location.href,
          arxiv_id: null,
          categories: [],
          venue: 'Web',
          comments: '',
          doi: getMeta('citation_doi'),
          domain: 'unknown'
        };
      }
    }

    if (!data || !data.title) {
      sendResponse({ error: '无法在此页面提取论文信息 (Unsupported page)' });
      return false;
    }

    data.suggested_tags = generateSuggestedTags(data.categories, data.comments, [], data.domain);
    sendResponse(data);
  }
  return false;
});
