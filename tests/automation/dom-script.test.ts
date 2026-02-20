import { describe, it, expect } from 'vitest';
import { buildDomAutomationScript } from '../../src/automation/domScript';

describe('buildDomAutomationScript', () => {
  it('includes bootstrap IIFE', () => {
    const script = buildDomAutomationScript({
      requestId: 'test-1',
      actions: [{ type: 'click', target: '#btn' }],
    });

    expect(script).toContain('window.__CLAW_DOM__');
    expect(script).toContain('VERSION');
  });

  it('includes run() call with serialized request', () => {
    const script = buildDomAutomationScript({
      requestId: 'test-2',
      actions: [{ type: 'getText' }],
    });

    expect(script).toContain('window.__CLAW_DOM__.run(');
    expect(script).toContain('"requestId":"test-2"');
    expect(script).toContain('"actions"');
  });

  it('serializes requestId into the payload', () => {
    const script = buildDomAutomationScript({
      requestId: 'my-uuid-abc',
      actions: [{ type: 'click', target: 'button' }],
    });

    // Extract the JSON payload from the run() call
    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    expect(payload.requestId).toBe('my-uuid-abc');
  });

  it('omits requestId from payload when undefined (pre-fix behavior)', () => {
    // This verifies the JSON.stringify behavior:
    // When requestId is undefined, it's dropped from JSON output.
    // This is what DomAutomationBridge.executeRequest now prevents.
    const script = buildDomAutomationScript({
      actions: [{ type: 'click', target: '#btn' }],
    } as any);

    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    expect(match).not.toBeNull();
    const payload = JSON.parse(match![1]);
    // requestId will be absent from the JSON (JSON.stringify drops undefined values)
    expect(payload.requestId).toBeUndefined();
    expect('requestId' in payload).toBe(false);
  });

  it('serializes all optional fields when present', () => {
    const script = buildDomAutomationScript({
      requestId: 'full-req',
      tabId: 'tab-42',
      actions: [{ type: 'click', target: '#btn' }],
      timeoutMs: 5000,
      returnMode: 'last',
      descriptorMode: 'balanced',
    });

    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    const payload = JSON.parse(match![1]);
    expect(payload.requestId).toBe('full-req');
    expect(payload.tabId).toBe('tab-42');
    expect(payload.timeoutMs).toBe(5000);
    expect(payload.returnMode).toBe('last');
    expect(payload.descriptorMode).toBe('balanced');
    expect(payload.actions).toEqual([{ type: 'click', target: '#btn' }]);
  });

  it('serializes complex action arrays', () => {
    const actions = [
      { type: 'click', target: { css: '.menu-item', index: 2 } },
      { type: 'type', target: '#search', text: 'hello world', clear: true },
      { type: 'waitFor', target: '.results', state: 'visible', timeoutMs: 3000 },
      { type: 'getText', target: '.results' },
    ];

    const script = buildDomAutomationScript({
      requestId: 'complex-1',
      actions: actions as any,
    });

    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    const payload = JSON.parse(match![1]);
    expect(payload.actions).toHaveLength(4);
    expect(payload.actions[0].target.css).toBe('.menu-item');
    expect(payload.actions[1].text).toBe('hello world');
    expect(payload.actions[2].state).toBe('visible');
    expect(payload.actions[3].type).toBe('getText');
  });

  it('handles empty actions array', () => {
    const script = buildDomAutomationScript({
      requestId: 'empty-1',
      actions: [],
    });

    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    const payload = JSON.parse(match![1]);
    expect(payload.actions).toEqual([]);
  });

  it('handles special characters in action values', () => {
    const script = buildDomAutomationScript({
      requestId: 'special-1',
      actions: [{ type: 'type', target: '#input', text: 'hello "world" & <script>' }] as any,
    });

    // Should be valid JSON with properly escaped strings
    const match = script.match(/window\.__CLAW_DOM__\.run\((.+)\);/);
    expect(() => JSON.parse(match![1])).not.toThrow();
    const payload = JSON.parse(match![1]);
    expect(payload.actions[0].text).toBe('hello "world" & <script>');
  });
});
