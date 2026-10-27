/**
 * Digital Asset Links for the Google Play app (served at /.well-known/assetlinks.json). It proves autistik.io and the
 * Play Store app belong together, so the app opens the site full screen with no browser bar.
 * Set in Vercel: ANDROID_PACKAGE (e.g. io.autistik.app) and ANDROID_SHA256 (the app signing key's SHA-256
 * fingerprint from Play Console → Setup → App signing; several can be comma separated).
 */
export const dynamic = "force-dynamic";

export function GET() {
  const pkg = (process.env.ANDROID_PACKAGE || "io.autistik.app").trim();
  const prints = (process.env.ANDROID_SHA256 || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  const body = prints.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }] : [];
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
}
