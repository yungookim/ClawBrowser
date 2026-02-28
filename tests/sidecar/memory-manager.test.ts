import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../sidecar/memory/MemoryManager';

// Mock QmdMemory
const mockAddDocument = vi.fn().mockResolvedValue(undefined);
const mockSearch = vi.fn().mockReturnValue([]);
const mockRemove = vi.fn();

const mockQmdMemory = {
  addDocument: mockAddDocument,
  search: mockSearch,
  remove: mockRemove,
} as any;

// Mock fs/promises so no disk writes in tests
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MemoryManager(mockQmdMemory, '/tmp/test-memories.json');
  });

  it('initializes with empty list when index file missing', async () => {
    await manager.initialize();
    expect(manager.list()).toEqual([]);
  });

  it('stores a fact and returns an id', async () => {
    await manager.initialize();
    const id = await manager.store('User prefers dark mode');
    expect(id).toBeTruthy();
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].fact).toBe('User prefers dark mode');
  });

  it('indexes into QmdMemory on store', async () => {
    await manager.initialize();
    await manager.store('User wakes at 7am');
    expect(mockAddDocument).toHaveBeenCalledWith(
      expect.any(String),
      'User wakes at 7am',
      { title: 'User wakes at 7am' },
    );
  });

  it('calls onMemoryStored callback after successful store', async () => {
    const onStored = vi.fn();
    manager = new MemoryManager(mockQmdMemory, '/tmp/test.json', onStored);
    await manager.initialize();
    const id = await manager.store('Prefers bullet points');
    expect(onStored).toHaveBeenCalledWith('Prefers bullet points', id);
  });

  it('deletes a memory by id', async () => {
    await manager.initialize();
    const id = await manager.store('Some fact');
    await manager.delete(id);
    expect(manager.list()).toHaveLength(0);
    expect(mockRemove).toHaveBeenCalledWith(id);
  });

  it('throws when deleting unknown id', async () => {
    await manager.initialize();
    await expect(manager.delete('nonexistent-id')).rejects.toThrow('Memory not found');
  });

  it('returns search results from QmdMemory', async () => {
    mockSearch.mockReturnValue([{ id: 'a', content: 'dark mode', title: 'dark mode', score: 1 }]);
    await manager.initialize();
    const results = manager.search('dark mode');
    expect(results).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith('dark mode', 5);
  });

  it('returns empty array when search throws', async () => {
    mockSearch.mockImplementation(() => { throw new Error('db error'); });
    await manager.initialize();
    const results = manager.search('anything');
    expect(results).toEqual([]);
  });

  it('continues gracefully when QmdMemory.addDocument fails', async () => {
    mockAddDocument.mockRejectedValue(new Error('index error'));
    await manager.initialize();
    const id = await manager.store('fact that fails to index');
    expect(manager.list()).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  it('list returns a copy, not the internal array', async () => {
    await manager.initialize();
    await manager.store('fact one');
    const list = manager.list();
    list.push({ id: 'fake', fact: 'injected', createdAt: '' });
    expect(manager.list()).toHaveLength(1);
  });
});
