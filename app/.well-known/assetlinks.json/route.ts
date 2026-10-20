/**
 * Proves to Android that the Google Play app and autistik.io belong together, so the app opens the site full screen
 * with no browser bar. Set ANDROID_PACKAGE (e.g. io.autistik.app) and ANDROID_CERT_SHA256 (from Play Console →
 * App integrity → App signing; several can be separated by commas) in Vercel.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const pkg = (process.env.ANDROID_PACKAGE || "io.autistik.app").trim();
  const prints = (process.env.ANDROID_CERT_SHA256 || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  const body = prints.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }] : [];
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
}
