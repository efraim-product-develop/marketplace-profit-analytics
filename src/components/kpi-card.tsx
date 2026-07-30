import { cn } from "@/lib/cn";

export function KpiCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tracking-normal",
          tone === "good" && "text-ocean",
          tone === "warn" && "text-mango",
          tone === "bad" && "text-brick"
        )}
      >
        {value}
      </div>
      {detail ? <div className="mt-2 text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}
