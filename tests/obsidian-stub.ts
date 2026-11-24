/**
 * A stand-in for the parts of Obsidian's API the plugin uses. It records what
 * the plugin does (notices, settings, commands) so tests can check it.
 */

/** A DOM element, as far as the plugin uses one. */
export class FakeEl {
  tag: string;
  text = "";
  cls?: string;
  type = "";
  children: FakeEl[] = [];

  constructor(tag = "div") {
    this.tag = tag;
  }

  empty(): void {
    this.children = [];
  }

  createEl(tag: string, options: { text?: string; cls?: string } = {}): FakeEl {
    const el = new FakeEl(tag);
    el.text = options.text ?? "";
    el.cls = options.cls;
    this.children.push(el);
    return el;
  }

  setText(text: string): void {
    this.text = text;
  }

  /** Every text inside this element, in order. */
  allText(): string[] {
    return [this.text, ...this.children.flatMap((c) => c.allText())].filter(Boolean);
  }
}

export class Notice {
  static shown: { message: string; timeout?: number }[] = [];

  constructor(message: string, timeout?: number) {
    Notice.shown.push({ message, timeout });
  }
}

export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  get basename(): string {
    return this.path.split("/").pop()!.replace(/\.[^.]+$/, "");
  }

  get extension(): string {
    return this.path.split(".").pop() ?? "";
  }
}

// ── Setting components ──────────────────────────────────────────────────────

class Component {
  value = "";
  handler?: (value: never) => unknown;
  placeholder = "";
  tooltip = "";

  setValue(value: string | boolean): this {
    this.value = String(value);
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.placeholder = placeholder;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  onChange(handler: (value: never) => unknown): this {
    this.handler = handler;
    return this;
  }

  /** What typing or picking a value does. */
  async change(value: string | boolean): Promise<void> {
    this.value = String(value);
    await (this.handler as ((v: string | boolean) => unknown) | undefined)?.(value);
  }
}

export class TextComponent extends Component {
  inputEl = new FakeEl("input");
}

export class TextAreaComponent extends TextComponent {}

export class ToggleComponent extends Component {}

export class DropdownComponent extends Component {
  options: Record<string, string> = {};

  addOption(value: string, label: string): this {
    this.options[value] = label;
    return this;
  }

  addOptions(options: Record<string, string>): this {
    Object.assign(this.options, options);
    return this;
  }
}

export class ButtonComponent {
  text = "";
  cta = false;
  icon = "";
  tooltip = "";
  clickHandler?: () => unknown;

  setButtonText(text: string): this {
    this.text = text;
    return this;
  }

  setCta(): this {
    this.cta = true;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  onClick(handler: () => unknown): this {
    this.clickHandler = handler;
    return this;
  }

  async click(): Promise<void> {
    await this.clickHandler?.();
  }
}

export class Setting {
  /** Every Setting made, in order, so tests can find one by name. */
  static all: Setting[] = [];
  name = "";
  desc = "";
  heading = false;
  components: (Component | ButtonComponent)[] = [];

  constructor(public containerEl: FakeEl) {
    Setting.all.push(this);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setHeading(): this {
    this.heading = true;
    return this;
  }

  private add<T extends Component | ButtonComponent>(component: T, cb: (c: T) => unknown): this {
    this.components.push(component);
    cb(component);
    return this;
  }

  addText(cb: (c: TextComponent) => unknown): this {
    return this.add(new TextComponent(), cb);
  }

  addTextArea(cb: (c: TextAreaComponent) => unknown): this {
    return this.add(new TextAreaComponent(), cb);
  }

  addToggle(cb: (c: ToggleComponent) => unknown): this {
    return this.add(new ToggleComponent(), cb);
  }

  addDropdown(cb: (c: DropdownComponent) => unknown): this {
    return this.add(new DropdownComponent(), cb);
  }

  addButton(cb: (c: ButtonComponent) => unknown): this {
    return this.add(new ButtonComponent(), cb);
  }

  addExtraButton(cb: (c: ButtonComponent) => unknown): this {
    return this.add(new ButtonComponent(), cb);
  }
}

// ── Plugin, tabs and modals ─────────────────────────────────────────────────

export class Plugin {
  data: unknown = null;
  commands: { id: string; name: string; callback?: () => unknown; checkCallback?: (checking: boolean) => boolean }[] = [];
  ribbon: { icon: string; title: string; callback: () => unknown }[] = [];
  statusBar = new FakeEl("status");
  settingTabs: unknown[] = [];
  intervals: number[] = [];

  constructor(
    public app: App,
    public manifest: unknown,
  ) {}

  async loadData(): Promise<unknown> {
    return this.data;
  }

  async saveData(data: unknown): Promise<void> {
    this.data = JSON.parse(JSON.stringify(data));
  }

  addStatusBarItem(): FakeEl {
    return this.statusBar;
  }

  addRibbonIcon(icon: string, title: string, callback: () => unknown): FakeEl {
    this.ribbon.push({ icon, title, callback });
    return new FakeEl();
  }

  addCommand(command: Plugin["commands"][number]): void {
    this.commands.push(command);
  }

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }

  registerEvent(): void {}

  registerInterval(id: number): number {
    this.intervals.push(id);
    return id;
  }
}

export class PluginSettingTab {
  containerEl = new FakeEl();

  constructor(
    public app: App,
    public plugin: unknown,
  ) {}
}

export class Modal {
  contentEl = new FakeEl();
  title = "";
  isOpen = false;

  constructor(public app: App) {}

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  open(): void {
    this.isOpen = true;
    (this as unknown as { onOpen?: () => void }).onOpen?.();
  }

  close(): void {
    this.isOpen = false;
    (this as unknown as { onClose?: () => void }).onClose?.();
  }
}

// ── Functions ───────────────────────────────────────────────────────────────

export interface FakeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface FakeResponse {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
}

/** Set `fake.request` in a test to answer the plugin's HTTP calls. */
export const fake: { request: ((request: FakeRequest) => Promise<FakeResponse>) | null } = { request: null };

export async function requestUrl(request: FakeRequest) {
  if (!fake.request) throw new Error("requestUrl isn't faked in this test");
  const response = await fake.request(request);
  return {
    status: response.status,
    headers: response.headers ?? {},
    get json(): unknown {
      if (response.json === undefined) throw new SyntaxError("not JSON");
      return response.json;
    },
  };
}

interface FakeCache {
  tags?: { tag: string }[];
  frontmatter?: { tags?: string[] | string };
}

export function getAllTags(cache: FakeCache): string[] | null {
  const inline = cache.tags?.map((t) => t.tag) ?? [];
  const fm = cache.frontmatter?.tags;
  const front = (Array.isArray(fm) ? fm : fm ? [fm] : []).map((t) => `#${t}`);
  const all = [...inline, ...front];
  return all.length ? all : null;
}

/** The parts of Obsidian's App the plugin touches; tests build their own. */
export type App = Record<string, unknown>;
