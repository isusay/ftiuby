"use client";
import { useState } from "react";

/** Hero: ketik nama, langsung lihat alamat situsmu. */
export function SubdomainComposer({ domain }: { domain: string }) {
  const [name, setName] = useState("");
  const clean = name.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  const shown = clean || "namamu";

  return (
    <div>
      <label htmlFor="sub" className="sr-only">Coba nama subdomain</label>
      <div className="font-display font-extrabold tracking-tight leading-[0.95] text-[clamp(2.1rem,8.5vw,6.5rem)]">
        <span className={`break-all ${clean ? "text-accent" : "text-accent/70"}`}>{shown}</span>
        <span className="caret text-accent" aria-hidden="true">|</span>
        <span className="whitespace-nowrap">.{domain}</span>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          id="sub"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ketik nama situsmu"
          autoComplete="off"
          spellCheck={false}
          className="field max-w-xs font-mono"
        />
        <a href="/dashboard" className="btn btn-primary">Klaim alamat ini</a>
      </div>
    </div>
  );
}
