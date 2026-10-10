export const FOCUS_MODE_STYLES = {
  backdrop: "fixed inset-0 bg-overlay/20 backdrop-blur-sm z-overlay",
  container: {
    base: "fixed z-50 w-auto max-w-5xl mx-auto shadow-2xl border-border h-auto overflow-y-auto",
    spacing: "top-2 left-2 right-2 bottom-2 sm:top-4 sm:left-4 sm:right-4 sm:bottom-4 md:top-8 md:left-8 md:right-8 md:bottom-8",
  },
  transition: "transition-all duration-300 ease-in-out motion-reduce:transition-none",
  exitButton: "absolute top-2 right-2 z-10 opacity-60 hover:opacity-100",
} as const;

// localStorage key for the user's preference to show the formatting toolbar in
// normal (non-focus) mode. Defaults to on; the Kairos key intentionally starts the visible-formatting UX.
export const FORMATTING_TOOLBAR_STORAGE_KEY = "kairos-editor-formatting-toolbar";
