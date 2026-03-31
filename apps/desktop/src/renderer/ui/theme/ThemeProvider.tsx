import {
  DEFAULT_PRESET_ID,
  DEFAULT_SHIKI_THEME,
  PRESET_REGISTRY,
  type ShikiThemeConfig,
  type ThemeFile,
  type ThemeOverrides,
  composeThemes,
  getShikiTheme,
  resolveThemePreset,
  themeToVariables,
} from "@/tokens";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeProviderProps {
  children: ReactNode;
  mode?: ThemeMode;
  defaultMode?: ThemeMode;
  onModeChange?: (mode: ThemeMode) => void;
  presetId?: string | null;
  defaultPresetId?: string | null;
  onPresetIdChange?: (presetId: string | null) => void;
  previewPresetId?: string | null;
  theme?: ThemeOverrides | ThemeFile;
  font?: string;
  defaultFont?: string;
  onFontChange?: (font: string) => void;
  applyToDocument?: boolean;
}

export interface ThemeContextValue {
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  presetId: string | null;
  previewPresetId: string | null;
  font: string;
  resolvedTheme: ThemeOverrides;
  resolvedPreset: ReturnType<typeof resolveThemePreset>;
  shikiConfig: ShikiThemeConfig;
  shikiTheme: string;
  cssVariables: Record<string, string>;
  setMode: (mode: ThemeMode) => void;
  setPresetId: (presetId: string | null) => void;
  setFont: (font: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (nextValue: T) => void,
): [T, (nextValue: T) => void] {
  const [internalValue, setInternalValue] = useState<T>(defaultValue);
  const resolvedValue = value === undefined ? internalValue : value;

  const setValue = (nextValue: T) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
  };

  return [resolvedValue, setValue];
}

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  children,
  mode,
  defaultMode = "system",
  onModeChange,
  presetId,
  defaultPresetId = DEFAULT_PRESET_ID,
  onPresetIdChange,
  previewPresetId = null,
  theme,
  font,
  defaultFont = "system",
  onFontChange,
  applyToDocument = true,
}: ThemeProviderProps) {
  const [resolvedModePreference, setMode] = useControllableState(mode, defaultMode, onModeChange);
  const [resolvedPresetId, setPresetId] = useControllableState<string | null>(
    presetId,
    defaultPresetId,
    onPresetIdChange,
  );
  const [resolvedFont, setFont] = useControllableState(font, defaultFont, onFontChange);
  const [systemPreference, setSystemPreference] = useState<"light" | "dark">(getSystemPreference);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const activePresetId = previewPresetId ?? resolvedPresetId ?? DEFAULT_PRESET_ID;
  const resolvedPreset = useMemo(
    () => resolveThemePreset(activePresetId, PRESET_REGISTRY),
    [activePresetId],
  );
  const resolvedMode =
    resolvedModePreference === "system" ? systemPreference : resolvedModePreference;
  const resolvedTheme = useMemo(
    () => composeThemes(resolvedPreset.theme, theme),
    [resolvedPreset.theme, theme],
  );
  const shikiConfig = useMemo<ShikiThemeConfig>(() => {
    const themeLevelConfig = "shikiTheme" in resolvedTheme ? resolvedTheme.shikiTheme : undefined;
    return themeLevelConfig ?? resolvedPreset.theme.shikiTheme ?? DEFAULT_SHIKI_THEME;
  }, [resolvedPreset.theme.shikiTheme, resolvedTheme]);
  const shikiTheme = useMemo(
    () => getShikiTheme(shikiConfig, resolvedMode === "dark"),
    [shikiConfig, resolvedMode],
  );
  const cssVariables = useMemo(
    () => themeToVariables(resolvedTheme, resolvedMode === "dark"),
    [resolvedMode, resolvedTheme],
  );

  useEffect(() => {
    if (!applyToDocument || typeof document === "undefined") return;

    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedMode);
    root.dataset.font = resolvedFont;

    for (const [name, value] of Object.entries(cssVariables)) {
      root.style.setProperty(name, value);
    }

    if (resolvedTheme.mode === "scenic" && resolvedTheme.backgroundImage) {
      root.dataset.scenic = "true";
      root.style.setProperty("--background-image", `url("${resolvedTheme.backgroundImage}")`);
    } else {
      delete root.dataset.scenic;
      root.style.removeProperty("--background-image");
    }
  }, [applyToDocument, cssVariables, resolvedFont, resolvedMode, resolvedTheme]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      mode: resolvedModePreference,
      resolvedMode,
      presetId: resolvedPresetId,
      previewPresetId,
      font: resolvedFont,
      resolvedTheme,
      resolvedPreset,
      shikiConfig,
      shikiTheme,
      cssVariables,
      setMode,
      setPresetId,
      setFont,
    }),
    [
      cssVariables,
      previewPresetId,
      resolvedFont,
      resolvedMode,
      resolvedModePreference,
      resolvedPreset,
      resolvedPresetId,
      resolvedTheme,
      setFont,
      setMode,
      setPresetId,
      shikiConfig,
      shikiTheme,
    ],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
