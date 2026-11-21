import {
  FileSystemAdapter,
  Menu,
  MenuItem,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";

const FORMATS = {
  wiki: "Wikiリンク",
  relative: "相対パス",
  absolute: "絶対パス",
  filename: "ファイル名",
} as const;

type CopyFormat = keyof typeof FORMATS;
type WikiStyle = "path" | "short";

interface CopierSettings {
  defaultFormat: CopyFormat;
  wikiStyle: WikiStyle;
  showNotice: boolean;
  visibleFormats: Record<CopyFormat, boolean>;
}

interface SelectedFile {
  file: TFile;
  path: string;
}

const FORMAT_ORDER: CopyFormat[] = ["wiki", "relative", "absolute", "filename"];
const DEFAULT_SETTINGS: CopierSettings = {
  defaultFormat: "wiki",
  wikiStyle: "path",
  showNotice: true,
  visibleFormats: { wiki: true, relative: true, absolute: true, filename: true },
};
const EXPLORER_MENU_SOURCE = "file-explorer-context-menu";
const MENU_SECTION = "multi-file-link-copier";

function isCopyFormat(value: unknown): value is CopyFormat {
  return FORMAT_ORDER.some((format) => format === value);
}

function readSettings(data: unknown): CopierSettings {
  const saved = data as Partial<CopierSettings> | null;
  const visibleFormats = { ...DEFAULT_SETTINGS.visibleFormats };
  for (const format of FORMAT_ORDER) {
    const visible = saved?.visibleFormats?.[format];
    if (typeof visible === "boolean") visibleFormats[format] = visible;
  }

  return {
    defaultFormat: isCopyFormat(saved?.defaultFormat)
      ? saved.defaultFormat
      : DEFAULT_SETTINGS.defaultFormat,
    wikiStyle: saved?.wikiStyle === "short" ? "short" : DEFAULT_SETTINGS.wikiStyle,
    showNotice: typeof saved?.showNotice === "boolean"
      ? saved.showNotice
      : DEFAULT_SETTINGS.showNotice,
    visibleFormats,
  };
}

function addCopyGroup(
  menu: Menu,
  title: string,
  populate: (target: Menu, section?: string) => void,
): void {
  let submenu: Menu | undefined;
  menu.addItem((item) => {
    item.setSection(MENU_SECTION).setTitle(title).setIcon("copy");
    // Obsidian's built-in submenu has no public API as of 1.15.1.
    const internalItem = item as MenuItem & { setSubmenu?: () => Menu };
    try {
      const result = internalItem.setSubmenu?.();
      if (result && typeof result.addItem === "function") submenu = result;
    } catch {
      // The copy actions can still be added to the public parent menu.
    }
    if (!submenu) item.setDisabled(true).setIsLabel(true);
  });

  if (submenu) {
    populate(submenu);
  } else {
    populate(menu, MENU_SECTION);
  }
}

export default class MultiFileLinkCopier extends Plugin {
  settings = readSettings(null);
  private pendingSave = Promise.resolve();

  async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source === EXPLORER_MENU_SOURCE) this.addCopyMenu(menu, [file]);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files, source) => {
        if (source === EXPLORER_MENU_SOURCE && Array.isArray(files)) {
          this.addCopyMenu(menu, files);
        }
      }),
    );
    this.addSettingTab(new CopierSettingTab(this));
  }

  updateSettings(changes: Partial<CopierSettings>): void {
    const snapshot = { ...this.settings, ...changes };
    this.settings = snapshot;
    this.pendingSave = this.pendingSave
      .then(() => this.saveData(snapshot))
      .catch(() => {
        new Notice("Multi File Link Copierの設定を保存できませんでした。");
      });
  }

  private addCopyMenu(menu: Menu, entries: TAbstractFile[]): void {
    const files = new Map<string, SelectedFile>();
    for (const file of entries) {
      if (file instanceof TFolder) continue;
      if (!(file instanceof TFile) || this.app.vault.getFileByPath(file.path) !== file) return;
      files.set(file.path, { path: file.path, file });
    }
    if (files.size === 0) return;

    const selection = [...files.values()];
    const formats = FORMAT_ORDER.filter((format) => this.settings.visibleFormats[format]);
    if (formats.length === 0) return;

    const preferred = formats.indexOf(this.settings.defaultFormat);
    if (preferred > 0) formats.unshift(...formats.splice(preferred, 1));

    addCopyGroup(menu, `選択ファイルをコピー（${selection.length}件）`, (target, section) => {
      for (const format of formats) {
        target.addItem((item) => {
          if (section) item.setSection(section);
          item.setTitle(`${FORMATS[format]}をコピー`).onClick(() => {
            void this.copyFiles(selection, format);
          });
        });
      }
    });
  }

  private async copyFiles(selection: SelectedFile[], format: CopyFormat): Promise<void> {
    const { vault } = this.app;
    const isCurrentFile = ({ file, path }: SelectedFile) => vault.getFileByPath(path) === file;
    if (!selection.every(isCurrentFile)) {
      new Notice("選択ファイルが変更されました。選択し直してください。");
      return;
    }

    try {
      const stats = await Promise.all(selection.map(({ path }) => vault.adapter.stat(path)));
      if (stats.some((stat) => stat?.type !== "file") || !selection.every(isCurrentFile)) {
        new Notice("選択ファイルが見つからないか、ファイルの種類が変わりました。");
        return;
      }

      const lines = this.formatLines(selection, format);
      if (lines.some((line) => /[\r\n]/.test(line))) {
        throw new Error("選択ファイルのパスまたは名前に改行が含まれています。");
      }

      try {
        await navigator.clipboard.writeText(lines.join("\n"));
      } catch {
        throw new Error("クリップボードに書き込めませんでした。");
      }

      if (this.settings.showNotice) {
        new Notice(`${FORMATS[format]}をコピーしました（${selection.length}件）`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "原因を特定できませんでした。";
      new Notice(`コピーできませんでした。 ${message}`);
    }
  }

  private formatLines(selection: SelectedFile[], format: CopyFormat): string[] {
    const { adapter } = this.app.vault;
    switch (format) {
      case "relative":
        return selection.map(({ path }) => path);
      case "absolute":
        if (!(adapter instanceof FileSystemAdapter)) {
          throw new Error("このVaultでは絶対パスを取得できません。");
        }
        return selection.map(({ path }) => adapter.getFullPath(path));
      case "filename":
        return selection.map(({ file }) => file.name);
      case "wiki":
        return this.wikiLinks(selection);
    }
  }

  private wikiLinks(selection: SelectedFile[]): string[] {
    const nameCounts = new Map<string, number>();
    if (this.settings.wikiStyle === "short") {
      for (const file of this.app.vault.getFiles()) {
        const name = file.name.toLowerCase();
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      }
    }

    const { metadataCache } = this.app;
    return selection.map(({ file, path }) => {
      const isMarkdown = file.extension.toLowerCase() === "md";
      const label = isMarkdown ? file.basename : file.name;
      const shortName = label.toLowerCase();
      const shortIsUnique = nameCounts.get(file.name.toLowerCase()) === 1
        && !(isMarkdown && shortName.includes(".") && nameCounts.has(shortName));

      if (/[#|\[\]\r\n]/.test(path)) {
        throw new Error(`Wikiリンクで扱えない記号が含まれています（${file.name}）。`);
      }
      if (shortIsUnique && label === label.trim()
        && metadataCache.getFirstLinkpathDest(label, "") === file) {
        return `[[${label}]]`;
      }

      const linkPath = isMarkdown ? path.slice(0, -3) : path;
      // An explicit root path disambiguates a root file from nested namesakes.
      const target = linkPath.includes("/") ? linkPath : `/${linkPath}`;
      if (target !== target.trim() || metadataCache.getFirstLinkpathDest(target, "") !== file) {
        throw new Error(`Wikiリンクの参照先を特定できませんでした（${file.name}）。`);
      }
      return `[[${target}|${label}]]`;
    });
  }
}

class CopierSettingTab extends PluginSettingTab {
  constructor(private readonly copier: MultiFileLinkCopier) {
    super(copier.app, copier);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("コピー形式の初期値")
      .setDesc("指定した形式が表示されている場合、サブメニューの先頭に表示します。")
      .addDropdown((dropdown) => {
        for (const format of FORMAT_ORDER) dropdown.addOption(format, FORMATS[format]);
        dropdown.setValue(this.copier.settings.defaultFormat).onChange((value) => {
          if (isCopyFormat(value)) this.copier.updateSettings({ defaultFormat: value });
        });
      });

    new Setting(this.containerEl)
      .setName("Wikiリンクの表示形式")
      .setDesc("同名ファイルを区別するため、必要な場合はフォルダを含む形式を使います。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("path", "[[フォルダ/ファイル名|ファイル名]]")
          .addOption("short", "[[ファイル名]]")
          .setValue(this.copier.settings.wikiStyle)
          .onChange((value) => {
            this.copier.updateSettings({ wikiStyle: value === "short" ? "short" : "path" });
          });
      });

    new Setting(this.containerEl)
      .setName("コピー成功時の通知")
      .addToggle((toggle) => {
        toggle.setValue(this.copier.settings.showNotice).onChange((showNotice) => {
          this.copier.updateSettings({ showNotice });
        });
      });

    new Setting(this.containerEl).setName("右クリックメニューに表示する項目").setHeading();
    for (const format of FORMAT_ORDER) {
      new Setting(this.containerEl)
        .setName(`${FORMATS[format]}をコピー`)
        .addToggle((toggle) => {
          toggle.setValue(this.copier.settings.visibleFormats[format]).onChange((visible) => {
            this.copier.updateSettings({
              visibleFormats: { ...this.copier.settings.visibleFormats, [format]: visible },
            });
          });
        });
    }
  }
}
