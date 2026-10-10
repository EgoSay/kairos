import { describe, expect, it } from "vitest";
import { getReleaseTag } from "@/lib/release-version";

describe("release version links", () => {
  it.each([
    "1.0.0",
    "1.0.1",
    "1.0.10",
    "1.10.0",
    "2.0.0",
    "1.0.0-rc.1",
    "1.1.0-rc.2",
    "26.10.1",
    "26.10.2",
  ])("links release %s", (version) => expect(getReleaseTag(version)).toBe(version));

  it.each([
    "dev",
    "manual-abcdef0",
    "v1.0.0",
    "1.0",
    "26.10",
    "01.0.0",
    "1.00.0",
    "1.0.01",
    "1.0.0-rc.0",
    "1.0.0-rc.01",
    "1.0.0-dev.abcdef123456",
    "1.0.0+build",
    "1.0.0oops",
  ])("does not link non-release %s", (version) => expect(getReleaseTag(version)).toBeUndefined());
});
