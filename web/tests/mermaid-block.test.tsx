import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MermaidBlock } from "@/components/MemoContent/MermaidBlock";

const auth = vi.hoisted(() => ({ userGeneralSetting: { theme: "default" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const renderMermaid = vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' }));
const initializeMermaid = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMermaid,
    render: renderMermaid,
  },
}));

const codeElement = (content: string) => <code className="language-mermaid">{content}</code>;

describe("MermaidBlock", () => {
  afterEach(() => {
    auth.userGeneralSetting.theme = "default";
    vi.unstubAllGlobals();
  });

  it("redraws diagrams when the OS brightness changes with a paper surface", async () => {
    let dark = false;
    const changes = new EventTarget();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    }));
    auth.userGeneralSetting.theme = "system:paper";
    render(<MermaidBlock>{codeElement("graph TD; A-->B")}</MermaidBlock>);
    await waitFor(() => expect(initializeMermaid).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default" })));
    act(() => {
      dark = true;
      changes.dispatchEvent(new Event("change"));
    });
    await waitFor(() => expect(initializeMermaid).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" })));
  });

  it("clears rendered output when code content becomes empty", async () => {
    const { container, rerender } = render(<MermaidBlock>{codeElement("graph TD; A-->B")}</MermaidBlock>);

    await waitFor(() => expect(container.querySelector(".mermaid-diagram")).not.toBeNull());

    rerender(<MermaidBlock>{codeElement("")}</MermaidBlock>);

    await waitFor(() => expect(container.querySelector(".mermaid-diagram")).toBeNull());
  });
});
