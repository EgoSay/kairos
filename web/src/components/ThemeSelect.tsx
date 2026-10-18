import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactElement } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslate } from "@/utils/i18n";
import { loadTheme, parseThemePreference, serializeThemePreference, THEME_MODE_OPTIONS, type ThemePreference } from "@/utils/theme";

interface ThemeSelectProps {
  value?: string;
  onValueChange?: (theme: string) => void;
  className?: string;
  compact?: boolean;
}

const MODE_ICONS: Record<ThemePreference["mode"], ReactElement> = {
  system: <Monitor className="w-4 h-4" />,
  light: <Sun className="w-4 h-4" />,
  dark: <Moon className="w-4 h-4" />,
};

/** Brightness-only picker (auth pages / compact chrome): the surface axis is preserved untouched. */
const ThemeSelect = ({ value, onValueChange, className, compact = false }: ThemeSelectProps = {}) => {
  const t = useTranslate();
  const pref = parseThemePreference(value) ?? { mode: "system" as const, surface: "plain" as const };

  const handleModeChange = (newMode: string) => {
    const next = serializeThemePreference({ ...pref, mode: newMode as ThemePreference["mode"] });
    loadTheme(next);
    onValueChange?.(next);
  };

  return (
    <Select value={pref.mode} onValueChange={handleModeChange}>
      <SelectTrigger className={className}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {compact && MODE_ICONS[pref.mode]}
          <SelectValue className="truncate" placeholder={t("setting.preference.theme")} />
        </div>
      </SelectTrigger>
      <SelectContent>
        {THEME_MODE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              {MODE_ICONS[option.value]}
              <span>{t(option.labelKey)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default ThemeSelect;
