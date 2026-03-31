import catppuccinThemeJson from "./presets/catppuccin.json";
import defaultThemeJson from "./presets/default.json";
import draculaThemeJson from "./presets/dracula.json";
import ghosttyThemeJson from "./presets/ghostty.json";
import githubThemeJson from "./presets/github.json";
import gruvboxThemeJson from "./presets/gruvbox.json";
import hazeThemeJson from "./presets/haze.json";
import neutralThemeJson from "./presets/neutral.json";
import nightOwlThemeJson from "./presets/night-owl.json";
import nordThemeJson from "./presets/nord.json";
import oneDarkProThemeJson from "./presets/one-dark-pro.json";
import pierreThemeJson from "./presets/pierre.json";
import rosePineThemeJson from "./presets/rose-pine.json";
import solarizedThemeJson from "./presets/solarized.json";
import tokyoNightThemeJson from "./presets/tokyo-night.json";
import vitesseThemeJson from "./presets/vitesse.json";
import type { ThemeFile } from "./theme";

export interface ThemePreset {
  id: string;
  label: string;
  kind: "neutral" | "brand" | "bundled";
  theme: ThemeFile;
}

export type ThemePresetRegistry = Map<string, ThemePreset>;

export const NEUTRAL_PRESET_ID = "neutral";
export const CRAFT_PRESET_ID = "craft";
export const DEFAULT_PRESET_ID = NEUTRAL_PRESET_ID;

export const NEUTRAL_THEME = neutralThemeJson as ThemeFile;
export const CRAFT_THEME = defaultThemeJson as ThemeFile;

export const NEUTRAL_PRESET: ThemePreset = {
  id: NEUTRAL_PRESET_ID,
  label: "Neutral",
  kind: "neutral",
  theme: NEUTRAL_THEME,
};

export const CRAFT_PRESET: ThemePreset = {
  id: CRAFT_PRESET_ID,
  label: "Craft",
  kind: "brand",
  theme: CRAFT_THEME,
};

const bundledThemeEntries: Array<[string, string, ThemeFile]> = [
  ["default", "Default", defaultThemeJson as ThemeFile],
  ["catppuccin", "Catppuccin", catppuccinThemeJson as ThemeFile],
  ["dracula", "Dracula", draculaThemeJson as ThemeFile],
  ["ghostty", "Ghostty", ghosttyThemeJson as ThemeFile],
  ["github", "GitHub", githubThemeJson as ThemeFile],
  ["gruvbox", "Gruvbox", gruvboxThemeJson as ThemeFile],
  ["haze", "Haze", hazeThemeJson as ThemeFile],
  ["night-owl", "Night Owl", nightOwlThemeJson as ThemeFile],
  ["nord", "Nord", nordThemeJson as ThemeFile],
  ["one-dark-pro", "One Dark Pro", oneDarkProThemeJson as ThemeFile],
  ["pierre", "Pierre", pierreThemeJson as ThemeFile],
  ["rose-pine", "Rose Pine", rosePineThemeJson as ThemeFile],
  ["solarized", "Solarized", solarizedThemeJson as ThemeFile],
  ["tokyo-night", "Tokyo Night", tokyoNightThemeJson as ThemeFile],
  ["vitesse", "Vitesse", vitesseThemeJson as ThemeFile],
];

export const BUNDLED_PRESETS: ThemePreset[] = bundledThemeEntries.map(([id, label, theme]) => ({
  id,
  label,
  kind: "bundled",
  theme,
}));

export function createThemePresetRegistry(
  presets: Iterable<ThemePreset> = [NEUTRAL_PRESET, CRAFT_PRESET, ...BUNDLED_PRESETS],
): ThemePresetRegistry {
  return new Map(Array.from(presets, (preset) => [preset.id, preset]));
}

export const PRESET_REGISTRY = createThemePresetRegistry();

export function listThemePresets(registry: ThemePresetRegistry = PRESET_REGISTRY): ThemePreset[] {
  return Array.from(registry.values());
}

export function getThemePreset(
  id: string | null | undefined,
  registry: ThemePresetRegistry = PRESET_REGISTRY,
): ThemePreset | null {
  if (!id) return null;
  return registry.get(id) ?? null;
}

export function resolveThemePreset(
  id: string | null | undefined,
  registry: ThemePresetRegistry = PRESET_REGISTRY,
  fallbackId: string = DEFAULT_PRESET_ID,
): ThemePreset {
  return getThemePreset(id, registry) ?? getThemePreset(fallbackId, registry) ?? NEUTRAL_PRESET;
}
