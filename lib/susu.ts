import { parseAbi } from "viem";

/**
 * AUTISTIK Susu (contracts/AutistikSusu.sol) on BNB Chain: open a plan (USDT or BUSD, an amount per day, 7–365 days),
 * put in that amount each day, and take everything back in one go when the plan ends. Nobody can touch the savings
 * before then. It has no owner, so it always lives at this address once deployed (lib/susu-build.ts).
 */
export const SUSU_ADDRESS = "0xdC241A4F0d56e6a0784247398638E4e63f90EBa1" as const;
export const SUSU_TOKENS = [
  { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  { symbol: "BUSD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
] as const;
export const SUSU_MIN_DAILY = 1;
export const SUSU_MAX_DAILY = 10_000;
export const SUSU_LENGTHS = [7, 14, 30, 60, 90, 180, 365];
export const DAY_SECONDS = 86_400;

export const SUSU_ABI = parseAbi([
  "struct Plan { address owner; address token; uint128 daily; uint64 start; uint16 totalDays; uint16 paidDays; bool withdrawn; }",
  "function open(address token, uint256 daily, uint256 totalDays) returns (uint256 id)",
  "function save(uint256 id, uint256 numDays)",
  "function withdraw(uint256 id)",
  "function plan(uint256 id) view returns (Plan p, uint256 day, uint256 dueDays, uint256 saved, uint256 unlocksAt)",
  "function plansOf(address owner) view returns (uint256[])",
  "function due(uint256 id) view returns (uint256)",
  "function planCount() view returns (uint256)",
  "event PlanOpened(uint256 indexed id, address indexed owner, address token, uint256 daily, uint256 totalDays, uint256 start)",
  "error TokenNotAccepted()", "error BadAmount()", "error BadDays()", "error NotOwner()", "error TooEarly()",
  "error AlreadyWithdrawn()", "error NothingDue()", "error PlanEnded()", "error UnknownPlan()",
]);

export const ERC20_SUSU_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const susuToken = (address: string) => SUSU_TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
