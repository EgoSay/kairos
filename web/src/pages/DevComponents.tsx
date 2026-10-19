import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-2xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{title}</h2>
    {children}
  </section>
);

const Swatch = ({ name, className }: { name: string; className: string }) => (
  <div className="flex items-center gap-2">
    <span className={`size-8 rounded-sm border border-border/60 ${className}`} />
    <span className="text-2xs text-muted-foreground">{name}</span>
  </div>
);

export default function DevComponents() {
  const [checked, setChecked] = useState(true);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10">
      <header>
        <h1 className="font-content text-2xl font-medium">组件矩阵</h1>
        <p className="mt-1 text-ui text-muted-foreground">Development-only design system matrix. /dev/components</p>
      </header>

      <Section title="Type roles">
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p className="font-content text-2xl font-medium">页面标题 · font-content 2xl</p>
          <p className="text-ui">界面文字 · text-ui 13px — 控件、标签、按钮、侧栏行</p>
          <p className="text-xs text-muted-foreground">说明文字 · text-xs 12px — 时间戳、辅助说明</p>
          <p className="text-2xs text-muted-foreground">微标签 · text-2xs 11px — 计数、节标题</p>
          <p className="text-3xs text-muted-foreground">角标 · text-3xs 10px — 徽标、极小标注</p>
          <p className="font-content leading-7">正文 · font-content 16px/1.75 — 用户写下的内容走文楷层，界面信息保持黑体。</p>
          <p className="font-mono text-sm">代码 · font-mono — const answer = 42</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>默认</Button>
          <Button variant="secondary">次要</Button>
          <Button variant="outline">描边</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="quiet">安静</Button>
          <Button variant="link">链接</Button>
          <Button variant="destructive">危险</Button>
          <Button disabled>禁用</Button>
          <Button size="sm">小号</Button>
          <Button size="lg">大号</Button>
        </div>
      </Section>

      <Section title="Badges / Tags">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>默认</Badge>
          <Badge variant="secondary">次要</Badge>
          <Badge variant="outline">描边</Badge>
          <Badge variant="warning">警告</Badge>
          <Badge shape="pill">胶囊</Badge>
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-medium text-primary transition-colors hover:bg-primary/15">
            记录标签 · pill
          </span>
        </div>
      </Section>

      <Section title="Radius tiers">
        <div className="flex items-end gap-4">
          {[
            ["sm · 6px 控件", "rounded-sm", "size-16"],
            ["lg · 10px 卡片", "rounded-lg", "size-20"],
            ["xl · 12px 浮层", "rounded-xl", "size-24"],
            ["full · 胶囊", "rounded-full", "h-14 w-28"],
          ].map(([label, radius, size]) => (
            <div key={label} className="space-y-1.5 text-center">
              <div className={`${size} ${radius} border border-border bg-muted`} />
              <p className="text-3xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Surfaces / Elevation">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-ui font-medium">静止面</p>
            <p className="mt-1 text-2xs text-muted-foreground">发丝边，无阴影</p>
          </div>
          <div className="rounded-xl border border-border bg-popover p-4 shadow-float">
            <p className="text-ui font-medium">浮层</p>
            <p className="mt-1 text-2xs text-muted-foreground">12px 圆角 + shadow-float 暖影</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 ring-2 ring-ring/30 ring-offset-2 ring-offset-background">
            <p className="text-ui font-medium">聚焦态</p>
            <p className="mt-1 text-2xs text-muted-foreground">2px 主色环 — 书写卡是唯一抬起的静止面</p>
          </div>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-md gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-input">输入框</Label>
            <Input id="dev-input" placeholder="占位文字" />
          </div>
          <Textarea placeholder="多行输入" rows={3} />
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-ui">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> 复选
            </label>
            <label className="flex items-center gap-2 text-ui">
              <Switch defaultChecked /> 开关
            </label>
            <RadioGroup defaultValue="a" className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-ui">
                <RadioGroupItem value="a" /> 甲
              </label>
              <label className="flex items-center gap-1.5 text-ui">
                <RadioGroupItem value="b" /> 乙
              </label>
            </RadioGroup>
          </div>
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch name="primary 松绿" className="bg-primary" />
          <Swatch name="accent" className="bg-accent" />
          <Swatch name="muted" className="bg-muted" />
          <Swatch name="destructive" className="bg-destructive" />
          <Swatch name="moment 琥珀" className="bg-moment" />
          <Swatch name="popover" className="bg-popover" />
          <Swatch name="card" className="bg-card" />
          <Swatch name="border" className="bg-border" />
        </div>
      </Section>

      <Section title="Selection / Focus">
        <p className="max-w-md rounded-lg border border-border bg-card p-4 font-content leading-7">
          用鼠标选中这段文字——选区应是松绿淡彩而非系统蓝。Tab 键遍历本页控件应看到 2px 主色聚焦环。
        </p>
      </Section>
    </div>
  );
}
