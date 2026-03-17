// ---- Cloudflare bindings ----
export interface Env {
  AI: Ai;
  PAPERS_BUCKET: R2Bucket;
  VECTORIZE: VectorizeIndex;
  CHAT_SESSION: DurableObjectNamespace<ChatSession>;
  INGESTION_WORKFLOW: Workflow;
  ASSETS: Fetcher;
}

// ---- Application types ----
export interface Paper {
  id: string;
  title: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
  status: "processing" | "ready" | "failed";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: string[];
}

export interface PaperIngestionParams {
  paperId: string;
  title: string;
  filename: string;
  content: string;
}

export interface VectorMetadata {
  paperId: string;
  title: string;
  chunkIndex: number;
  text: string;
}

// Forward declaration for Durable Object
import type { ChatSession } from "./chat-session";
