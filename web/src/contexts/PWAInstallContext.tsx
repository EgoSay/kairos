import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallResult = "accepted" | "dismissed" | "failed";

interface PWAInstallState {
  installed: boolean;
  canInstall: boolean;
  installing: boolean;
  result?: InstallResult;
  install: () => Promise<void>;
}

const PWAInstallContext = createContext<PWAInstallState | undefined>(undefined);
const standaloneQuery = "(display-mode: standalone)";
const isStandalone = () =>
  window.matchMedia(standaloneQuery).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Keep the browser's one-use install event across authentication and route changes. */
export function PWAInstallProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(isStandalone);
  const [canInstall, setCanInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult>();
  const promptRef = useRef<InstallPromptEvent | undefined>(undefined);
  const busyRef = useRef(false);

  useEffect(() => {
    const displayMode = window.matchMedia(standaloneQuery);
    const onInstalled = () => {
      promptRef.current = undefined;
      setCanInstall(false);
      setInstalled(true);
      setResult(undefined);
    };
    const onDisplayModeChange = () => {
      if (isStandalone()) onInstalled();
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
      setCanInstall(true);
      setResult(undefined);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const install = async () => {
    const event = promptRef.current;
    if (!event || installed || busyRef.current) return;
    // Consume before awaiting: browsers allow prompt() only once per event.
    promptRef.current = undefined;
    busyRef.current = true;
    setCanInstall(false);
    setInstalling(true);
    setResult(undefined);
    try {
      // This must run directly in the button's user gesture, before any await.
      await event.prompt();
      const choice = await event.userChoice;
      setResult(choice.outcome);
    } catch {
      setResult("failed");
    } finally {
      busyRef.current = false;
      setInstalling(false);
    }
  };

  return <PWAInstallContext.Provider value={{ installed, canInstall, installing, result, install }}>{children}</PWAInstallContext.Provider>;
}

export function usePWAInstall() {
  const context = useContext(PWAInstallContext);
  if (!context) throw new Error("usePWAInstall must be used within PWAInstallProvider");
  return context;
}
