import type { Location } from "@/types/proto/api/v1/memo_service_pb";

export const getLocationDisplayText = (location: Location): string => {
  return location.placeholder.trim() || getLocationCoordinatesText(location);
};

export const getLocationCoordinatesText = (location: Location, digits = 4): string => {
  if (location.nameOnly) return "只记地点名";
  return `${location.latitude.toFixed(digits)}°, ${location.longitude.toFixed(digits)}°`;
};
