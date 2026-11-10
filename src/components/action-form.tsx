"use client";
import { useActionState } from "react";

type State = { error?: string; ok?: string } | null;

/** Form kecil satu tombol yang memanggil server action dan menampilkan hasilnya. */
export function ActionForm({
  action,
  hidden,
  label,
  pendingLabel,
  variant = "ghost",
  confirm,
  children,
}: {
  action: (s: State, f: FormData) => Promise<State>;
  hidden?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "ghost" | "danger";
  confirm?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button type="submit" disabled={pending} className={`btn btn-sm btn-${variant}`}>
        {pending ? (pendingLabel ?? "Memproses…") : label}
      </button>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}
