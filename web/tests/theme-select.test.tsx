import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ThemeSelect from "@/components/ThemeSelect";
import i18n from "@/i18n";

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

it.each([false, true])("localizes the current mode and responds to language changes (compact: %s)", async (compact) => {
  await i18n.changeLanguage("zh-Hans");
  render(<ThemeSelect value="light:paper" compact={compact} />);
  expect(screen.getByRole("combobox")).toHaveTextContent("明亮");
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("combobox")).toHaveTextContent("Light");
});

it("preserves the paper surface when changing brightness", async () => {
  await i18n.changeLanguage("en");
  const onValueChange = vi.fn();
  render(<ThemeSelect value="light:paper" onValueChange={onValueChange} />);
  fireEvent.click(screen.getByRole("combobox"));
  const dark = await screen.findByRole("option", { name: "Dark" });
  fireEvent.pointerDown(dark, { pointerType: "mouse" });
  fireEvent.click(dark, { pointerType: "mouse" });
  expect(onValueChange).toHaveBeenCalledWith("dark:paper");
  expect(document.documentElement.dataset.theme).toBe("paper-dark");
});
