export default function SkuPnlLoading() {
  return (
    <>
      <div className="mb-6 border-b border-slate-200 pb-5">
        <div className="h-3 w-20 rounded bg-slate-200" />
        <div className="mt-3 h-8 w-44 rounded bg-slate-200" />
        <div className="mt-3 h-4 w-full max-w-2xl rounded bg-slate-100" />
      </div>
      <div className="mb-6 grid gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-panel md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="grid gap-2">
            <div className="h-3 w-20 rounded bg-slate-100" />
            <div className="h-10 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-3 h-7 w-32 rounded bg-slate-200" />
          </div>
        ))}
      </section>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-200 bg-slate-50 p-4">
          <div className="h-4 w-48 rounded bg-slate-200" />
        </div>
        <div className="grid gap-3 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-9 rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </>
  );
}
