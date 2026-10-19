import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallAppSection from "@/components/Settings/InstallAppSection";
import { PWAInstallProvider } from "@/contexts/PWAInstallContext";

vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

let standalone: boolean;
let displayMode: EventTarget;

beforeEach(() => {
  standalone = false;
  displayMode = new EventTarget();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return standalone;
    },
    addEventListener: displayMode.addEventListener.bind(displayMode),
    removeEventListener: displayMode.removeEventListener.bind(displayMode),
  }));
});

afterEach(() => vi.unstubAllGlobals());

function offerInstall(outcome: "accepted" | "dismissed" = "accepted", prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function App({ showSettings = true }: { showSettings?: boolean }) {
  return <PWAInstallProvider>{showSettings && <InstallAppSection />}</PWAInstallProvider>;
}

describe("PWA installation", () => {
  it("offers manual iPhone and Android instructions when the browser has no install event", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "pwa.install" })).not.toBeInTheDocument();
    expect(screen.getByText("pwa.ios-share")).toBeInTheDocument();
    expect(screen.getByText("pwa.android-menu")).toBeInTheDocument();
    expect(screen.getByText("pwa.draft-warning")).toBeInTheDocument();
  });

  it("retains an early offer across navigation and prompts only after a user click", async () => {
    const view = render(<App showSettings={false} />);
    const event = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    view.rerender(<App />);
    fireEvent.click(screen.getByRole("button", { name: "pwa.install" }));
    expect(event.prompt).toHaveBeenCalledOnce();
    await screen.findByText("pwa.accepted");
    expect(screen.queryByText("pwa.installed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pwa.install" })).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.getByText("pwa.installed")).toBeInTheDocument();
    expect(screen.queryByText("pwa.manual-title")).not.toBeInTheDocument();
  });

  it("consumes a dismissed prompt and allows a later browser offer", async () => {
    render(<App />);
    const first = offerInstall("dismissed");
    fireEvent.click(screen.getByRole("button", { name: "pwa.install" }));
    await screen.findByText("pwa.dismissed");
    expect(screen.queryByRole("button", { name: "pwa.install" })).not.toBeInTheDocument();
    const second = offerInstall();
    fireEvent.click(screen.getByRole("button", { name: "pwa.install" }));
    await screen.findByText("pwa.accepted");
    expect(first.prompt).toHaveBeenCalledOnce();
    expect(second.prompt).toHaveBeenCalledOnce();
  });

  it("prevents repeated prompts while waiting for the browser", async () => {
    let resolvePrompt!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => (resolvePrompt = resolve)));
    render(<App />);
    offerInstall("accepted", prompt);
    fireEvent.click(screen.getByRole("button", { name: "pwa.install" }));
    const waiting = screen.getByRole("button", { name: "pwa.installing" });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    expect(prompt).toHaveBeenCalledOnce();
    await act(async () => resolvePrompt());
    await screen.findByText("pwa.accepted");
  });

  it("shows a prompt failure and keeps the manual path available", async () => {
    render(<App />);
    offerInstall("accepted", vi.fn().mockRejectedValue(new Error("Unavailable")));
    fireEvent.click(screen.getByRole("button", { name: "pwa.install" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pwa.failed");
    expect(screen.getByText("pwa.ios-share")).toBeInTheDocument();
  });

  it.each(["standalone", "ios"])("recognizes an installed %s launch", (mode) => {
    if (mode === "standalone") standalone = true;
    else vi.stubGlobal("navigator", { standalone: true });
    render(<App />);
    expect(screen.getByText("pwa.installed")).toBeInTheDocument();
    expect(screen.queryByText("pwa.manual-title")).not.toBeInTheDocument();
  });

  it("updates when the window enters standalone mode", () => {
    render(<App />);
    offerInstall();
    act(() => {
      standalone = true;
      displayMode.dispatchEvent(new Event("change"));
    });
    expect(screen.getByText("pwa.installed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pwa.install" })).not.toBeInTheDocument();
  });

  it("explains the HTTPS requirement without offering a broken install action", () => {
    vi.stubGlobal("isSecureContext", false);
    render(<App />);
    offerInstall();
    expect(screen.getByText("pwa.https-required")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "pwa.install" })).not.toBeInTheDocument();
  });

  it("removes event listeners on unmount", () => {
    const view = render(<App />);
    view.unmount();
    const event = offerInstall();
    expect(event.defaultPrevented).toBe(false);
  });
});
