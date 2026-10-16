/**
 * Real photos (optional).
 * Put image files in /public/photos and write their paths here, e.g. hero: "/photos/hero.jpg".
 * Leave a value empty to keep the built-in illustration.
 * Only use photos you have the rights to, with consent from everyone shown.
 */
export const PHOTOS: Record<string, { src: string; alt: string }> = {
  hero: { src: "", alt: "Autistic friends together" },
  stage: { src: "", alt: "AUTISTIK live session" },
  lounge: { src: "", alt: "Spectrum Lounge" },
  calm: { src: "", alt: "Support & Questions" },
  spark: { src: "", alt: "Spark Studio" },
  learn: { src: "", alt: "Ask & Learn" },
};

export const LINKS = {
  telegram: "https://t.me/asdcommunity001",
  x: "https://x.com/Autistik_",
  youtube: "https://youtube.com/@autistik-charity",
  pancakeswap: "https://pancakeswap.finance/swap?outputCurrency=0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9",
  bscscan: "https://bscscan.com/address/0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9",
  dexscreener: "https://dexscreener.com/bsc/0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9",
  lpLock: "https://mudra.website/?certificate=yes&type=0&lp=0xeff4f155be6f23ff1f540f994bcd54e3271cb646",
  dev: "https://x.com/ifonlyyoubelif",
  coDev: "https://x.com/Rugpulloracle",
  /** Put the whitepaper PDF in /public with this name. */
  whitepaper: "/AUTISTIK-Whitepaper.pdf",
};
