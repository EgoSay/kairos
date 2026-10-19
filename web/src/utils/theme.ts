import defaultDarkThemeContent from "../themes/default-dark.css?raw";
import paperThemeContent from "../themes/paper.css?raw";
import paperDarkThemeContent from "../themes/paper-dark.css?raw";

// ============================================================================
// Types and Constants
// ============================================================================
//
// Theme preference = two axes serialized into one string: `mode[:paper]`.
//   mode    — "system" | "light" | "dark"   (brightness axis)
//   surface — "plain" | "paper"             (finish axis; only "paper" serializes)
// Canonical values: system | system:paper | light | light:paper | dark | dark:paper
// Legacy values still parse: system, default, default-dark, paper.

type ThemeMode = "system" | "light" | "dark";
export type ThemeSurface = "plain" | "paper";

export interface ThemePreference {
  mode: ThemeMode;
  surface: ThemeSurface;
}

export type Theme = "system" | "system:paper" | "light" | "light:paper" | "dark" | "dark:paper";
export type ResolvedTheme = "default" | "default-dark" | "paper" | "paper-dark";

export interface ThemeOption {
  value: string;
  label: string;
}

const STORAGE_KEY = "memos-theme";
const STYLE_ELEMENT_ID = "instance-theme";

const THEME_CONTENT: Record<ResolvedTheme, string | null> = {
  default: null,
  "default-dark": defaultDarkThemeContent,
  paper: paperThemeContent,
  "paper-dark": paperDarkThemeContent,
};

const THEME_COLORS: Record<ResolvedTheme, string> = {
  default: "#faf9f5",
  "default-dark": "#1d1f23",
  paper: "#f5ede4",
  "paper-dark": "#352c22",
};

/** i18n keys for each axis option — labels resolve through useTranslate at render time. */
export const THEME_MODE_OPTIONS = [
  { value: "system", labelKey: "setting.preference.theme-mode-system" },
  { value: "light", labelKey: "setting.preference.theme-mode-light" },
  { value: "dark", labelKey: "setting.preference.theme-mode-dark" },
] as const;

export const THEME_SURFACE_OPTIONS = [
  { value: "plain", labelKey: "setting.preference.theme-surface-plain" },
  { value: "paper", labelKey: "setting.preference.theme-surface-paper" },
] as const;

// ============================================================================
// Parsing and Serialization
// ============================================================================

const LEGACY_MAP: Record<string, ThemePreference> = {
  system: { mode: "system", surface: "plain" },
  default: { mode: "light", surface: "plain" },
  "default-dark": { mode: "dark", surface: "plain" },
  paper: { mode: "light", surface: "paper" },
};

const VALID_MODES: readonly string[] = ["system", "light", "dark"];

export const serializeThemePreference = (pref: ThemePreference): Theme => {
  return (pref.surface === "paper" ? `${pref.mode}:paper` : pref.mode) as Theme;
};

/**
 * Parses a stored theme string into its preference axes.
 * Accepts both the canonical `mode[:paper]` form and legacy flat values.
 * Returns null for anything unrecognized.
 */
export const parseThemePreference = (value: string | null | undefined): ThemePreference | null => {
  if (!value) return null;
  if (value in LEGACY_MAP) return LEGACY_MAP[value];
  const [mode, surface] = value.split(":");
  if (!VALID_MODES.includes(mode)) return null;
  if (surface !== undefined && surface !== "paper") return null;
  return { mode: mode as ThemeMode, surface: surface === "paper" ? "paper" : "plain" };
};

const SURFACE_FILES: Record<ThemeSurface, { light: ResolvedTheme; dark: ResolvedTheme }> = {
  plain: { light: "default", dark: "default-dark" },
  paper: { light: "paper", dark: "paper-dark" },
};

// ============================================================================
// Theme Validation and Detection
// ============================================================================

/**
 * Detects the system's preferred brightness.
 */
export const getSystemMode = (): "light" | "dark" => {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
};

/** Kept for API compatibility: resolves the OS brightness to a plain-surface file. */
export const getSystemTheme = (): ResolvedTheme => {
  return SURFACE_FILES.plain[getSystemMode()];
};

/**
 * Resolves a preference string to the concrete theme file in effect.
 * "system" mode reads the OS scheme at call time; surface rides along.
 */
export const resolveTheme = (theme: string): ResolvedTheme => {
  const pref = parseThemePreference(theme) ?? LEGACY_MAP.system;
  const brightness = pref.mode === "system" ? getSystemMode() : pref.mode;
  return SURFACE_FILES[pref.surface][brightness];
};

// ============================================================================
// LocalStorage Helpers
// ============================================================================

const getStoredTheme = (): Theme | null => {
  try {
    const pref = parseThemePreference(localStorage.getItem(STORAGE_KEY));
    return pref ? serializeThemePreference(pref) : null;
  } catch {
    return null;
  }
};

const setStoredTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage might not be available (SSR, private browsing, etc.)
  }
};

// ============================================================================
// Theme Selection with Fallbacks
// ============================================================================

/**
 * Gets the theme for initial page load (before user settings are available).
 * Priority: localStorage -> system preference
 */
export const getInitialTheme = (): Theme => {
  return getStoredTheme() ?? "system";
};

/**
 * Gets the theme with full fallback chain.
 * Priority: user setting -> localStorage -> system
 */
export const getThemeWithFallback = (userTheme?: string): Theme => {
  const userPref = parseThemePreference(userTheme);
  if (userPref) return serializeThemePreference(userPref);
  return getStoredTheme() ?? "system";
};

// ============================================================================
// DOM Manipulation
// ============================================================================

const removeThemeStyle = (): void => {
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
};

const injectThemeStyle = (theme: ResolvedTheme): void => {
  removeThemeStyle();

  if (theme === "default") {
    return; // Use base CSS for default theme
  }

  const css = THEME_CONTENT[theme];
  if (css) {
    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
};

const setThemeAttribute = (theme: ResolvedTheme): void => {
  document.documentElement.setAttribute("data-theme", theme);
};

const updateThemeColorMeta = (theme: Theme): void => {
  const lightMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="light"]');
  const darkMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="dark"]');

  const pref = parseThemePreference(theme) ?? { mode: "system" as const, surface: "plain" as const };
  if (pref.mode === "system") {
    if (lightMeta) {
      lightMeta.content = THEME_COLORS[SURFACE_FILES[pref.surface].light];
    }
    if (darkMeta) {
      darkMeta.content = THEME_COLORS[SURFACE_FILES[pref.surface].dark];
    }
    return;
  }

  const color = THEME_COLORS[resolveTheme(theme)];
  if (lightMeta) {
    lightMeta.content = color;
  }
  if (darkMeta) {
    darkMeta.content = color;
  }
};

export const isDarkTheme = (theme: ResolvedTheme): boolean => {
  return theme.endsWith("-dark");
};

const updateColorScheme = (theme: ResolvedTheme): void => {
  document.documentElement.style.colorScheme = isDarkTheme(theme) ? "dark" : "light";
};

// ============================================================================
// Main Theme Loading
// ============================================================================

/**
 * Loads and applies a theme preference: parses both axes, resolves "system"
 * through the OS scheme, injects theme CSS, updates chrome hints, and persists
 * the canonical string.
 */
export const loadTheme = (themeName: string): void => {
  const pref = parseThemePreference(themeName) ?? LEGACY_MAP.system;
  const canonical = serializeThemePreference(pref);
  const resolvedTheme = resolveTheme(canonical);

  injectThemeStyle(resolvedTheme);
  setThemeAttribute(resolvedTheme);
  updateThemeColorMeta(canonical);
  updateColorScheme(resolvedTheme);
  setStoredTheme(canonical);
};

export const applyThemeEarly = (): void => {
  loadTheme(getInitialTheme());
};

// ============================================================================
// System Theme Listener
// ============================================================================

/**
 * Sets up a listener for OS-level brightness preference changes.
 * Callers re-run loadTheme when the active mode is "system".
 */
export const setupSystemThemeListener = (onThemeChange: () => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", onThemeChange);
    return () => mediaQuery.removeEventListener("change", onThemeChange);
  }

  if (mediaQuery.addListener) {
    mediaQuery.addListener(onThemeChange);
    return () => mediaQuery.removeListener(onThemeChange);
  }

  return () => {};
};
