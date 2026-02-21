import type { BrowserAutomationAction, BrowserAutomationProvider, ScreenshotPayload } from '../BrowserAutomationRouter.js';
import type { StagehandBridge } from '../StagehandBridge.js';

export class StagehandProvider implements BrowserAutomationProvider {
  name = 'stagehand';
  private bridge: StagehandBridge;

  constructor(bridge: StagehandBridge) {
    this.bridge = bridge;
  }

  async execute(action: BrowserAutomationAction, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'navigate':
        return this.bridge.navigate(String(params.url || ''));
      case 'act':
        return this.bridge.act(String(params.instruction || ''));
      case 'extract':
        return this.bridge.extract(String(params.instruction || ''), params.schema);
      case 'observe':
        return this.bridge.observe(String(params.instruction || ''));
      case 'screenshot':
        return this.bridge.screenshot(params.fullPage === true);
      default:
        throw new Error(`Unknown browser action: ${action}`);
    }
  }

  async captureScreenshot(fullPage?: boolean): Promise<ScreenshotPayload> {
    return this.bridge.screenshot(fullPage === true);
  }
}
