/**
 * The Google Play app ("AUTISTIK Community"): the same site, without the money features, because Google only lets
 * organization accounts publish crypto wallets and requires its own billing for in-app purchases. Android opens the
 * site with an "android-app://<package>/" referrer; the middleware then sets this cookie so every later page knows.
 * Inside the app the money pages are blocked and hidden; the website itself keeps everything.
 * When the app moves to an organization account, set APP_MONEY=1 in Vercel to switch them back on.
 */
export const APP_COOKIE = "autistik_app";
export const fromAndroidApp = (referrer: string | null | undefined) => !!referrer && referrer.startsWith("android-app://");
export const APP_MONEY = process.env.NEXT_PUBLIC_APP_MONEY === "1";

/** Pages with wallets, trading, launching, staking, crypto payments or paid games. */
export const APP_BLOCKED = ["/wallet", "/swap", "/trade", "/buy", "/perps", "/launchpad", "/liquidity", "/lockers", "/stake", "/susu", "/fund", "/rewards", "/pro", "/arena", "/board"];
export const appBlocked = (path: string) => !APP_MONEY && APP_BLOCKED.some((p) => path === p || path.startsWith(p + "/"));
/** Wallet API calls that move money (read-only lookups like a coin scan stay). */
export const APP_BLOCKED_API = /^\/api\/(wallet\/(quote|build|x-plan|x-fund|x-quote|sol-send|sol-ultra|sol-transfer|gas-send)|orders\/(?!cron)|hyperfocus\/paid\/(quote|join))/;

/** In the browser: the cookie, or the referrer on the app's very first page. */
export function isAndroidApp(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.app === "android" || document.cookie.split("; ").includes(`${APP_COOKIE}=android`) || fromAndroidApp(document.referrer);
}
/** In the browser: money features are off here (the Play app, until APP_MONEY is turned on). */
export const appNoMoney = () => !APP_MONEY && isAndroidApp();

/** CSS that hides every link to a blocked page, the wallet buttons and the in-page money features, in the app. */
export const APP_CSS = APP_BLOCKED.map((p) => `html[data-app="android"] a[href="${p}"],html[data-app="android"] a[href^="${p}/"],html[data-app="android"] a[href^="${p}?"]`).join(",")
  + `,html[data-app="android"] .ax-net,html[data-app="android"] .ax-acct,html[data-app="android"] .ax-connect,html[data-app="android"] .lw,html[data-app="android"] .ps-send`
  + `,html[data-app="android"] .hf .mcard[data-flow="paid"],html[data-app="android"] .hf .mcard[data-flow="real"],html[data-app="android"] .hf [data-step="paid"],html[data-app="android"] .hf #paidOv,html[data-app="android"] .hf #tradePads,html[data-app="android"] .hf #mReal,html[data-app="android"] .hf .buyin,html[data-app="android"] .hf #tb-wallet,html[data-app="android"] .hf #tb-swap{display:none!important}`;
