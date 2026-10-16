export type Channel = { id: string; name: string; title: string; prompt: string };
export type Group = { id: "lounge" | "calm" | "spark" | "learn"; name: string; tag: string; desc: string; channels: Channel[] };

// Two groups keep the community easy to find your way around. Group ids and channel ids are stored with
// posts and memberships, so existing ones are kept ("lounge", "calm"); "spark" and "learn" are retired.
export const GROUPS: Group[] = [
  {
    id: "lounge", name: "Spectrum Lounge", tag: "Hang out & share",
    desc: "Say hello, share your wins, your launches and your special interests. The front room of AUTISTIK.",
    channels: [
      { id: "lounge.intros", name: "introductions", title: "Introductions", prompt: "Tell us about you: your interests, and how you like to communicate." },
      { id: "lounge.chat", name: "open-chat", title: "Open chat", prompt: "Anything on your mind: interests, games, art, tokens you launched." },
      { id: "lounge.wins", name: "wins-and-joys", title: "Wins & joys", prompt: "Share a win, big or small. Every one counts." },
    ],
  },
  {
    id: "calm", name: "Support & Questions", tag: "Support, wellbeing & help",
    desc: "A gentle space for hard days and honest questions. Listening comes first; verified practitioners drop in to help.",
    channels: [
      { id: "calm.hard", name: "hard-days", title: "Hard days", prompt: "What's been hard? You don't have to fix it here." },
      { id: "calm.ask", name: "ask-the-community", title: "Ask the community", prompt: "Ask anything: work, money, daily life, crypto basics. Someone here has probably been there." },
      { id: "calm.pro", name: "ask-a-practitioner", title: "Ask a practitioner", prompt: "Ask a general question for verified practitioners. Don't share private medical details." },
    ],
  },
];

export const CHANNELS: Record<string, Channel & { group: Group }> = Object.fromEntries(
  GROUPS.flatMap((g) => g.channels.map((c) => [c.id, { ...c, group: g }]))
);

export const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9";
