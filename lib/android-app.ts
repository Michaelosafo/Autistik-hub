/**
 * Is the visitor inside the Google Play app (the Trusted Web Activity)? Android opens the site with an
 * "android-app://<package>/" referrer; the middleware then sets this cookie so every later page knows.
 * Used to hide what Google Play doesn't allow in the store app (paid races); the website itself is unchanged.
 */
export const APP_COOKIE = "autistik_app";
export const fromAndroidApp = (referrer: string | null | undefined) => !!referrer && referrer.startsWith("android-app://");

/** In the browser: the cookie, or the referrer on the app's very first page. */
export function isAndroidApp(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").includes(`${APP_COOKIE}=android`) || fromAndroidApp(document.referrer);
}
