const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');

const RESULTS_DIR = path.resolve(__dirname, '../../results');

function toCSV(articles) {
  const header = ['source', 'category', 'title', 'author', 'url', 'summary', 'publishedAt'];
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const rows = articles.map(a => header.map(k => escape(a[k])).join(','));
  return [header.join(','), ...rows].join('\n');
}

function toMarkdown(articles) {
  const grouped = {};
  for (const a of articles) {
    if (!grouped[a.source]) grouped[a.source] = [];
    grouped[a.source].push(a);
  }

  const date = dayjs().format('YYYY-MM-DD');
  let md = `# AI Learning Articles — ${date}\n\n`;
  md += `> Total: ${articles.length} articles\n\n`;

  for (const [source, items] of Object.entries(grouped)) {
    md += `## ${source} (${items.length})\n\n`;
    for (const a of items) {
      md += `### [${a.title}](${a.url})\n`;
      if (a.author) md += `**Author:** ${a.author}  \n`;
      md += `**Published:** ${dayjs(a.publishedAt).format('YYYY-MM-DD')}  \n`;
      if (a.summary) md += `\n${a.summary}\n`;
      md += '\n---\n\n';
    }
  }
  return md;
}

async function exportData(articles, formats = ['json', 'csv', 'md']) {
  await fse.ensureDir(RESULTS_DIR);
  const date = dayjs().format('YYYY-MM-DD');
  const exported = [];

  if (formats.includes('json')) {
    const file = path.join(RESULTS_DIR, `articles-${date}.json`);
    await fse.writeJson(file, articles, { spaces: 2 });
    exported.push(file);
  }

  if (formats.includes('csv')) {
    const file = path.join(RESULTS_DIR, `articles-${date}.csv`);
    await fse.writeFile(file, toCSV(articles), 'utf-8');
    exported.push(file);
  }

  if (formats.includes('md')) {
    const file = path.join(RESULTS_DIR, `articles-${date}.md`);
    await fse.writeFile(file, toMarkdown(articles), 'utf-8');
    exported.push(file);
  }

  return exported;
}

module.exports = { exportData };
