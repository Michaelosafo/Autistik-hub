/** AUTISTIK Pro: advanced analysis, paid in $AUTISTIK. Safe to use in the browser (settings only). */
export const PRO_USD = Number(process.env.NEXT_PUBLIC_PRO_USD || 10);
export const PRO_DAYS = Number(process.env.NEXT_PUBLIC_PRO_DAYS || 30);
export const FREE_PINS = 3;
export const PRO_PINS = 30;
export const PRO_REPORTS_PER_DAY = 10;
/** The AUTISTIK token on BNB Chain (what Pro is paid in). */
export const PRO_TOKEN = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9") as `0x${string}`;

export const PRO_FEATURES = [
  { icon: "⏱️", name: "3 timeframes", text: "Checks the 15-minute, 1-hour and 4-hour charts. When all three agree, the signal is far more reliable." },
  { icon: "🐋", name: "Whale radar", text: "See which big wallets are buying or selling right now, and how much of the supply they moved." },
  { icon: "📊", name: "Track record", text: "Every buy and sell signal is checked 24 hours later, so you see how often it was right." },
  { icon: "🤖", name: "Analyst report", text: "One tap: a plain-English report with a plan: when to enter, targets, stop-loss and risks." },
  { icon: "🚨", name: "Pro alerts", text: "Extra alerts when a whale moves 1% or more of the supply, or the pool's money drops fast (rug warning)." },
  { icon: "📌", name: `${PRO_PINS} pins`, text: `Pin up to ${PRO_PINS} tokens instead of ${FREE_PINS}.` },
];
