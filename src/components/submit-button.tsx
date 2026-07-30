"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#066a74] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
