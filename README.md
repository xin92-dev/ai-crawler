# AI 资讯周报系统

自动爬取 AI/ML 领域资讯，通过 LLM 按角色生成分析报告，支持 Web 展示、播客音频和邮件推送。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 20 |
| Web 服务 | Express.js |
| CLI 框架 | Commander.js |
| 定时任务 | node-cron |
| AI 分析 | GROQ (llama-3.3-70b) · Gemini 2.0 Flash · Anthropic Claude Haiku |
| 语音合成 | AWS Polly（Zhiyu 中文神经语音） |
| 邮件发送 | AWS SES + Nodemailer |
| 部署 | AWS EC2 (Amazon Linux 2023) + PM2 |
| 版本管理 | GitHub |

---

## 数据源

- **Hacker News** — 科技社区热门讨论
- **arXiv** — AI/ML 最新论文
- **Papers with Code** — 可复现论文与代码
- **Hugging Face Blog** — 模型与生态动态
- **OpenAI Blog** — 官方产品与研究

---

## 功能

### 爬取
```bash
node index.js crawl                    # 爬取今日
node index.js crawl --days 30          # 爬取最近 30 天
node index.js crawl hackernews arxiv   # 指定来源
```

### 分析报告
按角色生成 Markdown 报告，支持 `pm` / `developer` / `engineer` / `ops` 四种视角。

```bash
node index.js analyze --role pm,developer,engineer,ops --days 7
node index.js analyze --role pm --from 2026-06-01 --to 2026-06-07
```

### 音频播客
用 LLM 将报告提炼为播客脚本，再由 AWS Polly 合成 MP3。

```bash
node index.js audio 2026-06-15
```

脚本生成优先级：GROQ → Gemini → Anthropic（自动降级）

### Web 展示
```bash
node index.js build-web   # 生成 web/data.json
npm start                 # 启动本地服务 http://localhost:3000
```

### 邮件推送
```bash
node index.js email       # 立即向订阅者发送最新报告
```

订阅者配置见 `subscribers.json`，每人可订阅一个或多个角色报告。

---

## 目录结构

```
├── index.js              # CLI 入口
├── server.js             # Express 静态服务
├── subscribers.json      # 邮件订阅名单
├── src/
│   ├── crawlers/         # 各数据源爬虫
│   ├── analysis/         # LLM 分析引擎
│   ├── audio/            # 播客脚本 + Polly 合成
│   ├── email/            # SES 邮件发送
│   ├── storage/          # JSON 本地存储
│   └── utils/            # 导出工具
├── scripts/
│   └── build-web.js      # Web 数据预构建
├── web/
│   ├── index.html        # 周报展示页
│   ├── tech.html         # 项目技术分析页
│   ├── data.json         # 预构建数据
│   └── audio/            # 音频文件
├── results/
│   ├── analysis-*.md     # 各角色分析报告
│   └── audio/            # 本地音频 & 脚本
└── data/                 # 原始爬取数据（JSON）
```

---

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
GROQ_API_KEY=          # GROQ 控制台获取（免费）
GEMINI_API_KEY=        # Google AI Studio 获取（免费）
ANTHROPIC_API_KEY=     # Anthropic 控制台获取
AWS_REGION=ap-northeast-3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

---

## 部署到 AWS EC2

```bash
# 首次部署
git clone https://github.com/xin92-dev/ai-crawler.git
cd ai-crawler && npm install
cp .env.example .env  # 填写环境变量

# 启动服务（PM2 守护）
pm2 start server.js --name ai-crawler
pm2 startup && pm2 save
```

```bash
# 后续更新
git pull && pm2 restart ai-crawler
```

Web 服务默认运行在 `3000` 端口，确保 EC2 安全组已开放。

---

## 定时自动运行

```bash
node index.js schedule            # 每天 08:00 自动爬取 + 分析 + 发邮件
node index.js schedule "0 9 * * 1"  # 自定义 cron 表达式
```
