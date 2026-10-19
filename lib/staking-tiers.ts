/** Lock levels in AUTISTIK Staking (same as the contract): days locked and boost, i.e. share of rewards per token. */
export const TIERS = [
  { days: 0, boost: 1, name: "Flexible" },
  { days: 30, boost: 1.25, name: "30 days" },
  { days: 90, boost: 1.5, name: "90 days" },
  { days: 180, boost: 2, name: "180 days" },
  { days: 365, boost: 3, name: "1 year" },
] as const;
export const MAX_BOOST = 3;
