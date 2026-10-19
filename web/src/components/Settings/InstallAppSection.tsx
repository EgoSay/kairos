import { CheckIcon, DownloadIcon, SmartphoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/contexts/PWAInstallContext";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

export default function InstallAppSection() {
  const t = useTranslate();
  const { installed, canInstall, installing, result, install } = usePWAInstall();
  const secure = window.isSecureContext;

  return (
    <SettingSection title={t("setting.install-app.label")}>
      <SettingGroup description={t("pwa.description")}>
        <SettingList>
          <SettingListItem
            icon={installed ? <CheckIcon className="size-5" /> : <SmartphoneIcon className="size-5" />}
            label={installed ? t("pwa.installed") : t("pwa.home-screen")}
            description={installed ? t("pwa.installed-description") : t("pwa.launch-description")}
          >
            {!installed && secure && (canInstall || installing) && (
              <Button disabled={installing} onClick={() => void install()}>
                <DownloadIcon className="size-4" />
                {installing ? t("pwa.installing") : t("pwa.install")}
              </Button>
            )}
          </SettingListItem>
        </SettingList>
        {!installed && !secure && <p className="text-sm text-destructive">{t("pwa.https-required")}</p>}
        {!installed && result && (
          <p role={result === "failed" ? "alert" : "status"} className="text-sm text-muted-foreground">
            {t(result === "accepted" ? "pwa.accepted" : result === "dismissed" ? "pwa.dismissed" : "pwa.failed")}
          </p>
        )}
      </SettingGroup>

      {!installed && secure && (
        <SettingGroup title={t("pwa.manual-title")} description={t("pwa.manual-description")} showSeparator>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">iPhone / iPad</h4>
              <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
                <li>{t("pwa.ios-open")}</li>
                <li>{t("pwa.ios-share")}</li>
                <li>{t("pwa.ios-add")}</li>
              </ol>
            </div>
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Android</h4>
              <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
                <li>{t("pwa.android-open")}</li>
                <li>{t("pwa.android-menu")}</li>
                <li>{t("pwa.android-add")}</li>
              </ol>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("pwa.browser-help")}</p>
        </SettingGroup>
      )}

      <SettingGroup title={t("pwa.offline-title")} description={t("pwa.offline-description")} showSeparator>
        <p className="text-xs leading-5 text-muted-foreground">{t("pwa.draft-warning")}</p>
      </SettingGroup>
    </SettingSection>
  );
}
