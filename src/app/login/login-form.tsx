"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Loader2, LockKeyhole } from "lucide-react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction] = useFormState(login, initialState);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={nextPath} />
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">Email</span>
        <input
          autoComplete="email"
          autoFocus
          className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          name="email"
          type="email"
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">Password</span>
        <input
          autoComplete="current-password"
          className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          name="password"
          type="password"
          required
        />
      </label>
      {state.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {state.error}
        </div>
      ) : null}
      <LoginButton />
    </form>
  );
}

function LoginButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ocean px-4 text-sm font-semibold text-white transition hover:bg-[#066a74] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
      ) : (
        <LockKeyhole aria-hidden className="h-4 w-4" />
      )}
      Sign in
    </button>
  );
}
