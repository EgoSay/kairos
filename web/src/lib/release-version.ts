// Kairos release tags use semantic versions without a v prefix.
const isReleaseVersion = (version: string): boolean => /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/.test(version);

export const getReleaseTag = (version: string): string | undefined => {
  if (!isReleaseVersion(version)) return undefined;
  return version;
};
