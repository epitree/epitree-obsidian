import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { EpitreeError } from "./client";
import type EpitreePlugin from "./main";
import { DEFAULT_SERVER_URL, type FolderRule } from "./types";

const MODES: Record<FolderRule["mode"], string> = {
  word: "One note is one word",
  terms: "AI finds the terms in my notes",
};

export class EpitreeSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: EpitreePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const plugin = this.plugin;
    containerEl.empty();

    containerEl.createEl("p", {
      text:
        "Send notes from the folders you choose to Epitree, where they become words in your Concept Tree, " +
        "with reviews that help you remember them. You need an Epitree account.",
    });

    // ── Account ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Account").setHeading();
    const hasToken = Boolean(plugin.token());
    new Setting(containerEl)
      .setName("Access token")
      .setDesc(
        hasToken
          ? "A token is saved in Obsidian's secret storage. Paste a new one to replace it."
          : "Create one in Epitree under Settings → Connected apps, then paste it here. It is kept in Obsidian's secret storage, not in your vault.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(hasToken ? "••••••••" : "ept_…").onChange((value) => {
          if (value.trim()) plugin.setToken(value);
        });
      })
      .addButton((button) =>
        button.setButtonText("Test connection").onClick(async () => {
          try {
            const status = await plugin.client.status();
            const a = status.allowance;
            new Notice(
              `Connected to Epitree. ${status.notes.toLocaleString()} notes sent so far; ` +
                (a.period === "once"
                  ? `${a.remaining.toLocaleString()} of the ${a.limit.toLocaleString()} included notes are left.`
                  : `${a.remaining.toLocaleString()} of ${a.limit.toLocaleString()} left this month.`),
            );
            this.display();
          } catch (err) {
            new Notice(`Epitree: ${err instanceof EpitreeError ? err.message : "couldn't connect."}`, 8_000);
          }
        }),
      );

    // ── Folders ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Folders to send").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Only notes in these folders are sent. In “One note is one word”, the note's title is the word, and a " +
        "definition (in frontmatter or a “Definition:” line) is kept as you wrote it. In “AI finds the terms”, " +
        "the note's text is sent to Epitree's AI provider to pick out up to 10 terms. Add “epitree: false” to a " +
        "note's frontmatter to keep it out.",
    });

    const folders = this.app.vault
      .getAllFolders(true)
      .map((f) => (f.isRoot() ? "" : f.path))
      .sort((a, b) => a.localeCompare(b));

    plugin.settings.rules.forEach((rule, index) => {
      new Setting(containerEl)
        .setName(rule.folder || "Whole vault")
        .addDropdown((dropdown) => {
          for (const folder of folders) dropdown.addOption(folder, folder || "Whole vault");
          if (!folders.includes(rule.folder)) dropdown.addOption(rule.folder, rule.folder);
          dropdown.setValue(rule.folder).onChange(async (value) => {
            rule.folder = value;
            await plugin.saveAll();
            this.display();
          });
        })
        .addDropdown((dropdown) =>
          dropdown
            .addOptions(MODES)
            .setValue(rule.mode)
            .onChange(async (value) => {
              rule.mode = value as FolderRule["mode"];
              await plugin.saveAll();
            }),
        )
        .addToggle((toggle) =>
          toggle
            .setTooltip("Keep folders as branches in your Concept Tree")
            .setValue(rule.keepFolders)
            .onChange(async (value) => {
              rule.keepFolders = value;
              await plugin.saveAll();
            }),
        )
        .addExtraButton((button) =>
          button
            .setIcon("trash")
            .setTooltip("Stop sending this folder")
            .onClick(async () => {
              plugin.settings.rules.splice(index, 1);
              await plugin.saveAll();
              this.display();
            }),
        );
    });

    new Setting(containerEl)
      .setDesc("The switch on each folder keeps its subfolders as branches in your Concept Tree.")
      .addButton((button) =>
        button.setButtonText("Add folder").onClick(async () => {
          const used = new Set(plugin.settings.rules.map((r) => r.folder));
          const next = folders.find((f) => f && !used.has(f)) ?? "";
          plugin.settings.rules.push({ folder: next, mode: "word", keepFolders: true });
          await plugin.saveAll();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Never send")
      .setDesc("Paths that start with any of these, one per line.")
      .addTextArea((area) =>
        area.setValue(plugin.settings.exclude.join("\n")).onChange(async (value) => {
          plugin.settings.exclude = value
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          await plugin.saveAll();
        }),
      );

    // ── Syncing ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Syncing").setHeading();
    new Setting(containerEl)
      .setName("Sync automatically")
      .setDesc("When Obsidian starts, and then every few minutes. Only notes that changed are sent.")
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.autoSync).onChange(async (value) => {
          plugin.settings.autoSync = value;
          await plugin.saveAll();
          plugin.scheduleAutoSync();
        }),
      );
    new Setting(containerEl)
      .setName("Minutes between syncs")
      .addText((text) =>
        text.setValue(String(plugin.settings.autoSyncMinutes)).onChange(async (value) => {
          const minutes = Number.parseInt(value, 10);
          if (Number.isFinite(minutes) && minutes >= 5) {
            plugin.settings.autoSyncMinutes = minutes;
            await plugin.saveAll();
            plugin.scheduleAutoSync();
          }
        }),
      );

    // ── Advanced ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl)
      .setName("Server")
      .setDesc("Leave as it is unless you run your own copy of Epitree.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SERVER_URL)
          .setValue(plugin.settings.serverUrl)
          .onChange(async (value) => {
            plugin.settings.serverUrl = value.trim() || DEFAULT_SERVER_URL;
            await plugin.saveAll();
          }),
      );
  }
}
