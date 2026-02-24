type ToolDefinition = {
  name: string;
  capability: string;
  action: string;
  description: string;
  required?: string[];
  optional?: string[];
  destructive?: boolean;
  validate?: (params: Record<string, unknown>) => string | null;
};

export type ParsedToolCall =
  | {
      kind: 'terminal';
      tool: 'terminalExec';
      command: string;
      args: string[];
      cwd?: string;
    }
  | {
      kind: 'agent';
      tool: string;
      capability: string;
      action: string;
      params: Record<string, unknown>;
      destructive?: boolean;
    }
  | {
      kind: 'invalid';
      tool?: string;
      error: string;
    };

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'browser.navigate', capability: 'stagehand', action: 'navigate', description: 'Navigate with Stagehand.', required: ['url'] },
  { name: 'browser.act', capability: 'stagehand', action: 'act', description: 'Perform an action with Stagehand.', required: ['instruction'] },
  {
    name: 'browser.extract',
    capability: 'stagehand',
    action: 'extract',
    description: 'Extract data with Stagehand.',
    required: ['instruction'],
    optional: ['schema'],
  },
  { name: 'browser.observe', capability: 'stagehand', action: 'observe', description: 'Observe the page with Stagehand.', required: ['instruction'] },
  { name: 'browser.screenshot', capability: 'stagehand', action: 'screenshot', description: 'Capture a screenshot with Stagehand.', optional: ['fullPage'] },
  { name: 'file.dialog.open', capability: 'fileDialog', action: 'open', description: 'Open file dialog.', optional: ['title', 'multiple', 'filters'] },
  { name: 'file.dialog.save', capability: 'fileDialog', action: 'save', description: 'Save file dialog.', optional: ['title', 'defaultPath', 'filters'] },
  { name: 'clipboard.read', capability: 'clipboard', action: 'read', description: 'Read clipboard text.' },
  { name: 'clipboard.write', capability: 'clipboard', action: 'write', description: 'Write clipboard text.', required: ['text'] },
  { name: 'filesystem.read', capability: 'filesystem', action: 'read', description: 'Read a file.', required: ['path'] },
  { name: 'filesystem.write', capability: 'filesystem', action: 'write', description: 'Write a file.', required: ['path', 'content'] },
  { name: 'filesystem.list', capability: 'filesystem', action: 'list', description: 'List a directory.', required: ['path'] },
  { name: 'filesystem.delete', capability: 'filesystem', action: 'delete', description: 'Delete a file.', required: ['path'], destructive: true },
  { name: 'window.focus', capability: 'window', action: 'focus', description: 'Focus the window.', optional: ['windowId'] },
  { name: 'window.resize', capability: 'window', action: 'resize', description: 'Resize the window.', required: ['width', 'height'], optional: ['windowId'] },
  { name: 'window.move', capability: 'window', action: 'move', description: 'Move the window.', required: ['x', 'y'], optional: ['windowId'] },
  { name: 'window.minimize', capability: 'window', action: 'minimize', description: 'Minimize the window.', optional: ['windowId'] },
  { name: 'window.maximize', capability: 'window', action: 'maximize', description: 'Maximize the window.', optional: ['windowId'] },
  { name: 'window.restore', capability: 'window', action: 'restore', description: 'Restore the window.', optional: ['windowId'] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeJsonParse(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class ToolRegistry {
  private definitions = new Map<string, ToolDefinition>();

  constructor() {
    for (const def of TOOL_DEFINITIONS) {
      this.definitions.set(def.name, def);
    }
  }

  describeTools(): string {
    return TOOL_DEFINITIONS.map((def) => {
      const params = [...(def.required || []), ...(def.optional || [])];
      const paramsText = params.length ? `params: ${params.join(', ')}` : 'no params';
      return `- ${def.name}: ${def.description} (${paramsText})`;
    }).join('\n');
  }

  parseToolCall(content: string): ParsedToolCall | null {
    const parsed = safeJsonParse(content);
    if (!parsed) return null;

    const tool = typeof parsed.tool === 'string' ? parsed.tool : '';
    if (!tool) return null;

    if (tool === 'terminalExec') {
      const params = isRecord(parsed.params) ? parsed.params : this.extractParams(parsed);
      const command = typeof params.command === 'string' ? params.command.trim() : '';
      if (!command) {
        return { kind: 'invalid', tool, error: 'terminalExec requires command' };
      }
      const args = Array.isArray(params.args) ? params.args.map((arg) => String(arg)) : [];
      const cwd = typeof params.cwd === 'string' ? params.cwd : undefined;
      return { kind: 'terminal', tool: 'terminalExec', command, args, cwd };
    }

    const def = this.definitions.get(tool);
    if (!def) {
      return { kind: 'invalid', tool, error: `Unknown tool: ${tool}` };
    }

    const params = isRecord(parsed.params) ? parsed.params : this.extractParams(parsed);
    const missing = (def.required || []).filter((key) => params[key] === undefined || params[key] === null || params[key] === '');
    if (missing.length > 0) {
      return { kind: 'invalid', tool, error: `Missing params: ${missing.join(', ')}` };
    }
    if (def.validate) {
      const error = def.validate(params);
      if (error) {
        return { kind: 'invalid', tool, error };
      }
    }

    return {
      kind: 'agent',
      tool,
      capability: def.capability,
      action: def.action,
      params,
      destructive: def.destructive,
    };
  }

  private extractParams(parsed: Record<string, unknown>): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'tool' || key === 'params') continue;
      params[key] = value;
    }
    return params;
  }
}
