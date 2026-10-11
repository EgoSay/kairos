import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createInitialState, EditorProvider } from "@/components/MemoEditor/state";
import { EditorToolbar } from "@/components/MemoEditor/Toolbar/EditorToolbar";
import InsertMenu from "@/components/MemoEditor/Toolbar/InsertMenu";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => undefined }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userGeneralSetting: undefined }) }));
vi.mock("@/hooks/useSpaceQueries", () => ({ useSpaces: () => ({ data: [] }) }));
vi.mock("@/hooks/useJournalQueries", () => ({ useJournalPreferences: () => ({ data: { timezone: "Asia/Shanghai" } }) }));
vi.mock("@/contexts/SpaceContext", () => ({ useSpaceContext: () => ({ selectedSpaceName: undefined }) }));
vi.mock("@/components/map/useReverseGeocoding", () => ({ lookupLocationName: vi.fn() }));
vi.mock("@/hooks/useJournalLocations", () => ({
  useJournalLocations: () => ({ data: undefined, save: { isPending: false } }),
  searchPublicPlaces: vi.fn(),
}));
vi.mock("@/components/map/LazyLocationPicker", () => ({ LazyLocationPicker: () => <div data-testid="location-map" /> }));
vi.mock("@/components/MemoEditor/hooks/useLinkMemo", () => ({
  useLinkMemo: () => ({
    searchText: "",
    setSearchText: vi.fn(),
    isFetching: false,
    filteredMemos: [],
    addMemoRelation: vi.fn(),
    isAlreadyLinked: () => false,
    retry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const viewToggles = {
  onToggleFocusMode: vi.fn(),
  isFormattingToolbarVisible: false,
  onToggleFormattingToolbar: vi.fn(),
};

/** `hosted` mirrors an editor whose presentation belongs to a host (the global composer). */
const renderMenu = (onInsertImages = vi.fn(), isSaving = false, hosted = false) =>
  render(
    <EditorProvider>
      <InsertMenu
        isSaving={isSaving}
        onLocationChange={vi.fn()}
        onInsertImages={onInsertImages}
        onAudioRecorderClick={vi.fn()}
        viewToggles={hosted ? undefined : viewToggles}
      />
    </EditorProvider>,
  );

describe("InsertMenu", () => {
  test("keeps photos, links and places direct while recording remains available in More", () => {
    const onRecord = vi.fn();
    const { container } = render(
      <EditorProvider>
        <InsertMenu isSaving={false} onLocationChange={vi.fn()} onAudioRecorderClick={onRecord} onInsertImages={vi.fn()} />
      </EditorProvider>,
    );
    const imageInput = container.querySelector<HTMLInputElement>('input[accept="image/*"]')!;
    const selectImage = vi.spyOn(imageInput, "click");
    fireEvent.click(screen.getByRole("button", { name: "editor.insert-menu.insert-image" }));
    expect(selectImage).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "关联记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加位置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editor.audio-recorder.trigger" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "editor.audio-recorder.trigger" }));
    expect(onRecord).toHaveBeenCalledOnce();
  });

  test("keeps less frequent attachment, recording and formatting actions in More", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "更多选项" });
    expect(trigger).toHaveAttribute("tabindex", "0");

    fireEvent.click(trigger);

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "editor.insert-menu.add-attachment",
      "editor.audio-recorder.trigger",
      "editor.formatting-toolbar",
    ]);
  });

  test("drops the view toggles when a host owns the editor's presentation", () => {
    renderMenu(vi.fn(), false, true);

    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));

    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).not.toContain("editor.focus-mode");
    expect(labels).not.toContain("editor.formatting-toolbar");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  test("uses separate unrestricted and multi-image file inputs", () => {
    const onInsertImages = vi.fn();
    const { container } = renderMenu(onInsertImages);
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const attachmentInput = inputs.find((input) => input.accept === "");
    const inlineImageInput = inputs.find((input) => input.accept === "image/*");

    expect(attachmentInput).toBeDefined();
    expect(attachmentInput).toHaveAttribute("multiple");
    expect(inlineImageInput).toBeDefined();
    expect(inlineImageInput).toHaveAttribute("multiple");

    const image = new File(["image"], "photo.png", { type: "image/png" });
    fireEvent.change(inlineImageInput!, { target: { files: [image] } });
    expect(onInsertImages).toHaveBeenCalledWith([image]);
  });

  test("disables insertion controls while saving", () => {
    const { container } = renderMenu(vi.fn(), true);

    expect(screen.getByRole("button", { name: "更多选项" })).toBeDisabled();
    for (const input of container.querySelectorAll('input[type="file"]')) {
      expect(input).toBeDisabled();
    }
  });

  test("exposes a localized save-blocking reason from a focusable wrapper", () => {
    const state = createInitialState();
    state.content = "memo";
    state.ui.pendingInlineImageInsertions = 1;

    render(
      <EditorProvider initialEditorState={state}>
        <EditorToolbar onSave={vi.fn()} onAudioRecorderClick={vi.fn()} viewToggles={viewToggles} onInsertImages={vi.fn()} />
      </EditorProvider>,
    );

    expect(screen.getByRole("button", { name: "editor.save" })).toBeDisabled();
    expect(screen.getByLabelText("editor.validation.resolve-image-uploads")).toHaveAttribute("tabindex", "0");
  });
});

vi.mock("@/components/Journal/PartitionPicker", () => ({ default: () => null }));
