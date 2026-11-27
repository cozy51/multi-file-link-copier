"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MultiFileLinkCopier
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var FORMATS = {
  wiki: "Wiki\u30EA\u30F3\u30AF",
  relative: "\u76F8\u5BFE\u30D1\u30B9",
  absolute: "\u7D76\u5BFE\u30D1\u30B9",
  filename: "\u30D5\u30A1\u30A4\u30EB\u540D"
};
var FORMAT_ORDER = ["wiki", "relative", "absolute", "filename"];
var DEFAULT_SETTINGS = {
  defaultFormat: "wiki",
  showNotice: true,
  visibleFormats: { wiki: true, relative: true, absolute: true, filename: true }
};
var MENU_SECTION = "multi-file-link-copier";
function isCopyFormat(value) {
  return FORMAT_ORDER.some((format) => format === value);
}
function readSettings(data) {
  const saved = data;
  const visibleFormats = { ...DEFAULT_SETTINGS.visibleFormats };
  for (const format of FORMAT_ORDER) {
    const visible = saved?.visibleFormats?.[format];
    if (typeof visible === "boolean") visibleFormats[format] = visible;
  }
  return {
    defaultFormat: isCopyFormat(saved?.defaultFormat) ? saved.defaultFormat : DEFAULT_SETTINGS.defaultFormat,
    showNotice: typeof saved?.showNotice === "boolean" ? saved.showNotice : DEFAULT_SETTINGS.showNotice,
    visibleFormats
  };
}
function addCopyGroup(menu, title, populate) {
  let submenu;
  menu.addItem((item) => {
    item.setSection(MENU_SECTION).setTitle(title).setIcon("copy");
    const internalItem = item;
    try {
      const result = internalItem.setSubmenu?.();
      if (result && typeof result.addItem === "function") submenu = result;
    } catch {
    }
    if (!submenu) item.setDisabled(true).setIsLabel(true);
  });
  if (submenu) {
    populate(submenu);
  } else {
    populate(menu, MENU_SECTION);
  }
}
var MultiFileLinkCopier = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = readSettings(null);
    this.pendingSave = Promise.resolve();
  }
  async onload() {
    this.settings = readSettings(await this.loadData());
    this.registerEvent(
      // Every file context menu is accepted (explorer, tabs, links, Bases, ...):
      // the source strings are not part of the public API, so new views keep working.
      this.app.workspace.on("file-menu", (menu, file) => {
        this.addCopyMenu(menu, [file]);
      })
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        if (Array.isArray(files)) {
          this.addCopyMenu(menu, files);
        }
      })
    );
    this.addSettingTab(new CopierSettingTab(this));
  }
  updateSettings(changes) {
    const snapshot = { ...this.settings, ...changes };
    this.settings = snapshot;
    this.pendingSave = this.pendingSave.then(() => this.saveData(snapshot)).catch(() => {
      new import_obsidian.Notice("Multi File Link Copier\u306E\u8A2D\u5B9A\u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    });
  }
  addCopyMenu(menu, entries) {
    const files = /* @__PURE__ */ new Map();
    for (const file of entries) {
      if (file instanceof import_obsidian.TFolder) continue;
      if (!(file instanceof import_obsidian.TFile) || this.app.vault.getFileByPath(file.path) !== file) return;
      files.set(file.path, { path: file.path, file });
    }
    if (files.size === 0) return;
    const selection = [...files.values()];
    const formats = FORMAT_ORDER.filter((format) => this.settings.visibleFormats[format]);
    if (formats.length === 0) return;
    const preferred = formats.indexOf(this.settings.defaultFormat);
    if (preferred > 0) formats.unshift(...formats.splice(preferred, 1));
    const count = selection.length === 1 ? "" : `\uFF08${selection.length}\u4EF6\uFF09`;
    if (formats.length === 1) {
      const [format] = formats;
      menu.addItem((item) => {
        item.setSection(MENU_SECTION).setTitle(`${FORMATS[format]}\u3092\u30B3\u30D4\u30FC${count}`).setIcon("copy").onClick(() => {
          void this.copyFiles(selection, format);
        });
      });
      return;
    }
    const title = selection.length === 1 ? "\u30D5\u30A1\u30A4\u30EB\u3092\u30B3\u30D4\u30FC" : `\u9078\u629E\u30D5\u30A1\u30A4\u30EB\u3092\u30B3\u30D4\u30FC${count}`;
    addCopyGroup(menu, title, (target, section) => {
      for (const format of formats) {
        target.addItem((item) => {
          if (section) item.setSection(section);
          item.setTitle(`${FORMATS[format]}\u3092\u30B3\u30D4\u30FC`).onClick(() => {
            void this.copyFiles(selection, format);
          });
        });
      }
    });
  }
  async copyFiles(selection, format) {
    const { vault } = this.app;
    const isCurrentFile = ({ file, path }) => vault.getFileByPath(path) === file;
    if (!selection.every(isCurrentFile)) {
      new import_obsidian.Notice("\u9078\u629E\u30D5\u30A1\u30A4\u30EB\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002\u9078\u629E\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    try {
      const stats = await Promise.all(selection.map(({ path }) => vault.adapter.stat(path)));
      if (stats.some((stat) => stat?.type !== "file") || !selection.every(isCurrentFile)) {
        new import_obsidian.Notice("\u9078\u629E\u30D5\u30A1\u30A4\u30EB\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u304B\u3001\u30D5\u30A1\u30A4\u30EB\u306E\u7A2E\u985E\u304C\u5909\u308F\u308A\u307E\u3057\u305F\u3002");
        return;
      }
      const lines = this.formatLines(selection, format);
      if (lines.some((line) => /[\r\n]/.test(line))) {
        throw new Error("\u9078\u629E\u30D5\u30A1\u30A4\u30EB\u306E\u30D1\u30B9\u307E\u305F\u306F\u540D\u524D\u306B\u6539\u884C\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u3002");
      }
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
      } catch {
        throw new Error("\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u66F8\u304D\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
      }
      if (this.settings.showNotice) {
        new import_obsidian.Notice(`${FORMATS[format]}\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF08${selection.length}\u4EF6\uFF09`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u539F\u56E0\u3092\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002";
      new import_obsidian.Notice(`\u30B3\u30D4\u30FC\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002 ${message}`);
    }
  }
  formatLines(selection, format) {
    const { adapter } = this.app.vault;
    switch (format) {
      case "relative":
        return selection.map(({ path }) => path);
      case "absolute":
        if (!(adapter instanceof import_obsidian.FileSystemAdapter)) {
          throw new Error("\u3053\u306EVault\u3067\u306F\u7D76\u5BFE\u30D1\u30B9\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002");
        }
        return selection.map(({ path }) => adapter.getFullPath(path));
      case "filename":
        return selection.map(({ file }) => file.name);
      case "wiki":
        return this.wikiLinks(selection);
    }
  }
  wikiLinks(selection) {
    const nameCounts = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getFiles()) {
      const name = file.name.toLowerCase();
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    const { metadataCache } = this.app;
    return selection.map(({ file, path }) => {
      const isMarkdown = file.extension.toLowerCase() === "md";
      const label = isMarkdown ? file.basename : file.name;
      const shortName = label.toLowerCase();
      const shortIsUnique = nameCounts.get(file.name.toLowerCase()) === 1 && !(isMarkdown && shortName.includes(".") && nameCounts.has(shortName));
      if (/[#|\[\]\r\n]/.test(path)) {
        throw new Error(`Wiki\u30EA\u30F3\u30AF\u3067\u6271\u3048\u306A\u3044\u8A18\u53F7\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\uFF08${file.name}\uFF09\u3002`);
      }
      if (shortIsUnique && label === label.trim() && metadataCache.getFirstLinkpathDest(label, "") === file) {
        return `[[${label}]]`;
      }
      const linkPath = isMarkdown ? path.slice(0, -3) : path;
      const target = linkPath.includes("/") ? linkPath : `/${linkPath}`;
      if (target !== target.trim() || metadataCache.getFirstLinkpathDest(target, "") !== file) {
        throw new Error(`Wiki\u30EA\u30F3\u30AF\u306E\u53C2\u7167\u5148\u3092\u7279\u5B9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF08${file.name}\uFF09\u3002`);
      }
      return `[[${target}]]`;
    });
  }
};
var CopierSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(copier) {
    super(copier.app, copier);
    this.copier = copier;
  }
  display() {
    this.containerEl.empty();
    new import_obsidian.Setting(this.containerEl).setName("\u30B3\u30D4\u30FC\u5F62\u5F0F\u306E\u521D\u671F\u5024").setDesc("\u6307\u5B9A\u3057\u305F\u5F62\u5F0F\u304C\u8868\u793A\u3055\u308C\u3066\u3044\u308B\u5834\u5408\u3001\u30B5\u30D6\u30E1\u30CB\u30E5\u30FC\u306E\u5148\u982D\u306B\u8868\u793A\u3057\u307E\u3059\u3002").addDropdown((dropdown) => {
      for (const format of FORMAT_ORDER) dropdown.addOption(format, FORMATS[format]);
      dropdown.setValue(this.copier.settings.defaultFormat).onChange((value) => {
        if (isCopyFormat(value)) this.copier.updateSettings({ defaultFormat: value });
      });
    });
    new import_obsidian.Setting(this.containerEl).setName("\u30B3\u30D4\u30FC\u6210\u529F\u6642\u306E\u901A\u77E5").addToggle((toggle) => {
      toggle.setValue(this.copier.settings.showNotice).onChange((showNotice) => {
        this.copier.updateSettings({ showNotice });
      });
    });
    new import_obsidian.Setting(this.containerEl).setName("\u53F3\u30AF\u30EA\u30C3\u30AF\u30E1\u30CB\u30E5\u30FC\u306B\u8868\u793A\u3059\u308B\u9805\u76EE").setHeading();
    for (const format of FORMAT_ORDER) {
      new import_obsidian.Setting(this.containerEl).setName(`${FORMATS[format]}\u3092\u30B3\u30D4\u30FC`).addToggle((toggle) => {
        toggle.setValue(this.copier.settings.visibleFormats[format]).onChange((visible) => {
          this.copier.updateSettings({
            visibleFormats: { ...this.copier.settings.visibleFormats, [format]: visible }
          });
        });
      });
    }
  }
};
