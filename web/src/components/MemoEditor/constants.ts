export const FOCUS_MODE_STYLES = {
  backdrop: "fixed inset-0 bg-overlay/20 backdrop-blur-sm z-overlay",
  container: {
    base: "fixed z-50 w-auto max-w-5xl mx-auto shadow-2xl border-border h-auto min-h-0 overflow-y-auto",
    spacing: "top-2 left-2 right-2 bottom-2 sm:top-4 sm:left-4 sm:right-4 sm:bottom-4 md:top-8 md:left-8 md:right-8 md:bottom-8",
  },
  // Animating height/width changes the scroll range after restoring the view.
  transition: "transition-[border-color,box-shadow] duration-300 ease-in-out motion-reduce:transition-none",
  exitButton: "absolute top-2 right-2 z-10 opacity-60 hover:opacity-100",
} as const;

// The visual editor starts quiet. Its optional full toolbar uses a new key so
// the previous default-on setting does not perpetuate a crowded first view.
export const FORMATTING_TOOLBAR_STORAGE_KEY = "kairos-editor-formatting-toolbar-v2";
