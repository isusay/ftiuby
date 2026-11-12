import "server-only";
import { env } from "./env";

/** Klien minimal untuk REST API Dokploy (header x-api-key). */
export class DokployError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = new URL(`${env.dokployUrl}/api/${path}`);
  if (method === "GET" && body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: { "x-api-key": env.dokployApiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "message" in data && String((data as { message: unknown }).message)) ||
      `HTTP ${res.status}`;
    throw new DokployError(`Dokploy ${path}: ${msg}`, res.status);
  }
  return data as T;
}

export type DokployApp = {
  applicationId: string;
  appName: string;
  applicationStatus: "idle" | "running" | "done" | "error";
  refreshToken?: string | null;
};

export type BuildConfig =
  | { kind: "static" }
  | { kind: "nixpacks"; publishDirectory: string; isStaticSpa: boolean };

export const dokploy = {
  /** Daftar project + environment, untuk membantu admin menemukan environmentId. */
  projectAll: () =>
    call<
      {
        projectId: string;
        name: string;
        environments?: { environmentId: string; name: string }[];
      }[]
    >("GET", "project.all"),

  async createApplication(name: string, appName: string, description: string): Promise<DokployApp> {
    const app = await call<DokployApp | null>("POST", "application.create", {
      name,
      appName,
      description,
      environmentId: env.dokployEnvironmentId,
      ...(env.dokployServerId ? { serverId: env.dokployServerId } : {}),
    });
    if (!app || typeof app !== "object" || !("applicationId" in app)) {
      throw new DokployError("Dokploy tidak mengembalikan applicationId. Periksa versi Dokploy.", 500);
    }
    return app;
  },

  getApplication: (applicationId: string) => call<DokployApp>("GET", "application.one", { applicationId }),

  saveGitProvider: (applicationId: string, gitUrl: string, branch: string) =>
    call("POST", "application.saveGitProvider", {
      applicationId,
      customGitUrl: gitUrl,
      customGitBranch: branch,
      customGitBuildPath: "/",
      watchPaths: null,
      enableSubmodules: false,
    }),

  saveBuildType: (applicationId: string, cfg: BuildConfig) =>
    call("POST", "application.saveBuildType", {
      applicationId,
      buildType: cfg.kind,
      dockerfile: null,
      dockerContextPath: null,
      dockerBuildStage: null,
      herokuVersion: null,
      railpackVersion: null,
      publishDirectory: cfg.kind === "nixpacks" ? cfg.publishDirectory : null,
      isStaticSpa: cfg.kind === "nixpacks" ? cfg.isStaticSpa : false,
    }),

  saveEnvironment: (applicationId: string, envText: string) =>
    call("POST", "application.saveEnvironment", {
      applicationId,
      env: envText,
      buildArgs: null,
      buildSecrets: null,
      createEnvFile: false,
    }),

  /** Batas resource container situs pengguna (opsional lewat env). */
  setLimits: (applicationId: string) => {
    const memoryLimit = process.env.SITE_MEMORY_LIMIT; // contoh: 134217728 (128 MB, dalam byte)
    const cpuLimit = process.env.SITE_CPU_LIMIT; // contoh: 250000000 (0.25 CPU, dalam nano-CPU)
    if (!memoryLimit && !cpuLimit) return Promise.resolve(null);
    return call("POST", "application.update", {
      applicationId,
      ...(memoryLimit ? { memoryLimit } : {}),
      ...(cpuLimit ? { cpuLimit } : {}),
    });
  },

  createDomain: (applicationId: string, host: string) =>
    call("POST", "domain.create", {
      host,
      path: "/",
      port: 80,
      https: true,
      certificateType: "letsencrypt",
      applicationId,
      domainType: "application",
    }),

  deploy: (applicationId: string, title: string) =>
    call("POST", "application.deploy", { applicationId, title }),

  /** Deploy dari file ZIP (sumber "Drop" di Dokploy). Dokploy mengekstrak lalu build sesuai tipe build. */
  async dropDeploy(applicationId: string, zip: Uint8Array, filename: string) {
    const form = new FormData();
    form.set("applicationId", applicationId);
    form.set("zip", new Blob([new Uint8Array(zip)], { type: "application/zip" }), filename);
    const res = await fetch(`${env.dokployUrl}/api/application.dropDeployment`, {
      method: "POST",
      headers: { "x-api-key": env.dokployApiKey, Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? msg;
      } catch {}
      throw new DokployError(`Dokploy application.dropDeployment: ${msg}`, res.status);
    }
    return true;
  },

  stop: (applicationId: string) => call("POST", "application.stop", { applicationId }),

  delete: (applicationId: string) => call("POST", "application.delete", { applicationId }),
};
