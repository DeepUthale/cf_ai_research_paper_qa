# Research_Paper_Q&A

**PaperMind** - An AI-powered Research Paper Q&A assistant built entirely on Cloudflare's developer platform.

Upload research papers, and ask questions in natural language. PaperMind uses Retrieval-Augmented Generation (RAG) to find relevant sections and generate accurate, cited answers.

## Live Demo

> **Deployed at:** [https://cf-ai-research-paper-qa.uthaledeep2003.workers.dev/](https://cf-ai-research-paper-qa.uthaledeep2003.workers.dev/)

## Architecture

```
                          +------------------+
                          |   Cloudflare     |
                          |   Pages (UI)     |
                          +--------+---------+
                                   |
                                   v
+------------------+     +------------------+     +------------------+
|   R2 Bucket      |<----|   Hono Worker     |---->|  Durable Object  |
|  (Paper Storage) |     |   (API Router)   |     | (Chat Sessions)  |
+------------------+     +--------+---------+     |  SQLite Memory   |
                                   |              +------------------+
                          +--------+---------+
                          |   Cloudflare     |
                          |   Workflows      |
                          |  (Ingestion)     |
                          +--------+---------+
                                   |
                    +--------------+--------------+
                    |                             |
                    v                             v
          +------------------+          +------------------+
          |  Workers AI      |          |   Vectorize      |
          |  - Llama 3.3     |          |  (Vector DB)     |
          |  - BGE embeddings|          |  768 dimensions  |
          +------------------+          +------------------+
```

### How it works

1. **Upload**: User uploads a research paper (text/markdown file)
2. **Ingest** (Cloudflare Workflow):
   - Store raw file in R2
   - Chunk text into ~512 token segments with overlap
   - Generate vector embeddings using `@cf/baai/bge-base-en-v1.5` on Workers AI
   - Store embeddings in Vectorize index
3. **Query**: User asks a question in the chat interface
   - Generate embedding for the question
   - Query Vectorize for top-5 relevant chunks (cosine similarity)
   - Build a prompt with retrieved context + conversation history
   - Send to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for answer generation
4. **Memory**: Durable Object with SQLite persists full conversation history per session

### Cloudflare Services Used

| Requirement | Service | Purpose |
|---|---|---|
| **LLM** | Workers AI (Llama 3.3 70B) | Answer generation |
| **Embeddings** | Workers AI (BGE Base EN v1.5) | Vector embeddings for RAG |
| **Workflow** | Cloudflare Workflows | Durable multi-step paper ingestion |
| **User Input** | Static Assets (Pages-like) | Chat UI served from Worker |
| **Memory/State** | Durable Objects (SQLite) | Per-session conversation history |
| **Vector DB** | Vectorize | Semantic search over paper chunks |
| **Object Storage** | R2 | Raw paper file storage + metadata |

## Setup & Running

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v3+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/<YOUR_USERNAME>/cf_ai_research_paper_qa.git
cd cf_ai_research_paper_qa
npm install
```

### 2. Create Cloudflare resources

```bash
# Create the R2 bucket for paper storage
npx wrangler r2 bucket create research-papers

# Create the Vectorize index (768 dimensions for BGE model)
npx wrangler vectorize create paper-embeddings --dimensions=768 --metric=cosine
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser.

> **Note**: Local development uses Wrangler's local simulators for R2, Vectorize, Durable Objects, and Workflows. Workers AI requires a Cloudflare account and will make remote calls.

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

Your app will be live at `https://cf-ai-research-paper-qa.<your-subdomain>.workers.dev`.

## Project Structure

```
cf_ai_research_paper_qa/
├── src/
│   ├── index.ts          # Hono router - API endpoints
│   ├── workflow.ts        # Cloudflare Workflow - paper ingestion pipeline
│   ├── chat-session.ts    # Durable Object - conversation memory (SQLite)
│   ├── types.ts           # TypeScript type definitions
│   └── utils.ts           # Text chunking and utilities
├── static/
│   └── index.html         # Frontend chat UI
├── wrangler.toml          # Cloudflare bindings configuration
├── package.json
├── tsconfig.json
├── README.md              # This file
└── PROMPTS.md             # AI prompts used during development
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/papers` | Upload a paper (multipart form: `file` + `title`) |
| `GET` | `/api/papers` | List all uploaded papers |
| `GET` | `/api/papers/:id/status` | Check paper ingestion status |
| `POST` | `/api/chat` | Send a message (`{ message, sessionId?, paperId? }`) |
| `GET` | `/api/chat/:sessionId` | Get chat history for a session |
| `DELETE` | `/api/chat/:sessionId` | Clear a chat session |

## Design Decisions

- **Workflows over plain Workers** for ingestion: Papers can be large, and chunking + embedding is multi-step. Workflows provide automatic retries and durable state, so if embedding batch 3/10 fails, it resumes from there instead of re-processing the entire paper.
- **Durable Objects over KV for chat history**: Chat sessions need ordered, consistent reads/writes. Durable Objects with SQLite give us transactional storage co-located with compute, which is a better fit than eventually-consistent KV.
- **Vectorize over external vector DBs**: Keeps everything on Cloudflare's network with no external dependencies, lower latency, and simpler deployment.
- **Hono for routing**: Lightweight, Workers-native framework recommended by Cloudflare. Minimal overhead compared to Express-style alternatives.

## Author

**Deep Uthale** - [github.com/DeepUthale](https://github.com/DeepUthale) | [linkedin.com/in/deeputhale](https://linkedin.com/in/deeputhale)
