const { get } = require('../utils/request');

const AI_KEYWORDS = ['ai', 'llm', 'gpt', 'machine learning', 'deep learning', 'neural',
  'anthropic', 'openai', 'gemini', 'mistral', 'transformer', 'diffusion', 'agent',
  'claude', 'chatgpt', 'generative', 'reinforcement', 'embedding', 'fine-tun'];

// Uses Algolia HN Search API which supports time-range filtering
async function fetchHackerNews(days = 1) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const articles = [];
  let page = 0;

  while (true) {
    const data = await get('https://hn.algolia.com/api/v1/search', {
      params: {
        tags: 'story',
        numericFilters: `created_at_i>${since}`,
        hitsPerPage: 50,
        page,
      },
    });

    if (!data?.hits?.length) break;

    for (const item of data.hits) {
      if (!item.url || !item.title) continue;
      const titleLower = item.title.toLowerCase();
      if (!AI_KEYWORDS.some(kw => titleLower.includes(kw))) continue;

      articles.push({
        source: 'Hacker News',
        category: 'ai',
        title: item.title,
        url: item.url,
        author: item.author || '',
        summary: '',
        score: item.points || 0,
        comments: item.num_comments || 0,
        publishedAt: new Date(item.created_at).toISOString(),
        crawledAt: new Date().toISOString(),
      });
    }

    if (page >= data.nbPages - 1) break;
    page++;
  }

  return articles;
}

module.exports = { fetchHackerNews };
