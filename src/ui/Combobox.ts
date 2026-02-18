let comboboxId = 0;

type ComboboxOptions = {
  options: string[];
  value?: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export class Combobox {
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDataListElement;
  private caret: HTMLSpanElement;

  constructor(options: ComboboxOptions) {
    this.container = document.createElement('div');
    this.container.className = 'control control-combobox';
    if (options.className) {
      this.container.classList.add(options.className);
    }

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'control-field';
    if (options.name) this.input.name = options.name;
    if (options.placeholder) this.input.placeholder = options.placeholder;
    if (options.ariaLabel) this.input.setAttribute('aria-label', options.ariaLabel);
    if (options.required) this.input.required = true;
    if (options.disabled) this.input.disabled = true;

    const listId = `combobox-${comboboxId++}`;
    this.list = document.createElement('datalist');
    this.list.id = listId;
    this.input.setAttribute('list', listId);

    this.caret = document.createElement('span');
    this.caret.className = 'control-caret';
    this.caret.textContent = '▾';

    this.container.appendChild(this.input);
    this.container.appendChild(this.caret);
    this.container.appendChild(this.list);

    this.setOptions(options.options);
    if (options.value) {
      this.input.value = options.value;
    }

    this.container.addEventListener('focusin', () => {
      this.container.classList.add('is-focus');
    });
    this.container.addEventListener('focusout', () => {
      this.container.classList.remove('is-focus');
    });
  }

  get element(): HTMLDivElement {
    return this.container;
  }

  get field(): HTMLInputElement {
    return this.input;
  }

  setOptions(options: string[]): void {
    this.list.textContent = '';
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option;
      this.list.appendChild(el);
    }
  }

  setValue(value: string): void {
    this.input.value = value;
  }

  getValue(): string {
    return this.input.value;
  }

  onInput(handler: (event: Event) => void): void {
    this.input.addEventListener('input', handler);
  }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
    this.container.classList.toggle('is-disabled', disabled);
  }

  setRequired(required: boolean): void {
    this.input.required = required;
  }
}
