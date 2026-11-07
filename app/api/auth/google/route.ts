import { idTokenSignIn } from "@/lib/idtoken-signin";

export const runtime = "nodejs";

/** "Continue with Google" on autistik.io (components/GoogleSignIn.tsx). See lib/idtoken-signin.ts. */
export async function POST(req: Request) {
  return idTokenSignIn(req, "google");
}
