import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import type { Env, PaperIngestionParams, VectorMetadata } from "./types";
import { chunkText } from "./utils";

/**
 * PaperIngestionWorkflow
 *
 * Multi-step durable workflow that processes uploaded research papers:
 * Step 1: Store raw content in R2
 * Step 2: Chunk text into smaller segments
 * Step 3: Generate vector embeddings via Workers AI
 * Step 4: Store embeddings in Vectorize index
 *
 * Each step is durable - if any step fails, the workflow
 * automatically retries from the last successful step.
 */

export class PaperIngestionWorkflow extends WorkflowEntrypoint<
  Env,
  PaperIngestionParams
> {
  async run(
    event: WorkflowEvent<PaperIngestionParams>,
    step: WorkflowStep
  ): Promise<void> {
    const { paperId, title, filename, content } = event.payload;

    // Step 1: Store the raw paper content in R2
    await step.do("store-raw-content", async () => {
      await this.env.PAPERS_BUCKET.put(
        `papers/${paperId}/${filename}`,
        content
      );

      // Store paper metadata
      await this.env.PAPERS_BUCKET.put(
        `meta/${paperId}.json`,
        JSON.stringify({
          id: paperId,
          title,
          filename,
          uploadedAt: new Date().toISOString(),
          status: "processing",
          chunkCount: 0,
        })
      );

      return { stored: true };
    });

    // Step 2: Chunk the text into smaller segments
    const chunks = await step.do("chunk-text", async () => {
      const textChunks = chunkText(content, 512, 64);
      return textChunks;
    });

    // Step 3: Generate embeddings for each chunk using Workers AI
    // Process in batches of 10 to stay within limits
    const batchSize = 10;
    const allVectors: Array<{
      id: string;
      values: number[];
      metadata: Record<string, string>;
    }> = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchIndex = Math.floor(i / batchSize);

      const batchVectors = await step.do(
        `generate-embeddings-batch-${batchIndex}`,
        async () => {
          const embeddingResponse: any = await this.env.AI.run(
            "@cf/baai/bge-base-en-v1.5",
            { text: batch }
          );

          const vectors = embeddingResponse.data || embeddingResponse;

          return batch.map((text, j) => ({
            id: `${paperId}-chunk-${i + j}`,
            values: vectors[j],
            metadata: {
              paperId,
              title,
              chunkIndex: String(i + j),
              text,
            },
          }));
        }
      );

      allVectors.push(...batchVectors);
    }

    // Step 4: Upsert all vectors into Vectorize
    await step.do("store-vectors", async () => {
      // Vectorize accepts batches of vectors
      const vectorBatchSize = 50;
      for (let i = 0; i < allVectors.length; i += vectorBatchSize) {
        const batch = allVectors.slice(i, i + vectorBatchSize);
        await this.env.VECTORIZE.upsert(batch);
      }
      return { vectorCount: allVectors.length };
    });

    // Step 5: Update paper metadata to "ready"
    await step.do("update-status", async () => {
      await this.env.PAPERS_BUCKET.put(
        `meta/${paperId}.json`,
        JSON.stringify({
          id: paperId,
          title,
          filename,
          uploadedAt: new Date().toISOString(),
          status: "ready",
          chunkCount: chunks.length,
        })
      );
      return { status: "ready" };
    });
  }
}
