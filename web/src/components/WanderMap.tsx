import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "@/components/ui/focus";
import type { WanderOriginal } from "@/hooks/useWanderQueries";
import { cn } from "@/lib/utils";

export interface WanderMapNode {
  original: WanderOriginal;
  source: string;
  label: string;
}
export interface WanderMapEdge {
  source: string;
  target: string;
  inPath: boolean;
}

/** A bounded map of actual originals. Choosing a landmark returns to the full reading trail. */
export default function WanderMap({
  current,
  nodes,
  edges,
  disabled,
  onChoose,
}: {
  current: string;
  nodes: WanderMapNode[];
  edges: WanderMapEdge[];
  disabled?: boolean;
  onChoose: (source: string, target: string) => void;
}) {
  const ordered = [...nodes.filter((node) => node.original.name === current), ...nodes.filter((node) => node.original.name !== current)];
  const height = 156 + Math.ceil((ordered.length - 1) / 2) * 184;
  const positions = new Map(
    ordered.map((node, i) => [node.original.name, { x: i === 0 ? 50 : i % 2 ? 23 : 77, y: i === 0 ? 72 : 72 + Math.ceil(i / 2) * 184 }]),
  );
  return (
    <div aria-label="附近原文关系地图" className="relative w-full" style={{ height }}>
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full text-primary/40"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
      >
        {edges.map((edge) => {
          const from = positions.get(edge.source),
            to = positions.get(edge.target);
          return (
            from &&
            to && (
              <path
                key={`${edge.source}:${edge.target}`}
                d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={edge.inPath ? undefined : "4 5"}
              />
            )
          );
        })}
      </svg>
      {ordered.map((node) => {
        const position = positions.get(node.original.name)!;
        const selected = node.original.name === current;
        return (
          <button
            key={node.original.name}
            type="button"
            disabled={disabled}
            data-map-node={node.original.name}
            aria-current={selected ? "location" : undefined}
            aria-label={`${selected ? "正在读" : node.label}：${new Date(node.original.createdTs * 1000).toLocaleDateString("zh-CN")}，${node.original.content.replace(/\s+/g, " ").slice(0, 80)}`}
            className={cn(
              "absolute flex h-36 w-[46%] -translate-x-1/2 flex-col gap-2 rounded-lg border bg-card p-3 text-left hover:border-primary disabled:opacity-50",
              selected && "border-primary bg-accent",
              FOCUS_VISIBLE_OUTLINE_CLASSES,
            )}
            style={{ left: `${position.x}%`, top: position.y - 72 }}
            onClick={() => onChoose(node.source, node.original.name)}
          >
            <time className="text-xs text-muted-foreground">
              {new Date(node.original.createdTs * 1000).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" })}
            </time>
            <span className="line-clamp-2 font-content text-base leading-7">{node.original.content}</span>
            <span className="mt-auto text-xs text-muted-foreground">
              {selected ? "正在读" : node.label}
              {!selected && (
                <span aria-hidden="true" className="float-right">
                  ↗
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
