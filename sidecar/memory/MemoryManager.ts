import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { QmdMemory, MemoryDocument } from './QmdMemory.js';

export interface Memory {
  id: string;
  fact: string;
  createdAt: string;
}

/**
 * MemoryManager persists explicit and implicit user facts.
 * Uses QmdMemory (BM25/SQLite) for semantic search and a JSON
 * sidecar file for listing all memories.
 */
export class MemoryManager {
  private memories: Memory[] = [];
  private readonly indexPath: string;
  private readonly qmdMemory: QmdMemory;
  private readonly onMemoryStored?: (fact: string, id: string) => void;

  constructor(
    qmdMemory: QmdMemory,
    indexPath: string,
    onMemoryStored?: (fact: string, id: string) => void,
  ) {
    this.qmdMemory = qmdMemory;
    this.indexPath = indexPath;
    this.onMemoryStored = onMemoryStored;
  }

  /** Load existing memories from the JSON index file. */
  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      this.memories = JSON.parse(raw) as Memory[];
    } catch {
      this.memories = [];
    }
    console.error(`[MemoryManager] Initialized with ${this.memories.length} memories`);
  }

  /** Store a new fact. Returns the generated ID. */
  async store(fact: string): Promise<string> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.memories.push({ id, fact, createdAt });
    await this.persist();
    try {
      await this.qmdMemory.addDocument(id, fact, { title: fact.slice(0, 60) });
    } catch (err) {
      console.error('[MemoryManager] Failed to index in QmdMemory (non-fatal):', err);
    }
    console.error(`[MemoryManager] Stored memory id=${id}`);
    this.onMemoryStored?.(fact, id);
    return id;
  }

  /** Semantic search via QmdMemory. Returns empty array on failure. */
  search(query: string, topN: number = 5): MemoryDocument[] {
    try {
      return this.qmdMemory.search(query, topN);
    } catch (err) {
      console.error('[MemoryManager] Search failed (non-fatal):', err);
      return [];
    }
  }

  /** Delete a memory by ID. Throws if not found. */
  async delete(id: string): Promise<void> {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error(`Memory not found: ${id}`);
    this.memories.splice(idx, 1);
    await this.persist();
    try {
      this.qmdMemory.remove(id);
    } catch (err) {
      console.error('[MemoryManager] Failed to remove from QmdMemory (non-fatal):', err);
    }
    console.error(`[MemoryManager] Deleted memory id=${id}`);
  }

  /** Return all stored memories (copy). */
  list(): Memory[] {
    return [...this.memories];
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, JSON.stringify(this.memories, null, 2), 'utf-8');
  }
}
