/** Meme names and @handles. The database (supabase/members-live.sql) has the same lists and has the final say. */
const ADJ = ["Diamond-Hand", "Based", "Turbo", "Giga", "Comfy", "Smol", "Laser-Eyed", "Moon", "Wagmi", "Hodl",
  "Galaxy-Brain", "Bullish", "Sleepy", "Rug-Proof", "Wen-Lambo", "Mega", "Cosmic", "Frosty", "Lucky", "Spicy",
  "Paper-Hand", "Degen", "Zoomer", "Chad", "Sneaky", "Gm", "Rekt-Proof", "Pumped", "Chill", "Ape"];
const NOUN = ["Whale", "Shrimp", "Ape", "Degen", "Frog", "Goblin", "Wizard", "Doge", "Hodler", "Moonboy",
  "Gremlin", "Penguin", "Banana", "Rocket", "Otter", "Llama", "Crab", "Hamster", "Raccoon", "Lobster",
  "Chimp", "Bull", "Bear", "Kitten", "Dolphin", "Owl", "Fox", "Yeti", "Panda", "Gecko"];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

export const memeName = () => `${pick(ADJ)} ${pick(NOUN)} #${1000 + Math.floor(Math.random() * 9000)}`;

/** Words only team accounts can use, in names and @handles. */
export const RESERVED = /(admin|moderator|\bmod\b|official|autistik|support team|hub team|\bteam\b|\bstaff\b|\bdev\b|founder)/i;

export function nicknameProblem(n: string): string {
  const v = n.trim().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > 40) return "Your nickname needs 2 to 40 characters.";
  if (/@/.test(v)) return "Leave out the @. Your @handle is made for you.";
  if (RESERVED.test(v)) return "That nickname is kept for the Hub team. Please pick another.";
  return "";
}

/** "Diamond-Hand Whale #4821" → diamondhandwhale482 (the same rule the database uses). */
export const handleOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15) || "member";
export const HANDLE = /^[a-z0-9_]{3,20}$/;
