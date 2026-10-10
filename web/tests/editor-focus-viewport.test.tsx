import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFocusMode } from "@/components/MemoEditor/hooks/useFocusMode";

function Probe({ focus }: { focus: boolean }) {
  const { containerRef } = useFocusMode(focus);
  return (
    <div ref={containerRef} data-testid="frame">
      <div className="cm-scroller" />
    </div>
  );
}
afterEach(() => vi.unstubAllGlobals());
it("keeps the focus frame inside the visual viewport and removes overrides when leaving", () => {
  const viewport = new EventTarget();
  Object.assign(viewport, { width: 390, height: 700, offsetTop: 0 });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { getByTestId, rerender } = render(<Probe focus />);
  expect(getByTestId("frame")).toHaveStyle({ top: "8px", height: "684px", bottom: "auto" });
  Object.assign(viewport, { height: 350, offsetTop: 24 });
  act(() => viewport.dispatchEvent(new Event("resize")));
  expect(getByTestId("frame")).toHaveStyle({ top: "32px", height: "334px" });
  expect(document.body.style.overflow).toBe("hidden");
  rerender(<Probe focus={false} />);
  expect(getByTestId("frame").style.top).toBe("");
  expect(getByTestId("frame").style.height).toBe("");
  expect(document.body.style.overflow).not.toBe("hidden");
});
