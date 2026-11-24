function samplePdf() {
  const stream = 'BT /F1 12 Tf 50 750 Td (Methods and assumptions) Tj 0 -24 Td (A controlled study compares two conditions using identical measurements.) Tj 0 -24 Td (Formula: x = y + z. The inputs y and z determine x.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
const paper = { title: 'A controlled study of a general method', authors: ['A. Researcher'], year: 2026,
  venue: 'Example Journal', abstract: 'A controlled study compares a general method with a baseline using identical measurements. The model uses x = y + z.',
  arxiv_id: '2601.00001v2', arxiv_version: 'v2', web_url: 'https://arxiv.org/abs/2601.00001v2', html_url: 'https://arxiv.org/html/2601.00001v2', pdf_url: 'https://arxiv.org/pdf/2601.00001v2', categories: [] };
const fixtureHtml = `<article class="ltx_document"><section id="method"><h2>Methods</h2><p id="procedure">${'A method takes two inputs, applies a fixed transformation and compares measurements under controlled conditions. '.repeat(12)}</p><div class="ltx_equation" id="eq1"><math alttext="x = y + z"><mi>x</mi><mo>=</mo><mi>y</mi><mo>+</mo><mi>z</mi></math></div></section><section id="results"><h2>Experiments</h2><p>The same measurements are applied to the control and treatment.</p><figure id="tab1"><table><caption>Table 1: Stability</caption><thead><tr><th>Group</th><th>Variance</th></tr></thead><tbody><tr><td>Control</td><td>4.0</td></tr><tr><td>Treatment</td><td>2.0</td></tr></tbody><tfoot><tr><td colspan="2">Lower is better.</td></tr></tfoot></table></figure></section><section class="ltx_bibliography"><p>Excluded bibliography content.</p></section></article>`;
const accuracyTable = `<figure id="tab2"><table><caption>Table 2: Few-shot accuracy</caption>
<thead><tr><th rowspan="2">Method</th><th colspan="2">Accuracy (%)</th></tr>
<tr><th>Dataset A</th><th>Dataset B</th></tr></thead>
<tbody><tr><th scope="row">Baseline</th><td id="base-a">70</td><td id="base-b">81</td></tr>
<tr><th scope="row">Proposed</th><td id="new-a">77</td><td id="new-b">79</td></tr>
<tr><th scope="row">Unreported</th><td>—</td><td>78 ± 2</td></tr></tbody>
<tfoot><tr><td colspan="3">Five examples per class.</td></tr></tfoot></table></figure>`;
module.exports = { samplePdf, paper, fixtureHtml: fixtureHtml.replace('</article>', accuracyTable + '</article>') };
