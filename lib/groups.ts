export type Channel = { id: string; name: string; title: string; prompt: string };
export type Group = { id: "lounge" | "calm" | "spark" | "learn"; name: string; tag: string; desc: string; channels: Channel[] };

export const GROUPS: Group[] = [
  {
    id: "lounge", name: "Spectrum Lounge", tag: "Connect & hang out",
    desc: "Say hello, share your joys and chat about anything. The front room of the Hub.",
    channels: [
      { id: "lounge.intros", name: "introductions", title: "Introductions", prompt: "Tell us about you: your interests, and how you like to communicate." },
      { id: "lounge.wins", name: "wins-and-joys", title: "Wins & joys", prompt: "Share a win, big or small. Every one counts." },
      { id: "lounge.chat", name: "open-chat", title: "Open chat", prompt: "Anything on your mind." },
    ],
  },
  {
    id: "calm", name: "Calm Corner", tag: "Support & wellbeing",
    desc: "A gentle space for hard days. Listening comes first; advice only if someone asks.",
    channels: [
      { id: "calm.hard", name: "hard-days", title: "Hard days", prompt: "What's been hard? You don't have to fix it here." },
      { id: "calm.burnout", name: "burnout-recovery", title: "Burnout & recovery", prompt: "Share what burnout feels like for you, or what helps you recover." },
      { id: "calm.sensory", name: "sensory-routines", title: "Sensory & routines", prompt: "Sensory tips, struggles, and routines that help." },
    ],
  },
  {
    id: "spark", name: "Spark Studio", tag: "Interests & creativity",
    desc: "Info-dumps are welcome here. Special interests, art, music, games and code.",
    channels: [
      { id: "spark.interests", name: "special-interests", title: "Special interests", prompt: "Tell us everything about your special interest. We want the details." },
      { id: "spark.art", name: "art-and-music", title: "Art & music", prompt: "Share what you're making, drawing, writing or listening to." },
      { id: "spark.tech", name: "games-and-tech", title: "Games & tech", prompt: "Games, code, gadgets, Web3: what are you into?" },
    ],
  },
  {
    id: "learn", name: "Ask & Learn", tag: "Questions & life skills",
    desc: "Ask anything. Verified practitioners drop in to answer and share what they know.",
    channels: [
      { id: "learn.ask", name: "ask-the-community", title: "Ask the community", prompt: "Ask a question. Someone here has probably been there." },
      { id: "learn.pro", name: "ask-a-practitioner", title: "Ask a practitioner", prompt: "Ask a general question for verified practitioners. Don't share private medical details." },
      { id: "learn.life", name: "work-school-life", title: "Work, school & life skills", prompt: "Jobs, studies, money, housing, daily life: share tips or ask for help." },
    ],
  },
];

export const CHANNELS: Record<string, Channel & { group: Group }> = Object.fromEntries(
  GROUPS.flatMap((g) => g.channels.map((c) => [c.id, { ...c, group: g }]))
);

export const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9";
