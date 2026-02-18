export type DomSelector =
  | string
  | {
      selector?: string;
      css?: string;
      xpath?: string;
      text?: string;
      exact?: boolean;
      role?: string;
      name?: string;
      label?: string;
      placeholder?: string;
      testId?: string;
      ariaLabel?: string;
      id?: string;
      index?: number;
      strict?: boolean;
      visible?: boolean;
    };

export type DomAction =
  | { type: 'click'; target: DomSelector; button?: 'left' | 'middle' | 'right'; clickCount?: number; delayMs?: number }
  | { type: 'dblclick'; target: DomSelector; button?: 'left' | 'middle' | 'right'; delayMs?: number }
  | { type: 'hover'; target: DomSelector }
  | { type: 'focus'; target: DomSelector }
  | { type: 'blur'; target: DomSelector }
  | { type: 'type'; target: DomSelector; text: string; delayMs?: number; clear?: boolean; pressEnter?: boolean }
  | { type: 'press'; key: string; target?: DomSelector; modifiers?: string[] }
  | { type: 'setValue'; target: DomSelector; value: string }
  | { type: 'clear'; target: DomSelector }
  | { type: 'select'; target: DomSelector; value?: string | string[]; label?: string | string[]; index?: number | number[] }
  | { type: 'submit'; target: DomSelector }
  | { type: 'check'; target: DomSelector; checked?: boolean }
  | { type: 'scroll'; target?: DomSelector; x?: number; y?: number; by?: boolean; behavior?: 'auto' | 'smooth' }
  | { type: 'scrollIntoView'; target: DomSelector; block?: 'start' | 'center' | 'end' | 'nearest'; inline?: 'start' | 'center' | 'end' | 'nearest' }
  | { type: 'waitFor'; target?: DomSelector; state?: 'attached' | 'visible' | 'hidden' | 'detached'; timeoutMs?: number }
  | { type: 'waitForText'; text: string; timeoutMs?: number; exact?: boolean }
  | { type: 'waitForFunction'; script: string; timeoutMs?: number }
  | { type: 'exists'; target: DomSelector }
  | { type: 'count'; target: DomSelector }
  | { type: 'query'; target: DomSelector; maxResults?: number }
  | { type: 'getText'; target?: DomSelector; trim?: boolean; maxLength?: number }
  | { type: 'getHTML'; target?: DomSelector; outer?: boolean; maxLength?: number }
  | { type: 'getValue'; target: DomSelector }
  | { type: 'getAttribute'; target: DomSelector; name: string }
  | { type: 'getProperty'; target: DomSelector; name: string }
  | { type: 'setAttribute'; target: DomSelector; name: string; value: string }
  | { type: 'removeAttribute'; target: DomSelector; name: string }
  | { type: 'dispatchEvent'; target: DomSelector; event: string; options?: Record<string, unknown> }
  | { type: 'getBoundingBox'; target: DomSelector }
  | { type: 'getPageInfo' }
  | { type: 'getLinks'; target?: DomSelector; maxResults?: number }
  | { type: 'highlight'; target: DomSelector; color?: string; durationMs?: number }
  | { type: 'clearHighlights' }
  | { type: 'evaluate'; script: string; args?: unknown[]; target?: DomSelector };

export interface DomElementDescriptorBalanced {
  tag: string;
  id: string | null;
  name: string | null;
  role: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  type: string | null;
  text: string;
  visible: boolean;
  href: string | null;
  src: string | null;
  value: string | null;
  state: {
    disabled: boolean | null;
    checked: boolean | null;
    expanded: boolean | null;
    selected: boolean | null;
  };
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
    pageX: number;
    pageY: number;
  } | null;
}

export interface DomAutomationRequest {
  requestId: string;
  tabId?: string;
  actions: DomAction[];
  timeoutMs?: number;
  returnMode?: 'all' | 'last' | 'none';
  descriptorMode?: 'full' | 'balanced';
}

export interface DomAutomationError {
  message: string;
  actionIndex?: number;
  actionType?: string;
  stack?: string;
}

export interface DomActionResult {
  type: string;
  value?: unknown;
}

export interface DomAutomationResult {
  requestId: string;
  ok: boolean;
  results: DomActionResult[];
  error?: DomAutomationError;
  meta?: {
    url?: string;
    title?: string;
    durationMs?: number;
    tabId?: string;
  };
}
