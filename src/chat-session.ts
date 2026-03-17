import { DurableObject } from "cloudflare:workers";
import type { Env, ChatMessage } from "./types";

/**
 * ChatSession Durable Object
 *
 * Persists conversation history per session using SQLite storage.
 * Each chat session gets its own Durable Object instance,
 * ensuring strong consistency and low-latency access.
 */

export class ChatSession extends DurableObject<Env> {
  private initialized = false;

  private ensureTable(): void {
    if (this.initialized) return;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sources TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS session_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.initialized = true;
  }

  /**
   * Add a message to the conversation history.
   */

  async addMessage(message: ChatMessage): Promise<void> {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (role, content, sources, timestamp) VALUES (?, ?, ?, ?)`,
      message.role,
      message.content,
      message.sources ? JSON.stringify(message.sources) : null,
      message.timestamp
    );
  }

  /**
   * Retrieve recent conversation history.
   * Returns the last N messages for context window management.
   */

  async getHistory(limit: number = 20): Promise<ChatMessage[]> {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT role, content, sources, timestamp FROM messages ORDER BY id DESC LIMIT ?`,
      limit
    );

    const messages: ChatMessage[] = [];
    for (const row of rows) {
      messages.push({
        role: row.role as "user" | "assistant",
        content: row.content as string,
        sources: row.sources ? JSON.parse(row.sources as string) : undefined,
        timestamp: row.timestamp as string,
      });
    }

    return messages.reverse();
  }

  /**
   * Get the last N messages formatted for LLM context.
   */

  async getContextMessages(
    limit: number = 6
  ): Promise<Array<{ role: string; content: string }>> {
    const history = await this.getHistory(limit);
    return history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Clear conversation history for this session.
   */

  async clearHistory(): Promise<void> {
    this.ensureTable();
    this.ctx.storage.sql.exec(`DELETE FROM messages`);
  }

  /**
   * Store session metadata (e.g., active paper ID).
   */

  async setMeta(key: string, value: string): Promise<void> {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO session_meta (key, value) VALUES (?, ?)`,
      key,
      value
    );
  }

  /**
   * Retrieve session metadata.
   */
  
  async getMeta(key: string): Promise<string | null> {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT value FROM session_meta WHERE key = ?`,
      key
    );
    for (const row of rows) {
      return row.value as string;
    }
    return null;
  }
}
