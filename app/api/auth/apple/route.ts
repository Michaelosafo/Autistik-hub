import { idTokenSignIn } from "@/lib/idtoken-signin";

export const runtime = "nodejs";

/** "Continue with Apple" on autistik.io (components/AppleSignIn.tsx). See lib/idtoken-signin.ts. */
export async function POST(req: Request) {
  return idTokenSignIn(req, "apple");
}
