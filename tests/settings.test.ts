import { beforeEach, describe, expect, it } from "vitest";
import { ButtonComponent, DropdownComponent, Notice, Setting, TextComponent, ToggleComponent, fake } from "./obsidian-stub";
import EpitreePlugin, { TOKEN_SECRET_ID } from "../src/main";
import { EpitreeSettingTab } from "../src/settings";
import { DEFAULT_SERVER_URL } from "../src/types";
import { fakeApp } from "./fake-app";

let plugin: EpitreePlugin;
let env: ReturnType<typeof fakeApp>;
let tab: EpitreeSettingTab;

beforeEach(async () => {
  Notice.shown = [];
  env = fakeApp({}, ["Lectures", "Vocab", "Vocab/German"]);
  plugin = new EpitreePlugin(env.app as never, {} as never);
  await plugin.onload();
  tab = new EpitreeSettingTab(env.app as never, plugin);
  show();
});

function show() {
  Setting.all = [];
  tab.display();
}

const setting = (name: string) => {
  const found = Setting.all.find((s) => s.name === name);
  if (!found) throw new Error(`no setting named ${name}: ${Setting.all.map((s) => s.name).join(", ")}`);
  return found;
};
const parts = <T>(s: Setting, kind: new (...args: never[]) => T) => s.components.filter((c): c is T & typeof c => c instanceof kind);
const button = (label: string) =>
  Setting.all.flatMap((s) => parts(s, ButtonComponent)).find((b) => b.text === label)!;
const saved = () => (plugin as unknown as { data: { settings: typeof plugin.settings } }).data.settings;

describe("the settings tab", () => {
  it("is in four sections", () => {
    expect(Setting.all.filter((s) => s.heading).map((s) => s.name)).toEqual(["Account", "Folders to send", "Syncing", "Advanced"]);
  });

  it("takes the token in a password field and keeps it in secret storage", async () => {
    const field = parts(setting("Access token"), TextComponent)[0];
    expect(field.inputEl.type).toBe("password");

    await field.change("  ept_new  ");
    await field.change("");

    expect(env.secrets.get(TOKEN_SECRET_ID)).toBe("ept_new"); // an empty field doesn't erase it
  });

  it("says when a token is saved", () => {
    plugin.setToken("ept_x");
    show();
    expect(setting("Access token").desc).toContain("A token is saved");
  });

  it("adds the first folder not yet chosen, as one word per note, with its subfolders as branches", async () => {
    await button("Add folder").click();
    await button("Add folder").click();

    expect(plugin.settings.rules).toEqual([
      { folder: "Lectures", mode: "word", keepFolders: true },
      { folder: "Vocab", mode: "word", keepFolders: true },
    ]);
    expect(saved().rules).toHaveLength(2);
    expect(Setting.all.map((s) => s.name)).toContain("Lectures");
  });

  it("changes a folder, its mode and its switch, and removes it", async () => {
    await button("Add folder").click();
    const row = setting("Lectures");
    const [folder, mode] = parts(row, DropdownComponent);
    expect(Object.values(folder.options)).toEqual(["Whole vault", "Lectures", "Vocab", "Vocab/German"]);

    await mode.change("terms");
    await parts(row, ToggleComponent)[0].change(false);
    await folder.change("Vocab/German");
    expect(plugin.settings.rules).toEqual([{ folder: "Vocab/German", mode: "terms", keepFolders: false }]);

    await parts(setting("Vocab/German"), ButtonComponent)[0].click();
    expect(plugin.settings.rules).toEqual([]);
    expect(saved().rules).toEqual([]);
  });

  it("reads the never-send list one path per line", async () => {
    const area = parts(setting("Never send"), TextComponent)[0];
    expect(area.value).toBe("Templates/\n.trash/");

    await area.change(" Private/ \n\n  Archive/  \n");

    expect(plugin.settings.exclude).toEqual(["Private/", "Archive/"]);
  });

  it("refuses fewer than 5 minutes between syncs", async () => {
    const minutes = parts(setting("Minutes between syncs"), TextComponent)[0];
    await minutes.change("2");
    expect(plugin.settings.autoSyncMinutes).toBe(30);
    await minutes.change("15");
    expect(plugin.settings.autoSyncMinutes).toBe(15);
  });

  it("turns automatic syncing on and off", async () => {
    await parts(setting("Sync automatically"), ToggleComponent)[0].change(true);
    expect(saved().autoSync).toBe(true);
    await parts(setting("Sync automatically"), ToggleComponent)[0].change(false);
    expect(plugin.settings.autoSync).toBe(false);
  });

  it("goes back to epitree.com when the server field is cleared", async () => {
    const server = parts(setting("Server"), TextComponent)[0];
    await server.change("http://localhost:8000 ");
    expect(plugin.settings.serverUrl).toBe("http://localhost:8000");
    await server.change("  ");
    expect(plugin.settings.serverUrl).toBe(DEFAULT_SERVER_URL);
  });

  it("tests the connection and says how much allowance is left", async () => {
    plugin.setToken("ept_x");
    fake.request = async () => ({
      status: 200,
      json: { notes: 12, words: 30, pending: 0, allowance: { used: 12, limit: 1000, remaining: 988, period: "month" } },
    });

    await button("Test connection").click();

    expect(Notice.shown[Notice.shown.length - 1].message).toBe("Connected to Epitree. 12 notes sent so far; 988 of 1,000 left this month.");
    fake.request = null;
  });

  it("says what went wrong when the connection test fails", async () => {
    await button("Test connection").click();
    expect(Notice.shown[Notice.shown.length - 1].message).toMatch(/^Epitree: Add your Epitree access token first/);
  });
});
