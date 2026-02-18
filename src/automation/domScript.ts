import type { DomAutomationRequest } from './domTypes';

const DOM_AUTOMATION_BOOTSTRAP = String.raw`
(() => {
  if (window.__CLAW_DOM__ && window.__CLAW_DOM__.version) return;

  const VERSION = '1.0.0';
  const DEFAULT_TIMEOUT = 30000;
  const MAX_TEXT = 20000;
  const MAX_HTML = 20000;
  const MAX_QUERY_RESULTS = 200;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const toArray = (list) => Array.prototype.slice.call(list || []);

  const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const truncate = (text, max) => {
    const value = String(text || '');
    if (!max || value.length <= max) return value;
    return value.slice(0, Math.max(0, max)) + '...';
  };

  const emit = (payload) => {
    try {
      const api = window.__TAURI__ && window.__TAURI__.event;
      if (api && typeof api.emit === 'function') {
        api.emit('claw-dom-automation', payload);
      }
    } catch {
      // Ignore emit failures.
    }
  };

  const safeStringify = (value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      try {
        return String(value);
      } catch {
        return '[Unserializable]';
      }
    }
  };

  const isVisible = (el) => {
    if (!el) return false;
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const getRect = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      pageX: rect.left + (window.scrollX || 0),
      pageY: rect.top + (window.scrollY || 0),
    };
  };

  const describeElement = (el) => {
    if (!el || !(el instanceof Element)) return null;
    const rect = getRect(el);
    const attrs = {};
    if (el.attributes) {
      for (const attr of Array.from(el.attributes)) {
        if (!attr || !attr.name) continue;
        if (attr.name.startsWith('on')) continue;
        attrs[attr.name] = truncate(attr.value, 200);
      }
    }
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : 'unknown',
      id: el.id || null,
      classes: el.className ? String(el.className).split(/\s+/).filter(Boolean) : [],
      name: el.getAttribute ? el.getAttribute('name') : null,
      role: el.getAttribute ? el.getAttribute('role') : null,
      ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
      href: el.getAttribute ? el.getAttribute('href') : null,
      src: el.getAttribute ? el.getAttribute('src') : null,
      type: el.getAttribute ? el.getAttribute('type') : null,
      value: 'value' in el ? truncate(String(el.value ?? ''), 500) : null,
      text: truncate(normalize(el.textContent || ''), 400),
      visible: isVisible(el),
      rect,
      attrs,
    };
  };

  const implicitRoleSelector = (role) => {
    switch (role) {
      case 'button':
        return 'button, input[type="button"], input[type="submit"], input[type="reset"]';
      case 'link':
        return 'a[href]';
      case 'textbox':
        return 'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], textarea';
      case 'checkbox':
        return 'input[type="checkbox"]';
      case 'radio':
        return 'input[type="radio"]';
      case 'combobox':
        return 'select, input[list]';
      case 'img':
        return 'img';
      case 'heading':
        return 'h1, h2, h3, h4, h5, h6';
      case 'list':
        return 'ul, ol';
      case 'listitem':
        return 'li';
      default:
        return '';
    }
  };

  const byText = (root, text, exact) => {
    const matches = new Set();
    if (!text) return [];
    const target = normalize(text);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = normalize(node.nodeValue || '');
      if (!value) continue;
      const hit = exact ? value === target : value.includes(target);
      if (hit && node.parentElement) {
        matches.add(node.parentElement);
      }
    }
    return Array.from(matches);
  };

  const byLabel = (root, text, exact) => {
    const labels = toArray(root.querySelectorAll('label'));
    const target = normalize(text);
    const matches = [];
    for (const label of labels) {
      const value = normalize(label.textContent || '');
      const hit = exact ? value === target : value.includes(target);
      if (!hit) continue;
      const forId = label.getAttribute('for');
      if (forId) {
        const input = root.getElementById ? root.getElementById(forId) : document.getElementById(forId);
        if (input) matches.push(input);
        continue;
      }
      const nested = label.querySelector('input, textarea, select');
      if (nested) matches.push(nested);
    }
    return matches;
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^\w-]/g, '\\\\$&');
  };

  const resolveElements = (target) => {
    if (!target) return [];
    const root = document;
    let elements = [];

    if (typeof target === 'string') {
      elements = toArray(root.querySelectorAll(target));
    } else if (target.xpath) {
      try {
        const result = document.evaluate(target.xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i += 1) {
          const node = result.snapshotItem(i);
          if (node && node.nodeType === 1) {
            elements.push(node);
          }
        }
      } catch {
        elements = [];
      }
    } else if (target.css || target.selector) {
      const sel = target.css || target.selector;
      elements = sel ? toArray(root.querySelectorAll(sel)) : [];
    } else if (target.id) {
      const el = root.getElementById ? root.getElementById(target.id) : document.getElementById(target.id);
      if (el) elements = [el];
    } else if (target.name) {
      elements = toArray(root.querySelectorAll('[name="' + cssEscape(target.name) + '"]'));
    } else if (target.role) {
      const implicit = implicitRoleSelector(target.role);
      const roleAttr = '[role="' + cssEscape(target.role) + '"]';
      const selector = implicit ? roleAttr + ', ' + implicit : roleAttr;
      elements = toArray(root.querySelectorAll(selector));
    } else if (target.testId) {
      const selector = [
        '[data-testid="' + cssEscape(target.testId) + '"]',
        '[data-test="' + cssEscape(target.testId) + '"]',
        '[data-qa="' + cssEscape(target.testId) + '"]',
      ].join(', ');
      elements = toArray(root.querySelectorAll(selector));
    } else if (target.placeholder) {
      elements = toArray(root.querySelectorAll('[placeholder*="' + cssEscape(target.placeholder) + '"]'));
    } else if (target.ariaLabel) {
      elements = toArray(root.querySelectorAll('[aria-label*="' + cssEscape(target.ariaLabel) + '"]'));
    } else if (target.label) {
      elements = byLabel(root, target.label, !!target.exact);
    } else if (target.text) {
      elements = byText(root, target.text, !!target.exact);
    }

    if (target && typeof target === 'object') {
      if (target.text && !target.label) {
        const filtered = byText(root, target.text, !!target.exact);
        elements = elements.length ? elements.filter((el) => filtered.includes(el)) : filtered;
      }
      if (target.visible) {
        elements = elements.filter((el) => isVisible(el));
      }
    }

    return elements;
  };

  const pickElement = (target) => {
    const elements = resolveElements(target);
    const strict = typeof target === 'object' && !!target.strict;
    const index = typeof target === 'object' && typeof target.index === 'number' ? target.index : 0;
    if (!elements.length) {
      throw new Error('No elements matched target');
    }
    if (strict && elements.length !== 1) {
      throw new Error('Expected 1 element, found ' + elements.length);
    }
    if (index < 0 || index >= elements.length) {
      throw new Error('Element index ' + index + ' out of range (size ' + elements.length + ')');
    }
    return elements[index];
  };

  const scrollIntoViewIfNeeded = (el) => {
    if (!el || !el.scrollIntoView) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    } catch {
      try {
        el.scrollIntoView(true);
      } catch {
        // Ignore.
      }
    }
  };

  const dispatchMouseEvent = (el, type, options) => {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.min(rect.width - 1, Math.max(1, rect.width / 2));
    const clientY = rect.top + Math.min(rect.height - 1, Math.max(1, rect.height / 2));
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      ...options,
    });
    el.dispatchEvent(event);
  };

  const dispatchKeyboardEvent = (el, type, key, modifiers) => {
    const event = new KeyboardEvent(type, {
      key,
      bubbles: true,
      cancelable: true,
      ...(modifiers || {}),
    });
    el.dispatchEvent(event);
  };

  const setNativeValue = (el, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(el.__proto__, 'value');
    const setter = descriptor && descriptor.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  };

  const updateInputValue = (el, value) => {
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const updateEditableValue = (el, value) => {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const setChecked = (el, checked) => {
    el.checked = checked;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const waitFor = (predicate, timeoutMs) => {
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : DEFAULT_TIMEOUT;
    return new Promise((resolve, reject) => {
      const start = now();
      const tick = () => {
        try {
          if (predicate()) {
            resolve(true);
            return;
          }
        } catch (err) {
          reject(err);
          return;
        }
        if (now() - start > timeout) {
          reject(new Error('Timeout waiting for condition'));
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  };

  const toSerializable = (value) => {
    if (value instanceof Element) {
      return describeElement(value);
    }
    if (Array.isArray(value)) {
      return value.map(toSerializable);
    }
    if (value && typeof value === 'object') {
      try {
        JSON.stringify(value);
        return value;
      } catch {
        return safeStringify(value);
      }
    }
    return value;
  };

  const actionHandlers = {
    async click(action) {
      const el = pickElement(action.target);
      scrollIntoViewIfNeeded(el);
      el.focus && el.focus();
      dispatchMouseEvent(el, 'mouseover');
      dispatchMouseEvent(el, 'mousemove');
      dispatchMouseEvent(el, 'mousedown', { button: action.button === 'middle' ? 1 : action.button === 'right' ? 2 : 0 });
      if (action.delayMs) {
        await new Promise((r) => setTimeout(r, action.delayMs));
      }
      dispatchMouseEvent(el, 'mouseup', { button: action.button === 'middle' ? 1 : action.button === 'right' ? 2 : 0 });
      const count = typeof action.clickCount === 'number' && action.clickCount > 0 ? action.clickCount : 1;
      for (let i = 0; i < count; i += 1) {
        if (typeof el.click === 'function') {
          el.click();
        }
      }
      return describeElement(el);
    },
    async dblclick(action) {
      const el = pickElement(action.target);
      scrollIntoViewIfNeeded(el);
      el.focus && el.focus();
      dispatchMouseEvent(el, 'mouseover');
      dispatchMouseEvent(el, 'mousemove');
      dispatchMouseEvent(el, 'mousedown', { button: action.button === 'middle' ? 1 : action.button === 'right' ? 2 : 0 });
      dispatchMouseEvent(el, 'mouseup', { button: action.button === 'middle' ? 1 : action.button === 'right' ? 2 : 0 });
      if (typeof el.click === 'function') {
        el.click();
        el.click();
      }
      dispatchMouseEvent(el, 'dblclick', { detail: 2 });
      return describeElement(el);
    },
    async hover(action) {
      const el = pickElement(action.target);
      scrollIntoViewIfNeeded(el);
      dispatchMouseEvent(el, 'mouseover');
      dispatchMouseEvent(el, 'mousemove');
      return describeElement(el);
    },
    async focus(action) {
      const el = pickElement(action.target);
      scrollIntoViewIfNeeded(el);
      el.focus && el.focus();
      return describeElement(el);
    },
    async blur(action) {
      const el = pickElement(action.target);
      el.blur && el.blur();
      return describeElement(el);
    },
    async type(action) {
      const el = pickElement(action.target);
      scrollIntoViewIfNeeded(el);
      el.focus && el.focus();
      const text = String(action.text || '');
      const isEditable = el.isContentEditable;
      const isInput = 'value' in el;
      if (action.clear) {
        if (isEditable) {
          updateEditableValue(el, '');
        } else if (isInput) {
          updateInputValue(el, '');
        }
      }
      if (action.delayMs && action.delayMs > 0) {
        for (const ch of text) {
          if (isEditable) {
            updateEditableValue(el, (el.textContent || '') + ch);
          } else if (isInput) {
            updateInputValue(el, String(el.value || '') + ch);
          }
          dispatchKeyboardEvent(el, 'keydown', ch);
          dispatchKeyboardEvent(el, 'keyup', ch);
          await new Promise((r) => setTimeout(r, action.delayMs));
        }
      } else {
        if (isEditable) {
          updateEditableValue(el, (el.textContent || '') + text);
        } else if (isInput) {
          updateInputValue(el, String(el.value || '') + text);
        }
      }
      if (action.pressEnter) {
        dispatchKeyboardEvent(el, 'keydown', 'Enter');
        dispatchKeyboardEvent(el, 'keyup', 'Enter');
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return describeElement(el);
    },
    async press(action) {
      const el = action.target ? pickElement(action.target) : (document.activeElement || document.body);
      const mods = {};
      (action.modifiers || []).forEach((mod) => {
        const key = String(mod).toLowerCase();
        if (key === 'alt') mods.altKey = true;
        if (key === 'shift') mods.shiftKey = true;
        if (key === 'ctrl' || key === 'control') mods.ctrlKey = true;
        if (key === 'meta' || key === 'cmd' || key === 'command') mods.metaKey = true;
      });
      dispatchKeyboardEvent(el, 'keydown', action.key, mods);
      dispatchKeyboardEvent(el, 'keyup', action.key, mods);
      return { key: action.key };
    },
    async setValue(action) {
      const el = pickElement(action.target);
      if ('value' in el) {
        updateInputValue(el, action.value);
      } else if (el.isContentEditable) {
        updateEditableValue(el, action.value);
      }
      return describeElement(el);
    },
    async clear(action) {
      const el = pickElement(action.target);
      if ('value' in el) {
        updateInputValue(el, '');
      } else if (el.isContentEditable) {
        updateEditableValue(el, '');
      }
      return describeElement(el);
    },
    async select(action) {
      const el = pickElement(action.target);
      if (!el || el.tagName.toLowerCase() !== 'select') {
        throw new Error('select action requires a <select> element');
      }
      const options = toArray(el.options || []);
      const values = Array.isArray(action.value) ? action.value : action.value ? [action.value] : [];
      const labels = Array.isArray(action.label) ? action.label : action.label ? [action.label] : [];
      const indexes = Array.isArray(action.index) ? action.index : typeof action.index === 'number' ? [action.index] : [];
      const selected = [];
      options.forEach((opt, idx) => {
        const hit = values.includes(opt.value) || labels.includes(opt.label) || indexes.includes(idx);
        opt.selected = hit;
        if (hit) selected.push(opt.value);
      });
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected };
    },
    async submit(action) {
      const el = pickElement(action.target);
      const form = el.tagName && el.tagName.toLowerCase() === 'form' ? el : el.form;
      if (!form) {
        throw new Error('submit action requires a form or form-associated element');
      }
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(el.tagName && el.tagName.toLowerCase() === 'form' ? undefined : el);
      } else if (typeof form.submit === 'function') {
        form.submit();
      }
      return describeElement(el);
    },
    async check(action) {
      const el = pickElement(action.target);
      if (el.type === 'checkbox' || el.type === 'radio') {
        setChecked(el, action.checked !== false);
      } else {
        throw new Error('check action requires checkbox or radio input');
      }
      return describeElement(el);
    },
    async scroll(action) {
      if (action.target) {
        const el = pickElement(action.target);
        const x = action.x || 0;
        const y = action.y || 0;
        if (action.by) {
          el.scrollBy({ left: x, top: y, behavior: action.behavior || 'auto' });
        } else {
          el.scrollTo({ left: x, top: y, behavior: action.behavior || 'auto' });
        }
        return { x, y };
      }
      const x = action.x || 0;
      const y = action.y || 0;
      if (action.by) {
        window.scrollBy({ left: x, top: y, behavior: action.behavior || 'auto' });
      } else {
        window.scrollTo({ left: x, top: y, behavior: action.behavior || 'auto' });
      }
      return { x, y };
    },
    async scrollIntoView(action) {
      const el = pickElement(action.target);
      el.scrollIntoView({
        block: action.block || 'center',
        inline: action.inline || 'nearest',
        behavior: 'auto',
      });
      return describeElement(el);
    },
    async waitFor(action) {
      const state = action.state || 'attached';
      await waitFor(() => {
        if (!action.target) {
          return state === 'attached';
        }
        const elements = resolveElements(action.target);
        const has = elements.length > 0;
        if (state === 'attached') return has;
        if (state === 'detached') return !has;
        if (state === 'visible') return elements.some((el) => isVisible(el));
        if (state === 'hidden') return elements.length > 0 && elements.every((el) => !isVisible(el));
        return false;
      }, action.timeoutMs);
      return { state };
    },
    async waitForText(action) {
      const text = normalize(action.text || '');
      await waitFor(() => {
        const bodyText = normalize(document.body ? document.body.innerText || '' : '');
        return action.exact ? bodyText === text : bodyText.includes(text);
      }, action.timeoutMs);
      return { text };
    },
    async waitForFunction(action) {
      const fn = new Function('return (function(){ ' + action.script + ' })();');
      const timeout = typeof action.timeoutMs === 'number' ? action.timeoutMs : DEFAULT_TIMEOUT;
      const start = now();
      while (true) {
        const value = fn();
        const resolved = value && typeof value.then === 'function' ? await value : value;
        if (resolved) {
          break;
        }
        if (now() - start > timeout) {
          throw new Error('Timeout waiting for function');
        }
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
      return { ok: true };
    },
    async exists(action) {
      const elements = resolveElements(action.target);
      return { exists: elements.length > 0 };
    },
    async count(action) {
      const elements = resolveElements(action.target);
      return { count: elements.length };
    },
    async query(action) {
      const elements = resolveElements(action.target).slice(0, action.maxResults || MAX_QUERY_RESULTS);
      return elements.map(describeElement);
    },
    async getText(action) {
      if (!action.target) {
        const text = normalize(document.body ? document.body.innerText || '' : '');
        return truncate(text, action.maxLength || MAX_TEXT);
      }
      const el = pickElement(action.target);
      const text = normalize(el.innerText || el.textContent || '');
      return truncate(action.trim === false ? String(el.textContent || '') : text, action.maxLength || MAX_TEXT);
    },
    async getHTML(action) {
      if (!action.target) {
        const html = action.outer ? document.documentElement.outerHTML : document.documentElement.innerHTML;
        return truncate(html, action.maxLength || MAX_HTML);
      }
      const el = pickElement(action.target);
      const html = action.outer ? el.outerHTML : el.innerHTML;
      return truncate(html, action.maxLength || MAX_HTML);
    },
    async getValue(action) {
      const el = pickElement(action.target);
      return 'value' in el ? String(el.value ?? '') : null;
    },
    async getAttribute(action) {
      const el = pickElement(action.target);
      return el.getAttribute ? el.getAttribute(action.name) : null;
    },
    async getProperty(action) {
      const el = pickElement(action.target);
      return toSerializable(el[action.name]);
    },
    async setAttribute(action) {
      const el = pickElement(action.target);
      el.setAttribute(action.name, String(action.value));
      return describeElement(el);
    },
    async removeAttribute(action) {
      const el = pickElement(action.target);
      el.removeAttribute(action.name);
      return describeElement(el);
    },
    async dispatchEvent(action) {
      const el = pickElement(action.target);
      const event = new Event(action.event, { bubbles: true, cancelable: true, ...(action.options || {}) });
      el.dispatchEvent(event);
      return { event: action.event };
    },
    async getBoundingBox(action) {
      const el = pickElement(action.target);
      return getRect(el);
    },
    async getPageInfo() {
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
        userAgent: navigator.userAgent,
      };
    },
    async getLinks(action) {
      const root = action.target ? pickElement(action.target) : document;
      const links = toArray(root.querySelectorAll('a[href]'));
      return links.slice(0, action.maxResults || MAX_QUERY_RESULTS).map((el) => ({
        href: el.getAttribute('href'),
        text: truncate(normalize(el.textContent || ''), 200),
        rect: getRect(el),
      }));
    },
    async highlight(action) {
      const el = pickElement(action.target);
      const rect = getRect(el);
      if (!rect) return null;
      const overlayId = '__claw_dom_highlight__';
      let overlay = document.getElementById(overlayId);
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.position = 'absolute';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483647';
        document.body.appendChild(overlay);
      }
      const mark = document.createElement('div');
      mark.style.position = 'absolute';
      mark.style.left = rect.pageX + 'px';
      mark.style.top = rect.pageY + 'px';
      mark.style.width = rect.width + 'px';
      mark.style.height = rect.height + 'px';
      mark.style.border = '2px solid ' + (action.color || '#f97316');
      mark.style.background = 'rgba(249, 115, 22, 0.1)';
      overlay.appendChild(mark);
      if (action.durationMs) {
        setTimeout(() => {
          mark.remove();
        }, action.durationMs);
      }
      return describeElement(el);
    },
    async clearHighlights() {
      const overlay = document.getElementById('__claw_dom_highlight__');
      if (overlay) overlay.remove();
      return { cleared: true };
    },
    async evaluate(action) {
      const el = action.target ? pickElement(action.target) : null;
      const fn = new Function('element', 'args', action.script);
      const result = fn(el, action.args || []);
      const resolved = result && typeof result.then === 'function' ? await result : result;
      return toSerializable(resolved);
    },
  };

  const run = async (request) => {
    const start = now();
    const results = [];
    let ok = true;
    let error = null;
    const actions = Array.isArray(request.actions) ? request.actions : [];

    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      const handler = actionHandlers[action.type];
      if (!handler) {
        ok = false;
        error = { message: 'Unknown action type: ' + action.type, actionIndex: i, actionType: action.type };
        break;
      }
      try {
        const value = await handler(action);
        results.push({ type: action.type, value: toSerializable(value) });
      } catch (err) {
        ok = false;
        const message = err && err.message ? err.message : safeStringify(err);
        error = { message, actionIndex: i, actionType: action.type, stack: err && err.stack ? String(err.stack) : undefined };
        break;
      }
    }

    const durationMs = now() - start;
    const returnMode = request.returnMode || 'all';
    let finalResults = results;
    if (returnMode === 'last') {
      finalResults = results.length ? [results[results.length - 1]] : [];
    } else if (returnMode === 'none') {
      finalResults = [];
    }

    const payload = {
      requestId: request.requestId,
      ok,
      results: finalResults,
      error,
      meta: {
        url: location.href,
        title: document.title,
        durationMs,
        tabId: request.tabId || null,
      },
    };

    emit(payload);
  };

  window.__CLAW_DOM__ = { version: VERSION, run };
})();
`;

export function buildDomAutomationScript(request: DomAutomationRequest): string {
  const payload = JSON.stringify(request || {});
  return `${DOM_AUTOMATION_BOOTSTRAP}\nwindow.__CLAW_DOM__.run(${payload});`;
}
