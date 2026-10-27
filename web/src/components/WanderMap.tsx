import type { WanderDirection } from "@/hooks/useWanderQueries";

/** Stable local layout: an original, shared reading themes, then linked originals. */
export default function WanderMap({ directions, onFollow }: { directions: WanderDirection[]; onFollow: (name: string) => void }) {
  const height = Math.max(150, directions.length * 72);
  const y = (index: number) => ((index + 0.5) / directions.length) * 100;
  const topics = [...new Set(directions.map((d) => d.topicId))].map((id) => {
    const rows = directions.map((d, i) => ({ d, i })).filter(({ d }) => d.topicId === id);
    return { id, label: rows[0].d.topic, y: rows.reduce((sum, row) => sum + y(row.i), 0) / rows.length, indices: rows.map((row) => row.i) };
  });
  return (
    <div aria-label="局部关联图" className="relative overflow-hidden rounded-xl border border-border/60 bg-muted/20" style={{ height }}>
      <svg aria-hidden="true" className="absolute inset-0 size-full text-border" viewBox="0 0 100 100" preserveAspectRatio="none">
        {topics.map((topic) => (
          <path key={topic.id} d={`M 17 50 C 30 50, 30 ${topic.y}, 45 ${topic.y}`} fill="none" stroke="currentColor" strokeWidth="0.5" />
        ))}
        {topics.flatMap((topic) =>
          topic.indices.map((index) => (
            <path
              key={index}
              d={`M 45 ${topic.y} C 63 ${topic.y}, 63 ${y(index)}, 83 ${y(index)}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
          )),
        )}
      </svg>
      <span className="absolute left-[17%] top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-card px-3 py-3 text-xs text-primary">
        这段原文
      </span>
      {topics.map((topic) => (
        <span
          key={topic.id}
          style={{ top: `${topic.y}%` }}
          className="absolute left-[45%] max-w-[27%] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card px-2 py-2 text-center text-[11px] leading-5"
        >
          {topic.label}
        </span>
      ))}
      {directions.map((d, i) => (
        <button
          key={d.original.name}
          type="button"
          style={{ top: `${y(i)}%` }}
          className="absolute left-[83%] min-h-11 w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card px-2 py-2 text-left text-xs leading-5 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => onFollow(d.original.name)}
          aria-label={`探索线索 ${i + 1}：${d.topic}`}
        >
          <span className="block text-[10px] text-muted-foreground">记录 {i + 1}</span>
          <span className="line-clamp-1">
            {new Date(d.original.createdTs * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
          </span>
        </button>
      ))}
    </div>
  );
}
