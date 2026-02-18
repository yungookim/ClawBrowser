import * as path from 'node:path';
import * as os from 'node:os';
import { createStore, hashContent, extractTitle, type Store, type SearchResult } from '@tobilu/qmd/dist/store.js';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.clawbrowser', 'workspace', 'memory', 'index.sqlite');

export interface MemoryDocument {
  id: string;
  content: string;
  title: string;
  score?: number;
}

/**
 * QmdMemory wraps the qmd library for semantic memory search.
 * Uses BM25 full-text search and optional vector search for
 * finding relevant memories from the agent's knowledge base.
 */
export class QmdMemory {
  private store: Store | null = null;
  private dbPath: string;
  private collectionName = 'clawbrowser';

  constructor(dbPath?: string) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
  }

  /** Initialize the qmd store. */
  async initialize(): Promise<void> {
    try {
      this.store = createStore(this.dbPath);
      console.error(`[QmdMemory] Initialized at ${this.dbPath}`);
    } catch (err) {
      console.error('[QmdMemory] Failed to initialize:', err);
      throw err;
    }
  }

  /** Add a document to the memory index. */
  async addDocument(id: string, content: string, metadata?: Record<string, string>): Promise<void> {
    if (!this.store) throw new Error('QmdMemory not initialized');

    const hash = await hashContent(content);
    const title = metadata?.title || extractTitle(content, id);
    const now = new Date().toISOString();

    this.store.insertContent(hash, content, now);
    this.store.insertDocument(this.collectionName, id, title, hash, now, now);
  }

  /** Search for documents matching a query using BM25 full-text search. */
  search(query: string, topK: number = 5): MemoryDocument[] {
    if (!this.store) throw new Error('QmdMemory not initialized');

    const results: SearchResult[] = this.store.searchFTS(query, topK, this.collectionName);

    return results.map(r => ({
      id: r.filepath,
      content: r.body || '',
      title: r.title,
      score: r.score,
    }));
  }

  /** Search with hybrid BM25 + vector search (requires embeddings). */
  async hybridSearch(query: string, topK: number = 5): Promise<MemoryDocument[]> {
    if (!this.store) throw new Error('QmdMemory not initialized');

    try {
      const results = await this.store.searchVec(query, 'embeddinggemma', topK, this.collectionName);
      return results.map(r => ({
        id: r.filepath,
        content: r.body || '',
        title: r.title,
        score: r.score,
      }));
    } catch {
      // Fall back to FTS if vector search is not available
      return this.search(query, topK);
    }
  }

  /** Remove a document from the index. */
  remove(id: string): void {
    if (!this.store) throw new Error('QmdMemory not initialized');
    this.store.deactivateDocument(this.collectionName, id);
  }

  /** Get index status. */
  getStatus(): { totalDocuments: number; needsEmbedding: number } {
    if (!this.store) throw new Error('QmdMemory not initialized');
    const status = this.store.getStatus();
    return {
      totalDocuments: status.totalDocuments,
      needsEmbedding: status.needsEmbedding,
    };
  }

  /** Close the store. */
  close(): void {
    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }
}
