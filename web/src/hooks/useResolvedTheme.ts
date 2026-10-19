import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getSystemMode,
  getThemeWithFallback,
  parseThemePreference,
  type ResolvedTheme,
  resolveTheme,
  serializeThemePreference,
  setupSystemThemeListener,
} from "@/utils/theme";

/** The theme actually in effect: the user's setting, or the OS scheme while that setting is "system". */
export const useResolvedTheme = (): ResolvedTheme => {
  const { userGeneralSetting } = useAuth();
  const theme = getThemeWithFallback(userGeneralSetting?.theme);
  const [systemMode, setSystemMode] = useState(getSystemMode);
  // Keep the OS mode current even while a fixed mode is selected, so returning
  // to "system" cannot reuse an old brightness. The surface stays independent.
  useEffect(() => {
    return setupSystemThemeListener(() => setSystemMode(getSystemMode()));
  }, []);
  const preference = parseThemePreference(theme);
  return resolveTheme(preference?.mode === "system" ? serializeThemePreference({ ...preference, mode: systemMode }) : theme);
};
