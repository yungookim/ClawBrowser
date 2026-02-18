export type AgentControlMode = 'max' | 'balanced' | 'strict';
export type AgentFilesystemScope = 'sandbox' | 'workspace_home' | 'unrestricted';
export type AgentClipboardAccess = 'readwrite' | 'write' | 'none';
export type AgentLogDetail = 'full' | 'redacted' | 'minimal';
export type AgentDestructiveConfirm = 'chat' | 'modal' | 'none';

export interface AgentActionLogSettings {
  enabled: boolean;
  detail: AgentLogDetail;
  retentionDays: number;
}

export interface AgentControlSettings {
  enabled: boolean;
  mode: AgentControlMode;
  killSwitch: boolean;
  autoGrantOrigins: boolean;
  autoGrantPagePermissions: boolean;
  allowTerminal: boolean;
  allowFilesystem: boolean;
  filesystemScope: AgentFilesystemScope;
  allowCookies: boolean;
  allowLocalStorage: boolean;
  allowCredentials: boolean;
  allowDownloads: boolean;
  allowFileDialogs: boolean;
  clipboardAccess: AgentClipboardAccess;
  allowWindowControl: boolean;
  allowDevtools: boolean;
  destructiveConfirm: AgentDestructiveConfirm;
  actionLog: AgentActionLogSettings;
  statusIndicator: boolean;
}

export const DEFAULT_AGENT_CONTROL: AgentControlSettings = {
  enabled: true,
  mode: 'max',
  killSwitch: false,
  autoGrantOrigins: true,
  autoGrantPagePermissions: false,
  allowTerminal: true,
  allowFilesystem: true,
  filesystemScope: 'sandbox',
  allowCookies: true,
  allowLocalStorage: true,
  allowCredentials: true,
  allowDownloads: true,
  allowFileDialogs: true,
  clipboardAccess: 'readwrite',
  allowWindowControl: true,
  allowDevtools: true,
  destructiveConfirm: 'chat',
  actionLog: {
    enabled: true,
    detail: 'full',
    retentionDays: 30,
  },
  statusIndicator: true,
};
