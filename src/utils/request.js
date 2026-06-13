const axios = require('axios');

const client = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  },
  proxy: {
    host: '127.0.0.1',
    port: 7890,
    protocol: 'http',
  },
});

async function get(url, options = {}) {
  try {
    const res = await client.get(url, options);
    return res.data;
  } catch (err) {
    throw new Error(`请求失败 [${url}]: ${err.message}`);
  }
}

module.exports = { get };
