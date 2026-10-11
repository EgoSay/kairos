import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFocusMode } from "@/components/MemoEditor/hooks/useFocusMode";

function Probe({ focus }: { focus: boolean }) {
  const { containerRef, captureScroll } = useFocusMode(focus);
  return (
    <div ref={containerRef} data-testid="frame" data-focused={focus || undefined}>
      <button type="button" onClick={captureScroll}>
        Capture
      </button>
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
  expect(getByTestId("frame").style.getPropertyValue("--kairos-focus-height")).toBe("684px");
  Object.assign(viewport, { height: 350, offsetTop: 24 });
  act(() => viewport.dispatchEvent(new Event("resize")));
  expect(getByTestId("frame")).toHaveStyle({ top: "32px", height: "334px" });
  expect(getByTestId("frame").style.getPropertyValue("--kairos-focus-height")).toBe("334px");
  expect(document.body.style.overflow).toBe("hidden");
  rerender(<Probe focus={false} />);
  expect(getByTestId("frame").style.top).toBe("");
  expect(getByTestId("frame").style.height).toBe("");
  expect(getByTestId("frame").style.getPropertyValue("--kairos-focus-height")).toBe("");
  expect(document.body.style.overflow).not.toBe("hidden");
});

it("sets viewport bounds before restoring a long document and cancels stale frames on repeated switches", () => {
  const viewport = new EventTarget();
  Object.assign(viewport, { width: 1500, height: 812, offsetTop: 0 });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const mounted = render(<Probe focus={false} />);
  const frame = mounted.getByTestId("frame");
  const scroller = frame.querySelector<HTMLElement>(".cm-scroller")!;
  let scrollTop = 408;
  // Model the browser's clamping when a document has no bounded viewport.
  // jsdom does not lay out flex boxes; the real CSS regression is checked in ego.
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = frame.hasAttribute("data-focused") && !frame.style.height ? 0 : value;
    },
  });
  fireEvent.click(mounted.getByRole("button", { name: "Capture" }));
  mounted.rerender(<Probe focus />);
  expect(frame.style.height).toBe("748px");
  expect(scroller.scrollTop).toBe(408);
  expect(frames.size).toBe(1);

  // Leaving before the deferred restoration must not overwrite the new mode.
  scroller.scrollTop = 812;
  frame.scrollTop = 172;
  fireEvent.click(mounted.getByRole("button", { name: "Capture" }));
  expect(frames.size).toBe(0);
  mounted.rerender(<Probe focus={false} />);
  expect(scroller.scrollTop).toBe(408);
  expect(frame.scrollTop).toBe(0);
  fireEvent.click(mounted.getByRole("button", { name: "Capture" }));
  mounted.rerender(<Probe focus />);
  expect(scroller.scrollTop).toBe(812);
  expect(frame.scrollTop).toBe(172);
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  expect(scroller.scrollTop).toBe(812);
  expect(frame.scrollTop).toBe(172);
  mounted.unmount();
  expect(frames.size).toBe(0);
});
