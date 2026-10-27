import type { FC } from "react";
import { useMemo, useState } from "react";
import MetadataSection, { METADATA_ROW_BOX_CLASSES, MetadataRowRemoveControl } from "@/components/MemoMetadata/MetadataSection";
import { useRecordReading } from "@/components/RecordReference/RecordReadingContext";
import type { MemoRelation } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import RelatedRecordPreview from "./RelatedRecordPreview";
import { getEditorReferenceRelations } from "./relationHelpers";
import { useResolvedRelationMemos } from "./useResolvedRelationMemos";

interface RelationListEditorProps {
  relations: MemoRelation[];
  onRelationsChange?: (relations: MemoRelation[]) => void;
  parentPage?: string;
  memoName?: string;
}

const RelationListEditor: FC<RelationListEditorProps> = ({ relations, onRelationsChange, memoName }) => {
  const [previewName, setPreviewName] = useState<string>();
  const reader = useRecordReading();
  const t = useTranslate();
  const referenceRelations = useMemo(() => getEditorReferenceRelations(relations, memoName), [relations, memoName]);
  const relatedMemoNames = useMemo(
    () => referenceRelations.flatMap((relation) => (relation.relatedMemo?.name ? [relation.relatedMemo.name] : [])),
    [referenceRelations],
  );
  const resolvedMemos = useResolvedRelationMemos(relatedMemoNames);

  const handleDeleteRelation = (memoName: string) => {
    if (onRelationsChange) {
      onRelationsChange(relations.filter((relation) => relation.relatedMemo?.name !== memoName));
    }
  };

  if (referenceRelations.length === 0) {
    return null;
  }

  return (
    <MetadataSection title={t("common.relations")}>
      {referenceRelations.map((relation) => {
        const relatedMemo = relation.relatedMemo!;
        const unavailable = resolvedMemos[relatedMemo.name] === null;
        const memo = resolvedMemos[relatedMemo.name] || {
          ...relatedMemo,
          snippet: unavailable ? "记录已删除或不可访问；保存时将忽略此关联。" : "正在读取关联记录…",
        };
        // A split row: the link is the focusable body, and the remove control overlays the trailing end once the row is engaged.
        return (
          <div key={memo.name} className={METADATA_ROW_BOX_CLASSES}>
            <button
              type="button"
              className="w-full min-w-0 truncate py-2 pl-3 pr-10 text-left text-sm"
              disabled={unavailable}
              onClick={(event) => (reader.enabled ? reader.open(memo.name, event.currentTarget, memoName) : setPreviewName(memo.name))}
            >
              {memo.snippet || "附件记录"}
            </button>
            <MetadataRowRemoveControl label="解除关联" onClick={() => handleDeleteRelation(memo.name)} />
          </div>
        );
      })}
      <RelatedRecordPreview name={previewName} onClose={() => setPreviewName(undefined)} />
    </MetadataSection>
  );
};

export default RelationListEditor;
