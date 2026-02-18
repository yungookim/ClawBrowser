import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceFiles } from '../../sidecar/memory/WorkspaceFiles';

describe('WorkspaceFiles', () => {
  let tmpDir: string;
  let workspace: WorkspaceFiles;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-ws-test-'));
    workspace = new WorkspaceFiles(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should initialize workspace directory with template files', async () => {
    await workspace.initialize();

    const files = await fs.readdir(tmpDir);
    // Should have the 8 template files + logs/ + memory/ dirs
    expect(files).toContain('AGENTS.md');
    expect(files).toContain('SOUL.md');
    expect(files).toContain('USER.md');
    expect(files).toContain('IDENTITY.md');
    expect(files).toContain('TOOLS.md');
    expect(files).toContain('BOOT.md');
    expect(files).toContain('BOOTSTRAP.md');
    expect(files).toContain('HEARTBEAT.md');
    expect(files).toContain('logs');
    expect(files).toContain('memory');
  });

  it('should create subdirectories on init', async () => {
    await workspace.initialize();

    const logsStat = await fs.stat(path.join(tmpDir, 'logs'));
    expect(logsStat.isDirectory()).toBe(true);

    const memoryStat = await fs.stat(path.join(tmpDir, 'memory'));
    expect(memoryStat.isDirectory()).toBe(true);
  });

  it('should not overwrite existing files on re-initialize', async () => {
    await workspace.initialize();

    // Write custom content
    await workspace.write('SOUL.md', '# Custom Soul Content\n');

    // Re-initialize should not overwrite
    await workspace.initialize();

    const content = await workspace.read('SOUL.md');
    expect(content).toBe('# Custom Soul Content\n');
  });

  it('should initialize from template directory', async () => {
    // Create a template directory with a custom file
    const templateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-tpl-'));
    await fs.writeFile(
      path.join(templateDir, 'AGENTS.md'),
      '# Custom Agents Template\nSpecial content.',
      'utf-8'
    );

    await workspace.initialize(templateDir);

    const content = await workspace.read('AGENTS.md');
    expect(content).toBe('# Custom Agents Template\nSpecial content.');

    await fs.rm(templateDir, { recursive: true, force: true });
  });

  it('should read and write files', async () => {
    await workspace.initialize();

    await workspace.write('test.md', '# Test Content\n');
    const content = await workspace.read('test.md');

    expect(content).toBe('# Test Content\n');
  });

  it('should return empty string for nonexistent files', async () => {
    await workspace.initialize();

    const content = await workspace.read('nonexistent.md');
    expect(content).toBe('');
  });

  it('should append to files', async () => {
    await workspace.initialize();

    await workspace.write('log.md', '# Log\n');
    await workspace.append('log.md', '- Entry 1\n');
    await workspace.append('log.md', '- Entry 2\n');

    const content = await workspace.read('log.md');
    expect(content).toBe('# Log\n- Entry 1\n- Entry 2\n');
  });

  it('should list markdown files', async () => {
    await workspace.initialize();

    const files = await workspace.listFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.every(f => f.endsWith('.md'))).toBe(true);
  });

  it('should load all workspace files into a Record', async () => {
    await workspace.initialize();

    const all = await workspace.loadAll();
    expect(typeof all).toBe('object');
    expect(Object.keys(all)).toContain('SOUL.md');
    expect(Object.keys(all)).toContain('AGENTS.md');
    // Each file should have some content (at least the default header)
    for (const content of Object.values(all)) {
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('should create parent directories for nested writes', async () => {
    await workspace.initialize();

    await workspace.write('subdir/nested.md', '# Nested\n');
    const content = await workspace.read('subdir/nested.md');

    expect(content).toBe('# Nested\n');
  });

  it('should return workspace directory path', () => {
    expect(workspace.getWorkspaceDir()).toBe(tmpDir);
  });
});
