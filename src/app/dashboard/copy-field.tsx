"use client";
import { useState } from "react";

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="lbl">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={shown ? value : "•".repeat(24)} className="field font-mono text-sm" aria-label={label} />
        {secret && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((s) => !s)}>
            {shown ? "Sembunyikan" : "Tampilkan"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Tersalin" : "Salin"}
        </button>
      </div>
    </div>
  );
}
