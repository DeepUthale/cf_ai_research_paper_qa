# PROMPTS.md - AI Prompts Used During Development

I used Claude (Anthropic) throughout this project, mostly as a back-and-forth conversation. I described what I wanted, Claude gave me code or suggestions, and I tweaked things until they worked. Here's a rough log of the main prompts I used.

All code was reviewed and understood by me before committing

---

## Prompt 1: Figuring out the architecture

> I want to build a research paper Q&A app for Cloudflare's assignment. They want an LLM preferably Llama 3.3 on Workers AI, some kind of workflow or coordination, a chat interface, and memory/state. What Cloudflare services should I use for each part? I'm thinking Workers AI for the LLM but not sure what to use for storing embeddings or keeping chat history.

From this I got the basic architecture: Workers AI for both LLM and embeddings, Vectorize for the vector DB, Durable Objects with SQLite for chat memory, Workflows for the ingestion pipeline, and R2 for storing the uploaded files. Claude also suggested Hono for routing which I went with.

---

## Prompt 2: The ingestion workflow

> Ok so how do I actually build a Cloudflare Workflow that takes a paper, stores it in R2, chunks the text, generates embeddings with the bge model, and puts them in Vectorize? I've never used Workflows before, show me how step.do() works and how to batch the embedding calls so I don't hit rate limits.

I used the workflow structure from this pretty directly. Changed the batch size to 10 chunks at a time and added a final step to update the paper status in R2 metadata.

---

## Prompt 3: Chat memory with Durable Objects

> I need a Durable Object that stores chat history using SQLite. Should be able to add messages, get the last N messages, clear everything, and also store some metadata like which paper the user is currently looking at. Keep it simple.

Got the base class from this. I added the lazy table initialization myself because I kept getting errors when the tables didn't exist yet on first request.

---

## Prompt 4: The actual RAG chat endpoint

> Now the main chat endpoint. When a user sends a message I need to: embed their question, search Vectorize for matching chunks, grab the conversation history from the Durable Object, build a prompt with all that context, and call Llama 3.3. Also want to track which sources were used in the response.

The flow came from this prompt. I messed around with the similarity threshold for a while, ended up at 0.5. Also rewrote the system prompt a few times to get better answers.

---

## Prompt 5: Text chunking

> Write me a chunking function for research papers. Sliding window with some overlap, try to break at sentence boundaries so chunks don't cut off mid sentence. Handle short documents too.

Used this mostly as-is. Tweaked chunk size to 512 and overlap to 64 after reading about what works best with the BGE embedding model.

---

## Prompt 6: Frontend

> Build me a chat UI with a sidebar for managing papers and a main chat area. Dark theme, file upload with drag and drop, show paper status processing and ready, loading dots when waiting for AI response. Just plain HTML/CSS/JS, no React or anything.

Got the initial layout from this then spent a while customizing it. Changed fonts to IBM Plex, adjusted colors, added the status polling for when papers are being indexed, and later added PDF support with PDF.js.

---

## Prompt 7: Wrangler config

> What does my wrangler.toml need to look like if I'm using Workers AI, R2, Vectorize, Durable Objects with SQLite, Workflows, and serving static files from a folder?

Used this for the binding syntax. Double checked everything against Cloudflare's docs because binding config is easy to get wrong.

---

## Other stuff

A bunch of smaller back-and-forth that I didn't log individually:
- Debugging why Workflows weren't running in dev mode (they need a full deploy)
- Fixing TypeScript types for Vectorize query responses
- Adding PDF text extraction on the client side with PDF.js
- Figuring out the right Vectorize filter syntax for querying by paperId

## Tools Used

- **Claude (Anthropic)**: Architecture, code generation, debugging
- **Cloudflare Docs**: Verified API usage, bindings, limits
- **Wrangler CLI**: Dev and deployment
