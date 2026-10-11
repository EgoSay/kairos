import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { journalRecordVersion } from "@/lib/journal-record-version";
import { State } from "@/types/proto/api/v1/common_pb";
import { LocationSchema, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const vector = () =>
  create(MemoSchema, {
    content: "今天 🌙\u2028<真实>",
    createTime: { seconds: 946684800n },
    updateTime: { seconds: 946684899n },
    visibility: Visibility.PRIVATE,
    space: "spaces/room-1",
    state: State.NORMAL,
    location: { placeholder: "家\n灯", latitude: -0, longitude: 121.4737 },
    attachments: [{ name: "attachments/z-last" }, { name: "attachments/a-first" }],
  });
describe("full record comparison version", () => {
  it("matches the Go vector including UTF-8 lengths, negative zero and sorted attachments", async () => {
    const memo = vector();
    expect(await journalRecordVersion(memo)).toBe("fe104109c1ab6e895f33b9d719aea8d9b723aa4e076edede43b539ac6f20fef1");
    memo.attachments.reverse();
    expect(await journalRecordVersion(memo)).toBe("fe104109c1ab6e895f33b9d719aea8d9b723aa4e076edede43b539ac6f20fef1");
  });
  it.each([
    "date",
    "location",
    "attachments",
    "visibility",
    "space",
  ])("detects a pure %s change without changing the body", async (field) => {
    const before = vector();
    const after = vector();
    if (field === "date") after.createTime!.seconds++;
    if (field === "location") after.location!.placeholder = "another place";
    if (field === "attachments") after.attachments.pop();
    if (field === "visibility") after.visibility = Visibility.PUBLIC;
    if (field === "space") after.space = "";
    expect(before.content).toBe(after.content);
    expect(await journalRecordVersion(after)).not.toBe(await journalRecordVersion(before));
  });
});

it("distinguishes a personal place name from a real zero-coordinate point with the shared Go vector", async () => {
  const memo = vector();
  memo.location = create(LocationSchema, { placeholder: "家\n灯", nameOnly: true });
  expect(await journalRecordVersion(memo)).toBe("e4c1ed27c53f926d6a31a0306d3c99f7be05f218fadd9c5441b32e93a825251d");
  memo.location.nameOnly = false;
  expect(await journalRecordVersion(memo)).not.toBe("e4c1ed27c53f926d6a31a0306d3c99f7be05f218fadd9c5441b32e93a825251d");
});
