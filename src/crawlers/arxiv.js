const cheerio = require('cheerio');
const { get } = require('../utils/request');

const QUERIES = [
  { q: 'cat:cs.AI', category: 'AI' },
  { q: 'cat:cs.LG', category: 'Machine Learning' },
  { q: 'cat:cs.CL', category: 'NLP' },
];

// arXiv submittedDate filter is unreliable — fetch latest and filter client-side
async function fetchArxiv(days = 1) {
  const since = Date.now() - days * 86400 * 1000;
  const articles = [];

  for (const { q, category } of QUERIES) {
    try {
      const xml = await get(
        `https://export.arxiv.org/api/query?search_query=${q}&max_results=100&sortBy=submittedDate&sortOrder=descending`,
        { headers: { Accept: 'application/atom+xml' } }
      );

      const $ = cheerio.load(xml, { xmlMode: true });

      $('entry').each((_, el) => {
        const title = $(el).find('title').first().text().trim();
        const link = $(el).find('id').text().trim();
        const summary = $(el).find('summary').text().trim();
        const authors = $(el).find('author name').map((_, a) => $(a).text().trim()).get().join(', ');
        const published = $(el).find('published').text().trim();

        if (!title || !link) return;

        const pubDate = published ? new Date(published) : null;
        if (pubDate && pubDate.getTime() < since) return;

        articles.push({
          source: 'arXiv',
          category,
          title,
          url: link.replace('http://', 'https://'),
          author: authors,
          summary: summary.replace(/\s+/g, ' ').slice(0, 300),
          publishedAt: pubDate ? pubDate.toISOString() : new Date().toISOString(),
          crawledAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error(`arXiv ${category} failed: ${err.message}`);
    }
  }

  return articles;
}

module.exports = { fetchArxiv };
