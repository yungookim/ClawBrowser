export type DropdownOption = {
  value: string;
  label: string;
};

type DropdownOptions = {
  options: DropdownOption[];
  value?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export class Dropdown {
  private container: HTMLDivElement;
  private select: HTMLSelectElement;
  private caret: HTMLSpanElement;

  constructor(options: DropdownOptions) {
    this.container = document.createElement('div');
    this.container.className = 'control control-select';
    if (options.className) {
      this.container.classList.add(options.className);
    }

    this.select = document.createElement('select');
    this.select.className = 'control-field';
    if (options.name) this.select.name = options.name;
    if (options.ariaLabel) this.select.setAttribute('aria-label', options.ariaLabel);
    if (options.required) this.select.required = true;
    if (options.disabled) this.select.disabled = true;

    this.caret = document.createElement('span');
    this.caret.className = 'control-caret';
    this.caret.textContent = '▾';

    this.container.appendChild(this.select);
    this.container.appendChild(this.caret);

    this.setOptions(options.options);
    if (options.value) {
      this.select.value = options.value;
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

  get field(): HTMLSelectElement {
    return this.select;
  }

  setOptions(options: DropdownOption[]): void {
    const current = this.select.value;
    this.select.textContent = '';
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      this.select.appendChild(el);
    }
    if (current && Array.from(this.select.options).some((opt) => opt.value === current)) {
      this.select.value = current;
    }
  }

  setValue(value: string): void {
    this.select.value = value;
  }

  getValue(): string {
    return this.select.value;
  }

  onChange(handler: (event: Event) => void): void {
    this.select.addEventListener('change', handler);
  }

  setDisabled(disabled: boolean): void {
    this.select.disabled = disabled;
    this.container.classList.toggle('is-disabled', disabled);
  }

  setRequired(required: boolean): void {
    this.select.required = required;
  }
}
