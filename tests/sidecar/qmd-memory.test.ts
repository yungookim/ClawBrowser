import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { QmdMemory } from '../../sidecar/memory/QmdMemory';

describe('QmdMemory', () => {
  let tmpDir: string;
  let dbPath: string;
  let memory: QmdMemory;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-qmd-test-'));
    dbPath = path.join(tmpDir, 'index.sqlite');
    memory = new QmdMemory(dbPath);
  });

  afterEach(async () => {
    memory.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when used before initialize', () => {
    expect(() => memory.search('test')).toThrow('QmdMemory not initialized');
    expect(() => memory.remove('doc-1')).toThrow('QmdMemory not initialized');
    expect(() => memory.getStatus()).toThrow('QmdMemory not initialized');
  });

  it('indexes and searches documents', async () => {
    await memory.initialize();
    await memory.addDocument('doc-1', 'Hello world from ClawBrowser', { title: 'Greeting' });

    const results = memory.search('Hello', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('doc-1');
  });

  it('hybridSearch returns results (vector or FTS)', async () => {
    await memory.initialize();
    await memory.addDocument('doc-2', 'Vector search fallback test');
    // Force vector search to fail to exercise the fallback path.
    const store = (memory as any).store as { searchVec?: () => void };
    if (store?.searchVec) {
      store.searchVec = () => {
        throw new Error('no vector index');
      };
    }

    const results = await memory.hybridSearch('Vector', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('removes documents and reports status', async () => {
    await memory.initialize();
    await memory.addDocument('doc-3', 'Remove me');

    memory.remove('doc-3');
    const status = memory.getStatus();
    expect(typeof status.totalDocuments).toBe('number');
    expect(typeof status.needsEmbedding).toBe('number');
  });
});
