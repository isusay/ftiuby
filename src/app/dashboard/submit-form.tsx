"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { checkRepo, checkUpload, loadBranches, loadRepos, submitProject, type RepoOption } from "./actions";
import type { PreflightResult } from "@/lib/preflight";
import type { GitProvider } from "@/lib/schema";

type Source = GitProvider | "drop";
export type SourceOption = { id: Source; label: string; linked: boolean };

function toSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}
function toTitle(s: string) {
  return s.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}

export function SubmitForm({
  categories,
  sitesDomain,
  sources,
}: {
  categories: readonly string[];
  sitesDomain: string;
  sources: SourceOption[];
}) {
  const [source, setSource] = useState<Source>(sources.find((s) => s.linked)?.id ?? "drop");
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pf, setPf] = useState<PreflightResult | null>(null);
  const [pfError, setPfError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [checking, startCheck] = useTransition();
  const [state, formAction, submitting] = useActionState(submitProject, null);
  const current = sources.find((s) => s.id === source);

  useEffect(() => {
    setRepos(null);
    setRepo("");
    setBranch("");
    setBranches([]);
    setPf(null);
    setPfError(null);
    setRepoError(null);
    if (source === "drop" || !current?.linked) return;
    loadRepos(source).then((r) => {
      if (r.error) setRepoError(r.error);
      setRepos(r.repos ?? []);
    });
  }, [source, current?.linked]);

  function pickRepo(path: string) {
    setRepo(path);
    setPf(null);
    setPfError(null);
    setBranches([]);
    const r = repos?.find((x) => x.path === path);
    if (!r || source === "drop") return;
    setBranch(r.branch);
    fillDetails(r.name, r.description);
    loadBranches(source, path).then((b) => setBranches(b.branches ?? [r.branch]));
  }

  function fillDetails(name: string, desc?: string | null) {
    setSlug((s) => s || toSlug(name));
    setTitle((t) => t || toTitle(name));
    setDescription((d) => d || (desc ?? ""));
  }

  function runCheck() {
    startCheck(async () => {
      setPfError(null);
      let res: PreflightResult | { error: string };
      if (source === "drop") {
        if (!file) return;
        const fd = new FormData();
        fd.set("zip", file);
        res = await checkUpload(fd);
      } else {
        res = await checkRepo(source, repo, branch);
      }
      if ("error" in res) {
        setPf(null);
        setPfError(res.error);
      } else setPf(res);
    });
  }

  if (state?.ok) {
    return (
      <div className="panel p-6" role="status">
        <p className="text-lg font-semibold">{state.ok}</p>
      </div>
    );
  }

  const canCheck = source === "drop" ? !!file : !!repo && !!branch;

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="source" value={source} />
      <fieldset className="space-y-4">
        <legend className="text-xl font-bold mb-2">Sumber kode</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sumber kode">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={source === s.id}
              onClick={() => setSource(s.id)}
              className={`btn btn-sm ${source === s.id ? "btn-primary" : "btn-ghost"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {source === "drop" ? (
          <div>
            <label htmlFor="zip" className="lbl">File ZIP (maks. 25 MB)</label>
            <input
              id="zip"
              name="zip"
              type="file"
              accept=".zip,application/zip"
              required
              className="field"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPf(null);
                setPfError(null);
                if (f) fillDetails(f.name.replace(/\.zip$/i, ""));
              }}
            />
            <p className="text-sm text-muted mt-1">
              Isi ZIP: website statis (ada <span className="font-mono">index.html</span>) atau source Vite/Astro/Next export/Nuxt/SvelteKit
              lengkap dengan <span className="font-mono">package.json</span> dan lockfile. Jangan sertakan <span className="font-mono">node_modules</span>.
            </p>
          </div>
        ) : !current?.linked ? (
          <p className="text-muted">
            Akun {current?.label} belum terhubung.{" "}
            <a href={`/api/auth/${source}?link=1`} className="underline underline-offset-2 font-semibold">Hubungkan sekarang</a>
          </p>
        ) : repos === null ? (
          <p className="text-muted">Mengambil repository public dari {current.label}…</p>
        ) : repos.length === 0 ? (
          <p className="text-muted">
            {repoError ?? `Belum ada repository public milikmu di ${current.label}. Buat atau jadikan public dulu, lalu muat ulang halaman ini.`}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="repo" className="lbl">Repository</label>
              <select id="repo" name="repo" value={repo} onChange={(e) => pickRepo(e.target.value)} className="field" required>
                <option value="">Pilih…</option>
                {repos.map((r) => (
                  <option key={r.path} value={r.path}>{r.path}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="branch" className="lbl">Branch produksi</label>
              <select
                id="branch"
                name="branch"
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setPf(null);
                }}
                className="field"
                disabled={!repo}
                required
              >
                {(branches.length ? branches : branch ? [branch] : []).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button type="button" onClick={runCheck} disabled={!canCheck || checking} className="btn btn-ghost">
          {checking ? "Memeriksa…" : source === "drop" ? "Periksa ZIP" : "Periksa repository"}
        </button>
        {pfError && <p role="alert" className="text-danger">{pfError}</p>}
        {pf && (
          <div className={`panel p-4 border-l-4 ${pf.ok ? "border-l-ok" : "border-l-danger"}`} aria-live="polite">
            <p className="font-semibold mb-2">
              {pf.ok ? "Lolos pemeriksaan" : "Belum lolos pemeriksaan"}
              {pf.frameworkLabel && <span className="font-normal text-muted"> — terdeteksi {pf.frameworkLabel}</span>}
            </p>
            {pf.outputDir && (
              <p className="text-sm text-muted">
                Folder hasil: <span className="font-mono">{pf.outputDir === "." ? "folder utama" : pf.outputDir}</span>
                {pf.buildCommand && <> · Perintah build: <span className="font-mono">{pf.buildCommand}</span></>}
              </p>
            )}
            {pf.errors.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-danger text-[0.95rem] space-y-1">
                {pf.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
            {pf.warnings.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-muted text-[0.95rem] space-y-1">
                {pf.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-4" disabled={!pf?.ok}>
        <legend className="text-xl font-bold mb-2">Detail karya</legend>
        <div>
          <label htmlFor="slug" className="lbl">Alamat situs</label>
          <div className="flex items-center gap-2">
            <input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => setSlug(toSlug(e.target.value))}
              className="field font-mono max-w-xs"
              required
              minLength={3}
              maxLength={32}
            />
            <span className="font-mono text-muted">.{sitesDomain}</span>
          </div>
          <p className="text-sm text-muted mt-1">Huruf kecil, angka, dan strip. Tidak bisa diganti setelah live.</p>
        </div>
        <div>
          <label htmlFor="title" className="lbl">Judul</label>
          <input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="field" maxLength={60} required />
        </div>
        <div>
          <label htmlFor="description" className="lbl">Deskripsi singkat</label>
          <textarea
            id="description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field min-h-24"
            maxLength={240}
            required
          />
          <p className="text-sm text-muted mt-1">{description.length}/240 — ceritakan apa isi situsmu.</p>
        </div>
        <div>
          <label htmlFor="category" className="lbl">Kategori</label>
          <select id="category" name="category" className="field max-w-xs" defaultValue="Portfolio">
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </fieldset>

      {state?.error && <p role="alert" className="text-danger font-semibold">{state.error}</p>}
      <button type="submit" disabled={!pf?.ok || submitting} className="btn btn-primary">
        {submitting ? "Mengirim…" : "Kirim untuk direview"}
      </button>
    </form>
  );
}
