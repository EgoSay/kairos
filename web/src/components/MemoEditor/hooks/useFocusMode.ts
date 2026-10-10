import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Manages the DOM-only parts of focus mode: body scroll locking and a measured
 * placeholder height that keeps masonry/grid layouts stable while the editor
 * itself is fixed above the page.
 */
export function useFocusMode(isFocusMode: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const normalModeHeightRef = useRef(0);
  const scrollPositions = useRef<{ normal?: number; focus?: number }>({});
  const captureScroll = useCallback(() => {
    const scroller = containerRef.current?.querySelector(".cm-scroller");
    if (scroller) scrollPositions.current[isFocusMode ? "focus" : "normal"] = scroller.scrollTop;
  }, [isFocusMode]);

  useLayoutEffect(() => {
    const scroller = containerRef.current?.querySelector(".cm-scroller");
    const position = scrollPositions.current[isFocusMode ? "focus" : "normal"] ?? scrollPositions.current[isFocusMode ? "normal" : "focus"];
    if (!scroller || position === undefined) return;
    scroller.scrollTop = position;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = position;
    });
    return () => cancelAnimationFrame(frame);
  }, [isFocusMode]);

  useEffect(() => {
    if (!isFocusMode) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFocusMode]);

  useLayoutEffect(() => {
    if (!isFocusMode) return;
    const container = containerRef.current;
    const viewport = window.visualViewport;
    if (!container || !viewport) return;
    const update = () => {
      const margin = viewport.width >= 768 ? 32 : viewport.width >= 640 ? 16 : 8;
      container.style.top = `${viewport.offsetTop + margin}px`;
      container.style.height = `${Math.max(120, viewport.height - margin * 2)}px`;
      container.style.bottom = "auto";
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      container.style.removeProperty("top");
      container.style.removeProperty("height");
      container.style.removeProperty("bottom");
    };
  }, [isFocusMode]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || isFocusMode) return;

    const updateHeight = () => {
      normalModeHeightRef.current = container.getBoundingClientRect().height;
    };
    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isFocusMode]);

  return {
    containerRef,
    captureScroll,
    placeholderHeight: normalModeHeightRef.current,
  };
}
