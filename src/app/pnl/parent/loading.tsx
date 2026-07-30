import { PageHeader } from "@/components/page-header";

export default function ParentPnlLoading() {
  return (
    <>
      <PageHeader
        eyebrow="Profit"
        title="Parent P&L"
        description="Loading parent rollups and comparison data."
      />
      <section className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-md border border-slate-200 bg-white shadow-panel"
          />
        ))}
      </section>
      <div className="mt-6 h-80 animate-pulse rounded-md border border-slate-200 bg-white shadow-panel" />
    </>
  );
}
