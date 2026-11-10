"use client";
import { useActionState } from "react";
import { redeemInvite } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState(redeemInvite, null);
  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <div className="flex-1 min-w-[14rem]">
        <label htmlFor="code" className="sr-only">Kode undangan</label>
        <input id="code" name="code" required placeholder="Contoh: FTI-7K2Q" className="field font-mono uppercase" autoComplete="off" />
        {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="mt-2 text-sm text-ok">{state.ok}</p>}
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Memeriksa…" : "Aktifkan akun"}</button>
    </form>
  );
}
