import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Paper, ChatMessage, VectorMetadata } from "./types";
import { generateId } from "./utils";

// Re-export Durable Object and Workflow classes so wrangler can find them
export { ChatSession } from "./chat-session";
export { PaperIngestionWorkflow } from "./workflow";

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for local development
app.use("/api/*", cors());

// POST /api/papers - Upload a research paper
app.post("/api/papers", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string) || "Untitled Paper";
    const textContent = formData.get("text") as string | null;

    let content: string;
    let filename: string;

    if (textContent) {
      // Direct text input
      content = textContent;
      filename = "paste.txt";
    } else if (file) {
      // File upload (txt, md, or pdf as text)
      content = await file.text();
      filename = file.name;
    } else {
      return c.json({ error: "No file or text content provided" }, 400);
    }

    if (content.trim().length < 50) {
      return c.json(
        { error: "Content too short. Please provide a full paper." },
        400
      );
    }

    const paperId = generateId();

    // Trigger the ingestion workflow
    const instance = await c.env.INGESTION_WORKFLOW.create({
      id: paperId,
      params: { paperId, title, filename, content },
    });

    return c.json({
      success: true,
      paperId,
      instanceId: instance.id,
      message: "Paper uploaded. Ingestion workflow started.",
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Upload failed" }, 500);
  }
});

// GET /api/papers - List all uploaded papers
app.get("/api/papers", async (c) => {
  try {
    const listed = await c.env.PAPERS_BUCKET.list({ prefix: "meta/" });
    const papers: Paper[] = [];

    for (const obj of listed.objects) {
      const data = await c.env.PAPERS_BUCKET.get(obj.key);
      if (data) {
        const paper = (await data.json()) as Paper;
        papers.push(paper);
      }
    }

    // Sort by upload date, newest first
    papers.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    return c.json({ papers });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to list papers" }, 500);
  }
});

// GET /api/papers/:id/status - Check paper ingestion status
app.get("/api/papers/:id/status", async (c) => {
  try {
    const paperId = c.req.param("id");
    const data = await c.env.PAPERS_BUCKET.get(`meta/${paperId}.json`);

    if (!data) {
      return c.json({ error: "Paper not found" }, 404);
    }

    const paper = (await data.json()) as Paper;
    return c.json(paper);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/chat - Send a message and get AI response
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json<{
      message: string;
      sessionId?: string;
      paperId?: string;
    }>();

    const { message } = body;
    const sessionId = body.sessionId || generateId();

    if (!message || message.trim().length === 0) {
      return c.json({ error: "Message cannot be empty" }, 400);
    }

    // Get or create the Durable Object for this chat session
    const sessionStub = c.env.CHAT_SESSION.get(
      c.env.CHAT_SESSION.idFromName(sessionId)
    );

    // If a paperId is provided, store it as session context
    if (body.paperId) {
      await sessionStub.setMeta("activePaperId", body.paperId);
    }

    // Store the user's message
    const userMessage: ChatMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    await sessionStub.addMessage(userMessage);

    // Step 1: Generate embedding for the user's question
    const queryEmbeddingResponse: any = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [message],
    });
    const queryVector = queryEmbeddingResponse.data?.[0] || queryEmbeddingResponse[0];

    // Step 2: Query Vectorize for relevant paper chunks
    const activePaperId = await sessionStub.getMeta("activePaperId");

    const matches = await c.env.VECTORIZE.query(queryVector, {
      topK: 8,
      returnMetadata: "all",
    });

    console.log(
      `Vectorize returned ${matches.matches.length} matches, top score: ${matches.matches[0]?.score ?? "none"}`
    );

    // Step 3: Build context from retrieved chunks
    // Use a low threshold so we don't miss relevant content
    const relevantChunks = matches.matches
      .filter((m) => m.score > 0.3)
      .map((m) => {
        const meta = m.metadata as Record<string, string>;
        return {
          text: meta?.text || "",
          title: meta?.title || "Unknown",
          score: m.score,
        };
      });

    const contextText = relevantChunks
      .map((c, i) => `[Source ${i + 1}] (${c.title}):\n${c.text}`)
      .join("\n\n");

    console.log(`Relevant chunks found: ${relevantChunks.length}, context length: ${contextText.length} chars`);

    // Step 4: Get conversation history for context
    const conversationHistory = await sessionStub.getContextMessages(6);

    // Step 5: Build the prompt and call Llama 3.3
    const systemPrompt = `You are PaperMind, a research paper Q&A assistant. You answer questions ONLY using the provided context from uploaded papers.

Rules:
- ALWAYS base your answers on the provided context below. Do NOT use your own knowledge or training data.
- Cite which source you are referencing (e.g., [Source 1]).
- If the context is relevant but doesn't fully answer the question, say what you can based on the context and note what's missing.
- If no context is provided or it's irrelevant, say "I couldn't find relevant information in the uploaded papers" and suggest the user rephrase or upload more content.
- Be precise and academic in tone, but explain complex concepts clearly.

Context from uploaded papers:
${contextText || "No context was retrieved from the papers for this question."}`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...conversationHistory.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];

    const aiResponse = await c.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      { messages, max_tokens: 1024, temperature: 0.3 }
    );

    const responseText =
      typeof aiResponse === "object" && "response" in aiResponse
        ? (aiResponse as any).response
        : String(aiResponse);

    // Step 6: Store the assistant's response
    const sourceTitles = relevantChunks.map((c) => c.title);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: responseText,
      timestamp: new Date().toISOString(),
      sources: [...new Set(sourceTitles)],
    };
    await sessionStub.addMessage(assistantMessage);

    return c.json({
      sessionId,
      message: assistantMessage,
      sourcesUsed: relevantChunks.length,
    });
  } catch (err: any) {
    console.error("Chat error:", err);
    return c.json({ error: err.message || "Chat failed" }, 500);
  }
});

// GET /api/chat/:sessionId - Get chat history
app.get("/api/chat/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const sessionStub = c.env.CHAT_SESSION.get(
      c.env.CHAT_SESSION.idFromName(sessionId)
    );

    const history = await sessionStub.getHistory(50);
    return c.json({ sessionId, messages: history });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// DELETE /api/chat/:sessionId - Clear chat history
app.delete("/api/chat/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const sessionStub = c.env.CHAT_SESSION.get(
      c.env.CHAT_SESSION.idFromName(sessionId)
    );

    await sessionStub.clearHistory();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
