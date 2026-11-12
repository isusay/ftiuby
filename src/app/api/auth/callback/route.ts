import type { NextRequest } from "next/server";
import { handleOAuthCallback } from "@/lib/auth-flow";

/** Callback GitHub (path lama, sudah terdaftar di OAuth App). */
export function GET(req: NextRequest) {
  return handleOAuthCallback("github", req);
}
