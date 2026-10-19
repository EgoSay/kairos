import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { useUserTheme } from "@/hooks/useUserTheme";
import { loadTheme } from "@/utils/theme";

const auth = vi.hoisted(() => ({ userGeneralSetting: undefined as { theme: string } | undefined }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

describe("guest theme preferences", () => {
  afterEach(() => {
    auth.userGeneralSetting = undefined;
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([false, true])("preserves paper while following OS changes (signed in: %s)", (signedIn) => {
    let dark = false;
    const changes = new EventTarget();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    }));
    if (signedIn) auth.userGeneralSetting = { theme: "system:paper" };
    loadTheme("system:paper");
    const { result } = renderHook(() => {
      useUserTheme();
      return useResolvedTheme();
    });
    expect(result.current).toBe("paper");
    for (const isDark of [true, false]) {
      act(() => {
        dark = isDark;
        changes.dispatchEvent(new Event("change"));
      });
      expect(result.current).toBe(isDark ? "paper-dark" : "paper");
      expect(document.documentElement.dataset.theme).toBe(result.current);
      expect(localStorage.getItem("memos-theme")).toBe("system:paper");
    }
  });

  it("uses the latest OS mode when returning from a fixed paper mode", () => {
    let dark = false;
    const changes = new EventTarget();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    }));
    auth.userGeneralSetting = { theme: "light:paper" };
    const { result, rerender } = renderHook(() => useResolvedTheme());
    act(() => {
      dark = true;
      changes.dispatchEvent(new Event("change"));
    });
    expect(result.current).toBe("paper");
    auth.userGeneralSetting = { theme: "system:paper" };
    rerender();
    expect(result.current).toBe("paper-dark");
  });

  it.each(["system", "default-dark"])("respects local changes after starting with %s", (initialTheme) => {
    let dark = false;
    const changes = new EventTarget();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    }));
    loadTheme(initialTheme);
    renderHook(() => useUserTheme());

    loadTheme("paper");
    dark = true;
    changes.dispatchEvent(new Event("change"));
    expect(document.documentElement).toHaveAttribute("data-theme", "paper");
    expect(localStorage.getItem("memos-theme")).toBe("light:paper");

    loadTheme("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "default-dark");
    dark = false;
    changes.dispatchEvent(new Event("change"));
    expect(document.documentElement).toHaveAttribute("data-theme", "default");
    expect(localStorage.getItem("memos-theme")).toBe("system");
  });
});
