import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const WORKSPACE_DIR = path.join(os.homedir(), '.clawbrowser', 'workspace');

const TEMPLATE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'TOOLS.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
];

/**
 * WorkspaceFiles manages the agent's persistent markdown workspace
 * at ~/.clawbrowser/workspace/. Initializes from template on first run.
 */
export class WorkspaceFiles {
  private workspaceDir: string;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir || WORKSPACE_DIR;
  }

  /** Initialize workspace directory and template files if they don't exist. */
  async initialize(templateDir?: string): Promise<void> {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    await fs.mkdir(path.join(this.workspaceDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(this.workspaceDir, 'memory'), { recursive: true });

    for (const filename of TEMPLATE_FILES) {
      const filePath = path.join(this.workspaceDir, filename);
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist, create from template or default
        let content = `# ${filename.replace('.md', '')}\n\n`;
        if (templateDir) {
          try {
            content = await fs.readFile(path.join(templateDir, filename), 'utf-8');
          } catch {
            // Template not found, use default
          }
        }
        await fs.writeFile(filePath, content, 'utf-8');
      }
    }

    console.error(`[WorkspaceFiles] Initialized at ${this.workspaceDir}`);
  }

  /** Read a workspace file. Returns empty string if not found. */
  async read(filename: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.workspaceDir, filename), 'utf-8');
    } catch {
      return '';
    }
  }

  /** Write content to a workspace file. */
  async write(filename: string, content: string): Promise<void> {
    const filePath = path.join(this.workspaceDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /** Append content to a workspace file. */
  async append(filename: string, content: string): Promise<void> {
    const filePath = path.join(this.workspaceDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, content, 'utf-8');
  }

  /** List all files in the workspace directory (non-recursive). */
  async listFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.workspaceDir);
      return entries.filter(e => e.endsWith('.md'));
    } catch {
      return [];
    }
  }

  /** Load all workspace markdown files into a Record. */
  async loadAll(): Promise<Record<string, string>> {
    const files = await this.listFiles();
    const result: Record<string, string> = {};
    for (const filename of files) {
      result[filename] = await this.read(filename);
    }
    return result;
  }

  /** Get the workspace directory path. */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }
}
