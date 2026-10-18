// ============================================================================
// Content Font Preference
// ============================================================================
// The content font applies to user-authored surfaces: memo bodies, page titles,
// and the composer. Interface chrome (navigation, buttons, timestamps) always
// stays on --font-sans. "kai" = LXGW WenKai (self-hosted, GB subset), "sans" =
// system sans stack. Preference is per-device via localStorage.

const VALID_CONTENT_FONTS = ["kai", "sans"] as const;

export type ContentFont = (typeof VALID_CONTENT_FONTS)[number];

const STORAGE_KEY = "memos-content-font";
const ATTRIBUTE = "data-content-font";

export const DEFAULT_CONTENT_FONT: ContentFont = "kai";

const validateContentFont = (value: string | null | undefined): ContentFont | null =>
  value && VALID_CONTENT_FONTS.includes(value as ContentFont) ? (value as ContentFont) : null;

const getStoredContentFont = (): ContentFont | null => {
  try {
    return validateContentFont(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

/**
 * Applies a content font to the document element and persists it.
 */
export const loadContentFont = (font: string): void => {
  const valid = validateContentFont(font) ?? DEFAULT_CONTENT_FONT;
  document.documentElement.setAttribute(ATTRIBUTE, valid);
  try {
    localStorage.setItem(STORAGE_KEY, valid);
  } catch {
    // localStorage might not be available (SSR, private browsing, etc.)
  }
};

export const getContentFont = (): ContentFont => getStoredContentFont() ?? DEFAULT_CONTENT_FONT;

/**
 * Applies the stored content font during initial page load to prevent flash.
 */
export const applyContentFontEarly = (): void => {
  loadContentFont(getContentFont());
};
