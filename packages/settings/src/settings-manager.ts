import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

export interface CompactionSettings {
  enabled?: boolean; // default: true
  reserveTokens?: number; // default: 16384
  keepRecentTokens?: number; // default: 20000
}

export interface RetrySettings {
  enabled?: boolean; // default: true
  maxRetries?: number; // default: 3
  baseDelayMs?: number; // default: 2000 (exponential backoff: 2s, 4s, 8s)
  maxDelayMs?: number; // default: 60000 (max server-requested delay before failing)
}

export interface TerminalSettings {
  showImages?: boolean; // default: true (only relevant if terminal supports images)
  clearOnShrink?: boolean; // default: false (clear empty rows when content shrinks)
}

export interface ImageSettings {
  autoResize?: boolean; // default: true (resize images to 2000x2000 max for better model compatibility)
  blockImages?: boolean; // default: false - when true, prevents all images from being sent to LLM providers
}

export interface ThinkingBudgetsSettings {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export interface MarkdownSettings {
  codeBlockIndent?: string; // default: "  "
}

/**
 * Package source for npm/git packages.
 * - String form: load all resources from the package
 * - Object form: filter which resources to load
 */
export type PackageSource =
  | string
  | {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };

export interface Settings {
  lastChangelogVersion?: string;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  theme?: string;
  compaction?: CompactionSettings;
  retry?: RetrySettings;
  hideThinkingBlock?: boolean;
  shellPath?: string; // Custom shell path (e.g., for Cygwin users on Windows)
  quietStartup?: boolean;
  shellCommandPrefix?: string; // Prefix prepended to every bash command (e.g., "shopt -s expand_aliases" for alias support)
  npmCommand?: string[]; // Command used for npm package lookup/install operations, argv-style (e.g., ["mise", "exec", "node@20", "--", "npm"])
  collapseChangelog?: boolean; // Show condensed changelog after update (use /changelog for full)
  packages?: PackageSource[]; // Array of npm/git package sources (string or object with filtering)
  extensions?: string[]; // Array of local extension file paths or directories
  prompts?: string[]; // Array of local prompt template paths or directories
  themes?: string[]; // Array of local theme file paths or directories
  terminal?: TerminalSettings;
  images?: ImageSettings;
  doubleEscapeAction?: "fork" | "none"; // Action for double-escape with empty editor (default: "fork")
  thinkingBudgets?: ThinkingBudgetsSettings; // Custom token budgets for thinking levels
  editorPaddingX?: number; // Horizontal padding for input editor (default: 0)
  autocompleteMaxVisible?: number; // Max visible items in autocomplete dropdown (default: 5)
  showHardwareCursor?: boolean; // Show terminal cursor while still positioning it for IME
  markdown?: MarkdownSettings;
  /**
   * Additional Claude Agent SDK options merged into anthropic runtime calls.
   * This is a pass-through object for advanced SDK features.
   */
  claudeAgentSdk?: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: Settings = {
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
  },
  hideThinkingBlock: false,
  quietStartup: false,
  collapseChangelog: false,
  terminal: {
    showImages: true,
    clearOnShrink: false,
  },
  images: {
    autoResize: true,
    blockImages: false,
  },
  doubleEscapeAction: "fork",
  editorPaddingX: 0,
  autocompleteMaxVisible: 5,
  showHardwareCursor: false,
  markdown: {
    codeBlockIndent: "  ",
  },
};

function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** Deep merge settings: overrides take precedence, nested objects merge recursively */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
  const result: Settings = { ...base };

  for (const key of Object.keys(overrides) as (keyof Settings)[]) {
    const overrideValue = overrides[key];
    const baseValue = base[key];

    if (overrideValue === undefined) {
      continue;
    }

    if (
      typeof overrideValue === "object" &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      (result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
    } else {
      (result as Record<string, unknown>)[key] = overrideValue;
    }
  }

  return result;
}

export type SettingsScope = "global";

export interface SettingsStorage {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

export interface SettingsError {
  scope: SettingsScope;
  error: Error;
}

export class FileSettingsStorage implements SettingsStorage {
  private globalSettingsPath: string;

  constructor(agentDir: string = getAgentDir()) {
    this.globalSettingsPath = join(agentDir, "settings.json");
  }

  initialize(defaultSettings: Settings = DEFAULT_SETTINGS): void {
    if (existsSync(this.globalSettingsPath)) {
      return;
    }

    mkdirSync(dirname(this.globalSettingsPath), { recursive: true });
    try {
      writeFileSync(this.globalSettingsPath, serializeSettings(defaultSettings), {
        encoding: "utf-8",
        flag: "wx",
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      if (code !== "EEXIST") {
        throw error;
      }
    }
  }

  private acquireLockSyncWithRetry(path: string): () => void {
    const maxAttempts = 10;
    const delayMs = 20;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return lockfile.lockSync(path, { realpath: false });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        if (code !== "ELOCKED" || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          // Sleep synchronously to avoid changing callers to async.
        }
      }
    }

    throw (lastError as Error) ?? new Error("Failed to acquire settings lock");
  }

  withLock(_scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const path = this.globalSettingsPath;
    const dir = dirname(path);

    let release: (() => void) | undefined;
    try {
      const fileExists = existsSync(path);
      if (fileExists) {
        release = this.acquireLockSyncWithRetry(path);
      }
      const current = fileExists ? readFileSync(path, "utf-8") : undefined;
      const next = fn(current);
      if (next !== undefined) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        if (!release) {
          try {
            writeFileSync(path, serializeSettings(DEFAULT_SETTINGS), {
              encoding: "utf-8",
              flag: "wx",
            });
          } catch (error) {
            const code =
              typeof error === "object" && error !== null && "code" in error
                ? String((error as { code?: unknown }).code)
                : undefined;
            if (code !== "EEXIST") {
              throw error;
            }
          }
          release = this.acquireLockSyncWithRetry(path);
        }
        writeFileSync(path, next, "utf-8");
      }
    } finally {
      if (release) {
        release();
      }
    }
  }
}

export class InMemorySettingsStorage implements SettingsStorage {
  private global: string | undefined;

  withLock(_scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    const next = fn(this.global);
    if (next !== undefined) {
      this.global = next;
    }
  }
}

export class SettingsManager {
  private storage: SettingsStorage;
  private globalSettings: Settings;
  private settings: Settings;
  private modifiedFields = new Set<keyof Settings>();
  private modifiedNestedFields = new Map<keyof Settings, Set<string>>();
  private globalSettingsLoadError: Error | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private errors: SettingsError[];

  private constructor(
    storage: SettingsStorage,
    initialGlobal: Settings,
    globalLoadError: Error | null = null,
    initialErrors: SettingsError[] = [],
  ) {
    this.storage = storage;
    this.globalSettings = deepMergeSettings(DEFAULT_SETTINGS, initialGlobal);
    this.globalSettingsLoadError = globalLoadError;
    this.errors = [...initialErrors];
    this.settings = structuredClone(this.globalSettings);
  }

  /** Create a SettingsManager that loads from files */
  static create(agentDir: string = getAgentDir()): SettingsManager {
    const storage = new FileSettingsStorage(agentDir);
    storage.initialize(DEFAULT_SETTINGS);
    return SettingsManager.fromStorage(storage);
  }

  /** Create a SettingsManager from an arbitrary storage backend */
  static fromStorage(storage: SettingsStorage): SettingsManager {
    const globalLoad = SettingsManager.tryLoadFromStorage(storage, "global");
    const initialErrors: SettingsError[] = [];
    if (globalLoad.error) {
      initialErrors.push({ scope: "global", error: globalLoad.error });
    }

    return new SettingsManager(storage, globalLoad.settings, globalLoad.error, initialErrors);
  }

  /** Create an in-memory SettingsManager (no file I/O) */
  static inMemory(settings: Partial<Settings> = {}): SettingsManager {
    const storage = new InMemorySettingsStorage();
    return new SettingsManager(storage, settings, null);
  }

  private static loadFromStorage(storage: SettingsStorage, scope: SettingsScope): Settings {
    let content: string | undefined;
    storage.withLock(scope, (current) => {
      content = current;
      return undefined;
    });

    if (!content) {
      return {};
    }
    const settings = JSON.parse(content);
    return SettingsManager.migrateSettings(settings);
  }

  private static tryLoadFromStorage(
    storage: SettingsStorage,
    scope: SettingsScope,
  ): { settings: Settings; error: Error | null } {
    try {
      return { settings: SettingsManager.loadFromStorage(storage, scope), error: null };
    } catch (error) {
      return { settings: {}, error: error as Error };
    }
  }

  /** Settings migration hook (currently no legacy field transforms). */
  private static migrateSettings(settings: Record<string, unknown>): Settings {
    return settings as Settings;
  }

  getGlobalSettings(): Settings {
    return structuredClone(this.globalSettings);
  }

  reload(): void {
    const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
    if (!globalLoad.error) {
      this.globalSettings = deepMergeSettings(DEFAULT_SETTINGS, globalLoad.settings);
      this.globalSettingsLoadError = null;
    } else {
      this.globalSettingsLoadError = globalLoad.error;
      this.recordError("global", globalLoad.error);
    }

    this.modifiedFields.clear();
    this.modifiedNestedFields.clear();
    this.settings = structuredClone(this.globalSettings);
  }

  /** Apply additional overrides on top of current settings */
  applyOverrides(overrides: Partial<Settings>): void {
    this.settings = deepMergeSettings(this.settings, overrides);
  }

  private markModified(field: keyof Settings, nestedKey?: string): void {
    this.modifiedFields.add(field);
    if (nestedKey) {
      if (!this.modifiedNestedFields.has(field)) {
        this.modifiedNestedFields.set(field, new Set());
      }
      this.modifiedNestedFields.get(field)!.add(nestedKey);
    }
  }

  private recordError(scope: SettingsScope, error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    this.errors.push({ scope, error: normalizedError });
  }

  private clearModifiedFields(): void {
    this.modifiedFields.clear();
    this.modifiedNestedFields.clear();
  }

  private enqueueWrite(task: () => void): void {
    this.writeQueue = this.writeQueue
      .then(() => {
        task();
        this.clearModifiedFields();
      })
      .catch((error) => {
        this.recordError("global", error);
      });
  }

  private cloneModifiedNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
    const snapshot = new Map<keyof Settings, Set<string>>();
    for (const [key, value] of source.entries()) {
      snapshot.set(key, new Set(value));
    }
    return snapshot;
  }

  private persistSettings(
    snapshotSettings: Settings,
    modifiedFields: Set<keyof Settings>,
    modifiedNestedFields: Map<keyof Settings, Set<string>>,
  ): void {
    this.storage.withLock("global", (current) => {
      const currentFileSettings = current
        ? deepMergeSettings(
            DEFAULT_SETTINGS,
            SettingsManager.migrateSettings(JSON.parse(current) as Record<string, unknown>),
          )
        : structuredClone(DEFAULT_SETTINGS);
      const mergedSettings: Settings = { ...currentFileSettings };

      for (const field of modifiedFields) {
        const value = snapshotSettings[field];
        if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
          const nestedModified = modifiedNestedFields.get(field)!;
          const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
          const inMemoryNested = value as Record<string, unknown>;
          const mergedNested = { ...baseNested };
          for (const nestedKey of nestedModified) {
            mergedNested[nestedKey] = inMemoryNested[nestedKey];
          }
          (mergedSettings as Record<string, unknown>)[field] = mergedNested;
        } else {
          (mergedSettings as Record<string, unknown>)[field] = value;
        }
      }

      return serializeSettings(mergedSettings);
    });
  }

  private save(): void {
    this.settings = structuredClone(this.globalSettings);

    if (this.globalSettingsLoadError) {
      return;
    }

    const snapshotGlobalSettings = structuredClone(this.globalSettings);
    const modifiedFields = new Set(this.modifiedFields);
    const modifiedNestedFields = this.cloneModifiedNestedFields(this.modifiedNestedFields);

    this.enqueueWrite(() => {
      this.persistSettings(snapshotGlobalSettings, modifiedFields, modifiedNestedFields);
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  drainErrors(): SettingsError[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }

  getLastChangelogVersion(): string | undefined {
    return this.settings.lastChangelogVersion;
  }

  setLastChangelogVersion(version: string): void {
    this.globalSettings.lastChangelogVersion = version;
    this.markModified("lastChangelogVersion");
    this.save();
  }

  getSteeringMode(): "all" | "one-at-a-time" {
    return this.settings.steeringMode ?? DEFAULT_SETTINGS.steeringMode!;
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.globalSettings.steeringMode = mode;
    this.markModified("steeringMode");
    this.save();
  }

  getFollowUpMode(): "all" | "one-at-a-time" {
    return this.settings.followUpMode ?? DEFAULT_SETTINGS.followUpMode!;
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.globalSettings.followUpMode = mode;
    this.markModified("followUpMode");
    this.save();
  }

  getTheme(): string | undefined {
    return this.settings.theme;
  }

  setTheme(theme: string): void {
    this.globalSettings.theme = theme;
    this.markModified("theme");
    this.save();
  }

  getClaudeAgentSdkOptions(): Record<string, unknown> | undefined {
    const value = this.settings.claudeAgentSdk;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return structuredClone(value);
  }

  getCompactionEnabled(): boolean {
    return this.settings.compaction?.enabled ?? DEFAULT_SETTINGS.compaction!.enabled!;
  }

  setCompactionEnabled(enabled: boolean): void {
    if (!this.globalSettings.compaction) {
      this.globalSettings.compaction = {};
    }
    this.globalSettings.compaction.enabled = enabled;
    this.markModified("compaction", "enabled");
    this.save();
  }

  getCompactionReserveTokens(): number {
    return this.settings.compaction?.reserveTokens ?? DEFAULT_SETTINGS.compaction!.reserveTokens!;
  }

  getCompactionKeepRecentTokens(): number {
    return this.settings.compaction?.keepRecentTokens ?? DEFAULT_SETTINGS.compaction!.keepRecentTokens!;
  }

  getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } {
    return {
      enabled: this.getCompactionEnabled(),
      reserveTokens: this.getCompactionReserveTokens(),
      keepRecentTokens: this.getCompactionKeepRecentTokens(),
    };
  }

  getRetryEnabled(): boolean {
    return this.settings.retry?.enabled ?? DEFAULT_SETTINGS.retry!.enabled!;
  }

  setRetryEnabled(enabled: boolean): void {
    if (!this.globalSettings.retry) {
      this.globalSettings.retry = {};
    }
    this.globalSettings.retry.enabled = enabled;
    this.markModified("retry", "enabled");
    this.save();
  }

  getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number; maxDelayMs: number } {
    return {
      enabled: this.getRetryEnabled(),
      maxRetries: this.settings.retry?.maxRetries ?? DEFAULT_SETTINGS.retry!.maxRetries!,
      baseDelayMs: this.settings.retry?.baseDelayMs ?? DEFAULT_SETTINGS.retry!.baseDelayMs!,
      maxDelayMs: this.settings.retry?.maxDelayMs ?? DEFAULT_SETTINGS.retry!.maxDelayMs!,
    };
  }

  getHideThinkingBlock(): boolean {
    return this.settings.hideThinkingBlock ?? DEFAULT_SETTINGS.hideThinkingBlock!;
  }

  setHideThinkingBlock(hide: boolean): void {
    this.globalSettings.hideThinkingBlock = hide;
    this.markModified("hideThinkingBlock");
    this.save();
  }

  getShellPath(): string | undefined {
    return this.settings.shellPath;
  }

  setShellPath(path: string | undefined): void {
    this.globalSettings.shellPath = path;
    this.markModified("shellPath");
    this.save();
  }

  getQuietStartup(): boolean {
    return this.settings.quietStartup ?? DEFAULT_SETTINGS.quietStartup!;
  }

  setQuietStartup(quiet: boolean): void {
    this.globalSettings.quietStartup = quiet;
    this.markModified("quietStartup");
    this.save();
  }

  getShellCommandPrefix(): string | undefined {
    return this.settings.shellCommandPrefix;
  }

  setShellCommandPrefix(prefix: string | undefined): void {
    this.globalSettings.shellCommandPrefix = prefix;
    this.markModified("shellCommandPrefix");
    this.save();
  }

  getNpmCommand(): string[] | undefined {
    return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
  }

  setNpmCommand(command: string[] | undefined): void {
    this.globalSettings.npmCommand = command ? [...command] : undefined;
    this.markModified("npmCommand");
    this.save();
  }

  getCollapseChangelog(): boolean {
    return this.settings.collapseChangelog ?? DEFAULT_SETTINGS.collapseChangelog!;
  }

  setCollapseChangelog(collapse: boolean): void {
    this.globalSettings.collapseChangelog = collapse;
    this.markModified("collapseChangelog");
    this.save();
  }

  getPackages(): PackageSource[] {
    return [...(this.settings.packages ?? [])];
  }

  setPackages(packages: PackageSource[]): void {
    this.globalSettings.packages = packages;
    this.markModified("packages");
    this.save();
  }

  getExtensionPaths(): string[] {
    return [...(this.settings.extensions ?? [])];
  }

  setExtensionPaths(paths: string[]): void {
    this.globalSettings.extensions = paths;
    this.markModified("extensions");
    this.save();
  }

  getPromptTemplatePaths(): string[] {
    return [...(this.settings.prompts ?? [])];
  }

  setPromptTemplatePaths(paths: string[]): void {
    this.globalSettings.prompts = paths;
    this.markModified("prompts");
    this.save();
  }

  getThemePaths(): string[] {
    return [...(this.settings.themes ?? [])];
  }

  setThemePaths(paths: string[]): void {
    this.globalSettings.themes = paths;
    this.markModified("themes");
    this.save();
  }

  getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
    return this.settings.thinkingBudgets;
  }

  getShowImages(): boolean {
    return this.settings.terminal?.showImages ?? DEFAULT_SETTINGS.terminal!.showImages!;
  }

  setShowImages(show: boolean): void {
    if (!this.globalSettings.terminal) {
      this.globalSettings.terminal = {};
    }
    this.globalSettings.terminal.showImages = show;
    this.markModified("terminal", "showImages");
    this.save();
  }

  getClearOnShrink(): boolean {
    return this.settings.terminal?.clearOnShrink ?? DEFAULT_SETTINGS.terminal!.clearOnShrink!;
  }

  setClearOnShrink(enabled: boolean): void {
    if (!this.globalSettings.terminal) {
      this.globalSettings.terminal = {};
    }
    this.globalSettings.terminal.clearOnShrink = enabled;
    this.markModified("terminal", "clearOnShrink");
    this.save();
  }

  getImageAutoResize(): boolean {
    return this.settings.images?.autoResize ?? DEFAULT_SETTINGS.images!.autoResize!;
  }

  setImageAutoResize(enabled: boolean): void {
    if (!this.globalSettings.images) {
      this.globalSettings.images = {};
    }
    this.globalSettings.images.autoResize = enabled;
    this.markModified("images", "autoResize");
    this.save();
  }

  getBlockImages(): boolean {
    return this.settings.images?.blockImages ?? DEFAULT_SETTINGS.images!.blockImages!;
  }

  setBlockImages(blocked: boolean): void {
    if (!this.globalSettings.images) {
      this.globalSettings.images = {};
    }
    this.globalSettings.images.blockImages = blocked;
    this.markModified("images", "blockImages");
    this.save();
  }

  getDoubleEscapeAction(): "fork" | "none" {
    return this.settings.doubleEscapeAction ?? DEFAULT_SETTINGS.doubleEscapeAction!;
  }

  setDoubleEscapeAction(action: "fork" | "none"): void {
    this.globalSettings.doubleEscapeAction = action;
    this.markModified("doubleEscapeAction");
    this.save();
  }

  getShowHardwareCursor(): boolean {
    return this.settings.showHardwareCursor ?? DEFAULT_SETTINGS.showHardwareCursor!;
  }

  setShowHardwareCursor(enabled: boolean): void {
    this.globalSettings.showHardwareCursor = enabled;
    this.markModified("showHardwareCursor");
    this.save();
  }

  getEditorPaddingX(): number {
    return this.settings.editorPaddingX ?? DEFAULT_SETTINGS.editorPaddingX!;
  }

  setEditorPaddingX(padding: number): void {
    this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
    this.markModified("editorPaddingX");
    this.save();
  }

  getAutocompleteMaxVisible(): number {
    return this.settings.autocompleteMaxVisible ?? DEFAULT_SETTINGS.autocompleteMaxVisible!;
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
    this.markModified("autocompleteMaxVisible");
    this.save();
  }

  getCodeBlockIndent(): string {
    return this.settings.markdown?.codeBlockIndent ?? DEFAULT_SETTINGS.markdown!.codeBlockIndent!;
  }

  /**
   * Resolve a configuration value with default fallback.
   * Used for config value resolution where the setting might be undefined.
   */
  resolveConfigValue<T>(getter: () => T | undefined, defaultValue: T): T {
    const value = getter();
    return value !== undefined ? value : defaultValue;
  }
}

export function getAgentDir(): string {
  const envDir = process.env.OMI_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), ".omi");
}

export function getBinDir(): string {
  return join(getAgentDir(), "bin");
}
