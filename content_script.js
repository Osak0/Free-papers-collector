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

function getFirstMeta(names) {
  for (const name of names) {
    const value = getMeta(name);
    if (value) return value;
  }
  return null;
}

function getAllFirstAvailableMeta(names) {
  for (const name of names) {
    const values = getAllMeta(name).filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
}

function parseYear(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function normalizeDoi(value) {
  if (!value) return null;
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

function absolutizeUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, window.location.href).href;
  } catch (err) {
    return url;
  }
}

function findPdfUrl(selectors) {
  for (const selector of selectors) {
    const link = document.querySelector(selector);
    const href = link && (link.href || link.getAttribute('href'));
    if (href) return absolutizeUrl(href);
  }
  return '';
}

function splitMetaList(values) {
  return values
    .flatMap(value => String(value || '').split(/[;,]/))
    .map(value => value.trim())
    .filter(Boolean);
}

const VENUE_PATTERNS = [
  { pattern: /\bNeurIPS\b|\bNIPS\b/i, venue: 'NeurIPS' },
  { pattern: /\bICML\b/i, venue: 'ICML' },
  { pattern: /\bICLR\b/i, venue: 'ICLR' },
  { pattern: /\bCVPR\b/i, venue: 'CVPR' },
  { pattern: /\bICCV\b/i, venue: 'ICCV' },
  { pattern: /\bECCV\b/i, venue: 'ECCV' },
  { pattern: /\bACL\b/i, venue: 'ACL' },
  { pattern: /\bEMNLP\b/i, venue: 'EMNLP' },
  { pattern: /\bNAACL\b/i, venue: 'NAACL' },
  { pattern: /\bAAAI\b/i, venue: 'AAAI' },
  { pattern: /\bIJCAI\b/i, venue: 'IJCAI' },
  { pattern: /\bKDD\b/i, venue: 'KDD' },
  { pattern: /\bSIGIR\b/i, venue: 'SIGIR' },
  { pattern: /\bWWW\b/i, venue: 'WWW' }
];

function parsePublicationFromComments(comments) {
  if (!comments) return null;
  const year = parseYear(comments);

  for (const { pattern, venue } of VENUE_PATTERNS) {
    if (pattern.test(comments)) {
      return {
        venue,
        year,
        source: comments
      };
    }
  }

  const explicitMatch = comments.match(/(?:Accepted (?:at|to|by|in)|Published (?:at|in|as)|Appears (?:at|in)|To appear (?:at|in)|Proceedings of (?:the\s+)?)(.+?)(?:\.|$)/i);
  if (explicitMatch) {
    return {
      venue: explicitMatch[1].trim(),
      year,
      source: comments
    };
  }

  return null;
}

function parseArxivDateline() {
  const dateline = document.querySelector('.dateline')?.textContent || '';
  const submittedMatch = dateline.match(/Submitted on\s+(.+?)\s+\(v1\)/i);
  const revisedMatch = dateline.match(/last revised\s+(.+?)\s+\([^)]*v(\d+)\)/i);

  return {
    submittedDate: submittedMatch ? submittedMatch[1].trim() : '',
    revisionDate: revisedMatch ? revisedMatch[1].trim() : '',
    version: revisedMatch ? `v${revisedMatch[2]}` : ''
  };
}

function buildPublicationTimeline(data) {
  const timeline = [];
  if (data.preprint_year || data.arxiv_submitted_date) {
    timeline.push(`${data.preprint_year || data.arxiv_submitted_date} arXiv preprint`);
  }
  if (data.arxiv_version || data.arxiv_revision_date) {
    timeline.push([data.arxiv_revision_date, data.arxiv_version].filter(Boolean).join(' arXiv '));
  }
  if (data.published_venue || data.published_year) {
    timeline.push([data.published_venue, data.published_year].filter(Boolean).join(' '));
  }
  return timeline;
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

  let preprintYear = null;
  const dateStr = getMeta('citation_date') || getMeta('citation_online_date');
  if (dateStr) preprintYear = parseInt(dateStr.split(/[\/-]/)[0], 10);

  const arxivTimeline = parseArxivDateline();
  const published = parsePublicationFromComments(comments);
  const latestYear = published?.year || preprintYear;
  const latestVenue = published?.venue || 'arXiv preprint';

  const data = {
    title: getMeta('citation_title') || document.querySelector('h1.title')?.textContent.replace('Title:', '').trim(),
    authors: getAllMeta('citation_author'),
    year: latestYear,
    abstract: getMeta('citation_abstract') || document.querySelector('blockquote.abstract')?.textContent.replace('Abstract:', '').trim(),
    pdf_url: getMeta('citation_pdf_url') || `https://arxiv.org/pdf/${arxivId}`,
    html_url: `https://arxiv.org/html/${arxivId}`,
    web_url: `https://arxiv.org/abs/${arxivId}`,
    arxiv_id: arxivId,
    categories,
    venue: latestVenue,
    comments,
    doi: getMeta('citation_doi') || document.querySelector('.abs-license a[href*="doi.org"]')?.href.match(/doi\.org\/(.+)/)?.[1],
    domain: 'arxiv',
    preprint_year: preprintYear,
    preprint_venue: 'arXiv preprint',
    published_year: published?.year || null,
    published_venue: published?.venue || '',
    publication_status: published?.venue ? 'published' : 'preprint',
    arxiv_submitted_date: arxivTimeline.submittedDate,
    arxiv_revision_date: arxivTimeline.revisionDate,
    arxiv_version: arxivTimeline.version,
    latest_year: latestYear,
    latest_venue: latestVenue
  };

  data.publication_timeline = buildPublicationTimeline(data);
  return data;
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

  const data = {
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
    domain: 'openreview',
    latest_year: year,
    latest_venue: venue,
    publication_status: 'preprint'
  };
  data.publication_timeline = buildPublicationTimeline(data);
  return data;
}

function extractSemanticScholar() {
  const title = getMeta('og:title') || getMeta('twitter:title') || document.querySelector('h1[data-test-id="paper-detail-title"]')?.textContent;
  if (!title) return null;

  const authors = Array.from(document.querySelectorAll('span[data-test-id="author-list"] a')).map(el => el.textContent) || getAllMeta('citation_author');
  
  let year = null;
  const yearEl = document.querySelector('span[data-test-id="paper-year"]');
  if (yearEl) year = parseInt(yearEl.textContent.match(/\d{4}/)?.[0], 10);

  let venue = document.querySelector('span[data-test-id="paper-venue"]')?.textContent || 'Semantic Scholar';

  const data = {
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
    domain: 'semanticscholar',
    published_year: year,
    published_venue: venue,
    latest_year: year,
    latest_venue: venue,
    publication_status: 'published'
  };
  data.publication_timeline = buildPublicationTimeline(data);
  return data;
}

function extractPublisherPaper(domain, defaultVenue, pdfSelectors) {
  const title = getFirstMeta(['citation_title', 'dc.Title', 'DC.Title', 'og:title', 'twitter:title']) || document.querySelector('h1')?.textContent.trim();
  if (!title) return null;

  const authors = getAllFirstAvailableMeta(['citation_author', 'dc.Creator', 'DC.Creator', 'dc.creator', 'author']);
  const date = getFirstMeta(['citation_publication_date', 'citation_date', 'dc.Date', 'DC.Date', 'dc.date']);
  const year = parseYear(date);
  const doi = normalizeDoi(getFirstMeta(['citation_doi', 'dc.Identifier', 'DC.Identifier', 'dc.identifier']));
  const venue = getFirstMeta([
    'citation_journal_title',
    'citation_conference_title',
    'citation_inbook_title',
    'dc.Source',
    'DC.Source',
    'og:site_name'
  ]) || defaultVenue;
  const categories = splitMetaList([
    ...getAllMeta('citation_keywords'),
    ...getAllMeta('dc.Subject'),
    ...getAllMeta('DC.Subject'),
    ...getAllMeta('keywords')
  ]);

  const data = {
    title,
    authors,
    year,
    abstract: getFirstMeta(['citation_abstract', 'dc.Description', 'DC.Description', 'description', 'og:description']) || '',
    pdf_url: absolutizeUrl(getFirstMeta(['citation_pdf_url'])) || findPdfUrl(pdfSelectors),
    html_url: '',
    web_url: window.location.href,
    arxiv_id: null,
    categories,
    venue,
    comments: venue,
    doi,
    domain,
    published_year: year,
    published_venue: venue,
    latest_year: year,
    latest_venue: venue,
    publication_status: 'published'
  };
  data.publication_timeline = buildPublicationTimeline(data);
  return data;
}

function extractIEEE() {
  return extractPublisherPaper('ieee', 'IEEE Xplore', [
    'a[href*="/stamp/stamp.jsp"]',
    'a[href*="/ielx/"]',
    'a[href$=".pdf"]'
  ]);
}

function extractACM() {
  return extractPublisherPaper('acm', 'ACM Digital Library', [
    'a[href*="/doi/pdf/"]',
    'a[href*="/doi/epdf/"]',
    'a[title*="PDF" i]',
    'a[href$=".pdf"]'
  ]);
}

function extractSpringer() {
  return extractPublisherPaper('springer', 'Springer', [
    'a.c-pdf-download__link',
    'a[href*="/content/pdf/"]',
    'a[href$=".pdf"]'
  ]);
}

function extractNature() {
  return extractPublisherPaper('nature', 'Nature', [
    'a[data-track-action*="download pdf" i]',
    'a[href*=".pdf"]',
    'a[href$=".pdf"]'
  ]);
}

function extractScience() {
  return extractPublisherPaper('science', 'Science', [
    'a[href*="/doi/pdf/"]',
    'a[title*="PDF" i]',
    'a[href$=".pdf"]'
  ]);
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
    } else if (hostname.includes('ieeexplore.ieee.org')) {
      data = extractIEEE();
    } else if (hostname.includes('dl.acm.org')) {
      data = extractACM();
    } else if (hostname.includes('link.springer.com')) {
      data = extractSpringer();
    } else if (hostname.includes('nature.com')) {
      data = extractNature();
    } else if (hostname.includes('science.org')) {
      data = extractScience();
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
          domain: 'unknown',
          latest_year: parseInt((getMeta('citation_date') || '').split('-')[0], 10) || null,
          latest_venue: 'Web',
          publication_status: 'preprint',
          publication_timeline: []
        };
      }
    }

    if (!data || !data.title) {
      sendResponse({ error: chrome.i18n.getMessage('extUnsupportedPage') || 'Unsupported page: paper metadata could not be extracted.' });
      return false;
    }

    data.suggested_tags = generateSuggestedTags(data.categories, data.comments, [], data.domain);
    sendResponse(data);
  }
  return false;
});
