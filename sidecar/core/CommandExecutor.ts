import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { CommandAllowlistEntry } from './ConfigStore.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CommandExecutor {
  private entries: CommandAllowlistEntry[] = [];
  private compiled: Map<string, RegExp[]> = new Map();
  private workspaceDir: string | null = null;

  setAllowlist(entries: CommandAllowlistEntry[]): void {
    const compiled = new Map<string, RegExp[]>();
    for (const entry of entries) {
      const regexes = entry.argsRegex.map((pattern) => new RegExp(pattern));
      compiled.set(entry.command, regexes);
    }
    this.entries = entries;
    this.compiled = compiled;
  }

  setWorkspaceDir(dir: string | null): void {
    this.workspaceDir = dir;
  }

  validate(command: string, args: string[]): { ok: boolean; error?: string } {
    const entry = this.entries.find((item) => item.command === command);
    if (!entry) {
      return { ok: false, error: `Command not allowlisted: ${command}` };
    }

    const regexes = this.compiled.get(entry.command) || [];
    if (regexes.length === 0) {
      if (args.length > 0) {
        return { ok: false, error: `Arguments not allowed for ${command}` };
      }
      return { ok: true };
    }

    for (const arg of args) {
      const matched = regexes.some((regex) => regex.test(arg));
      if (!matched) {
        return { ok: false, error: `Argument not allowed for ${command}: ${arg}` };
      }
    }

    return { ok: true };
  }

  async execute(command: string, args: string[], cwd?: string): Promise<CommandResult> {
    const validation = this.validate(command, args);
    if (!validation.ok) {
      throw new Error(validation.error || 'Command not allowed');
    }

    const resolvedCwd = this.resolveCwd(cwd);

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: resolvedCwd || undefined,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      const MAX_OUTPUT = 32_000;
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length >= MAX_OUTPUT) return;
        stdout += chunk.toString('utf-8');
        if (stdout.length > MAX_OUTPUT) {
          stdout = stdout.slice(0, MAX_OUTPUT) + '\n[output truncated]';
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length >= MAX_OUTPUT) return;
        stderr += chunk.toString('utf-8');
        if (stderr.length > MAX_OUTPUT) {
          stderr = stderr.slice(0, MAX_OUTPUT) + '\n[output truncated]';
        }
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }

  private resolveCwd(cwd?: string): string | null {
    if (!cwd) return this.workspaceDir;
    if (!this.workspaceDir) return cwd;

    const base = path.resolve(this.workspaceDir);
    const target = path.resolve(cwd);
    if (target === base) return target;
    if (target.startsWith(base + path.sep)) return target;

    throw new Error('cwd must be inside the workspace directory');
  }
}
