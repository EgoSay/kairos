import { MapPinIcon } from "lucide-react";
import type { FC } from "react";
import {
  METADATA_ROW_BOX_CLASSES,
  METADATA_ROW_TEXT_CLASSES,
  MetadataRowDetail,
  MetadataRowIconSlot,
  MetadataRowRemoveControl,
} from "@/components/MemoMetadata/MetadataSection";
import type { Location } from "@/types/proto/api/v1/memo_service_pb";
import { getLocationCoordinatesText, getLocationDisplayText } from "./locationHelpers";

interface LocationDisplayEditorProps {
  location: Location;
  onRemove?: () => void;
  onEdit?: () => void;
}

/** The draft's location as one metadata row; the remove control shows once the row is engaged. */
const LocationDisplayEditor: FC<LocationDisplayEditorProps> = ({ location, onRemove, onEdit }) => {
  const displayText = getLocationDisplayText(location);

  return (
    <div className={METADATA_ROW_BOX_CLASSES}>
      <MetadataRowIconSlot icon={MapPinIcon} />
      {onEdit ? (
        <button
          type="button"
          className={`${METADATA_ROW_TEXT_CLASSES} min-h-11 text-start`}
          aria-label={`修改位置：${displayText}`}
          onClick={onEdit}
        >
          {displayText}
        </button>
      ) : (
        <span className={METADATA_ROW_TEXT_CLASSES} title={displayText}>
          {displayText}
        </span>
      )}
      {!location.nameOnly && <MetadataRowDetail parts={[getLocationCoordinatesText(location)]} />}
      {onRemove && <MetadataRowRemoveControl label="Remove location" onClick={onRemove} />}
    </div>
  );
};

export default LocationDisplayEditor;
