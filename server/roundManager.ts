/**
 * roundManager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatic round lifecycle manager.
 *
 * - Rounds start automatically and last ROUND_DURATION_MS (5 minutes).
 * - Fixed entry fee of FIXED_ENTRY_FEE QANX per round.
 * - 10% of the pot is kept as commission; the rest is split among winners.
 * - On server restart, recovers the in-flight round from its createdAt timestamp.
 * - After closing, waits POST_CLOSE_DELAY_MS, then opens the next round.
 */

import { randomBytes } from "crypto";
import { storage } from "./storage";
import { getBlockHashResult } from "./blockchain";

// ─── Constants ────────────────────────────────────────────────────────────────
export const DEFAULT_ROUND_DURATION_MS = 3 * 60 * 1000; // 3 minutes (default)
export const FIXED_ENTRY_FEE           = "1.0";           // QANX per round
export const COMMISSION_PERCENT        = 0.10;             // 10% total: 5% house + 5% jackpot fund
export const HOUSE_PERCENT             = 0.05;             // goes to game wallet
export const JACKPOT_PERCENT           = 0.05;             // accumulates, fires every N rounds
export const JACKPOT_INTERVAL          = 10;               // jackpot fires every 10 closed rounds
const POST_CLOSE_DELAY_MS              = 15_000;           // 15 s gap between rounds

/** Mutable — can be changed at runtime via the admin API. Resets to default on restart. */
let configuredRoundDurationMs = DEFAULT_ROUND_DURATION_MS;

/** Read the active round duration. */
export function getRoundDurationMs(): number {
  return configuredRoundDurationMs;
}

/** Update the round duration (min 1 min, max 60 min). Returns the accepted value. */
export function setRoundDurationMs(ms: number): number {
  const clamped = Math.max(60_000, Math.min(60 * 60_000, ms));
  configuredRoundDurationMs = clamped;
  console.log(`[roundManager] Round duration set to ${clamped / 60_000} min`);
  return clamped;
}

// Keep backward-compat alias used inside the file
function ROUND_DURATION_MS() { return configuredRoundDurationMs; }

let roundTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Core close-and-flip logic ────────────────────────────────────────────────
/**
 * Shared between the API route (emergency manual close) and the auto-manager.
 * Handles randomness, commission, winner calculation, DB updates, and events.
 */
export async function executeCloseRound(roundId: number): Promise<{
  result: "heads" | "tails";
  winnerCount: number;
  prizePerWinner: string;
  commission: number;
  distributedPool: number;
  totalPool: number;
  randomHex: string;
  blockHash: string | null;
  blockNumber: number | null;
  blockExplorerUrl: string | null;
}> {
  const round = storage.getRound(roundId);
  if (!round)                    throw new Error(`Round ${roundId} not found`);
  if (round.status !== "open")   throw new Error(`Round ${roundId} is not open`);

  // ── Randomness: QAN block hash, fallback to crypto.randomBytes ─────────────
  let result: "heads" | "tails";
  let randomHex: string;
  let blockHash: string | null        = null;
  let blockNumber: number | null      = null;
  let blockExplorerUrl: string | null = null;

  try {
    const blockData  = await getBlockHashResult();
    result           = blockData.result;
    randomHex        = blockData.randomHex;
    blockHash        = blockData.blockHash;
    blockNumber      = blockData.blockNumber;
    blockExplorerUrl = blockData.explorerUrl;
    console.log(`[roundManager] Round #${roundId} → QAN block #${blockNumber} → ${result}`);
  } catch (err: any) {
    console.warn(`[roundManager] QAN RPC unavailable, fallback: ${err.message}`);
    const buf    = randomBytes(32);
    randomHex    = buf.toString("hex").slice(0, 16);
    result       = parseInt(randomHex.slice(0, 8), 16) % 2 === 0 ? "heads" : "tails";
  }

  // ── Pool & commission calculation ──────────────────────────────────────────
  const allBets            = storage.getBetsByRound(roundId);
  const totalPool          = parseFloat(round.totalPool || round.pool);
  const houseCommission    = totalPool * HOUSE_PERCENT;      // 5% → game wallet
  const jackpotContrib     = totalPool * JACKPOT_PERCENT;    // 5% → jackpot fund
  const commission         = totalPool * COMMISSION_PERCENT; // 10% total (info only)
  const distributedPool    = totalPool - commission;         // 90% split among winners
  const winnerCount        = allBets.filter(b => b.guess === result).length;
  const prizePerWinner     = winnerCount > 0
    ? (distributedPool / winnerCount).toFixed(4)
    : "0";

  // ── Update round ───────────────────────────────────────────────────────────
  storage.updateRound(roundId, {
    status:         "closed",
    result,
    winnerCount,
    prizePerWinner,
    randomHex,
    unclaimedPrize: winnerCount > 0 ? distributedPool.toFixed(4) : "0",
  });

  // Mark winning bets
  storage.updateBetsWon(roundId, result);

  // Update leaderboard
  for (const bet of allBets) {
    const won = bet.guess === result;
    storage.upsertLeaderboardEntry(bet.playerAddress, won, won ? prizePerWinner : "0");
  }

  // Nobody won → roll distributed pool into next round's accumulated pool
  if (winnerCount === 0) {
    const acc = parseFloat(storage.getAccumulatedPool());
    storage.setAccumulatedPool((acc + distributedPool).toFixed(4));
  }

  // ── Jackpot fund: accumulate 5% of every round ────────────────────────────
  storage.addToJackpotPool(jackpotContrib.toFixed(4));
  console.log(`[roundManager] Jackpot +${jackpotContrib.toFixed(4)} QANX (total: ${storage.getJackpotPool()})`);

  // Every JACKPOT_INTERVAL closed rounds → flush jackpot into accumulated pool
  const closedCount = storage.getClosedRoundCount();
  let jackpotTriggered = false;
  let jackpotAmount    = "0";
  if (closedCount % JACKPOT_INTERVAL === 0) {
    jackpotAmount    = storage.flushJackpotToAccumulated();
    jackpotTriggered = parseFloat(jackpotAmount) > 0;
    if (jackpotTriggered) {
      console.log(`[roundManager] 🎰 JACKPOT triggered! ${jackpotAmount} QANX added to next round's pool.`);
      storage.createEvent({
        type:    "JackpotTriggered",
        roundId,
        data:    JSON.stringify({ amount: jackpotAmount, closedCount }),
        timestamp: Date.now(),
      });
    }
  }
  // House commission (5%) stays in the game wallet — no further accounting needed.

  // ── Event log ──────────────────────────────────────────────────────────────
  storage.createEvent({
    type:    "GameFinished",
    roundId,
    data:    JSON.stringify({
      result,
      winnerCount,
      totalPool:        totalPool.toFixed(4),
      commission:       commission.toFixed(4),
      houseCommission:  houseCommission.toFixed(4),
      jackpotContrib:   jackpotContrib.toFixed(4),
      distributedPool:  distributedPool.toFixed(4),
      prizePerWinner,
      randomHex,
      blockHash,
      blockNumber,
      blockExplorerUrl,
      nobodyWon:        winnerCount === 0,
      randomSource:     blockHash ? "QAN TestNet block hash" : "server fallback",
      jackpotTriggered,
      jackpotAmount,
    }),
    timestamp: Date.now(),
  });

  return {
    result, winnerCount, prizePerWinner,
    commission, distributedPool, totalPool,
    randomHex, blockHash, blockNumber, blockExplorerUrl,
  };
}

// ─── Start new round ──────────────────────────────────────────────────────────
export function startNewAutoRound(): void {
  const rollover = storage.getAccumulatedPool();

  const round = storage.createRound({
    status:      "open",
    entryFee:    FIXED_ENTRY_FEE,
    pool:        "0",
    rolloverPool: rollover,
    totalPool:   rollover,
    contractType:"qan",
    playerCount: 0,
    headsCount:  0,
    tailsCount:  0,
    unclaimedPrize: "0",
    createdAt:   Date.now(),
  });

  storage.setAccumulatedPool("0");

  storage.createEvent({
    type:    "GameStarted",
    roundId: round.id,
    data:    JSON.stringify({
      entryFee:     FIXED_ENTRY_FEE,
      rolloverPool: rollover,
      auto:         true,
      endsAt:       Date.now() + ROUND_DURATION_MS(),
    }),
    timestamp: Date.now(),
  });

  console.log(
    `[roundManager] Auto round #${round.id} opened` +
    (parseFloat(rollover) > 0 ? ` | rollover: ${rollover} QANX` : "")
  );

  scheduleClose(round.id, ROUND_DURATION_MS());
}

// ─── Schedule close ───────────────────────────────────────────────────────────
function scheduleClose(roundId: number, delayMs: number): void {
  if (roundTimer) clearTimeout(roundTimer);

  roundTimer = setTimeout(async () => {
    try {
      const round = storage.getRound(roundId);

      if (!round || round.status !== "open") {
        // Was closed manually (admin) — just schedule the next round
        console.log(`[roundManager] Round #${roundId} was already closed, starting next…`);
        setTimeout(startNewAutoRound, POST_CLOSE_DELAY_MS);
        return;
      }

      if ((round.playerCount || 0) < 1) {
        // No players — skip the flip, mark closed silently
        console.log(`[roundManager] Round #${roundId} had 0 players, skipping flip`);
        storage.updateRound(roundId, { status: "closed" });
        storage.createEvent({
          type:    "RoundSkipped",
          roundId,
          data:    JSON.stringify({ reason: "no_players" }),
          timestamp: Date.now(),
        });
      } else {
        await executeCloseRound(roundId);
      }
    } catch (err: any) {
      console.error(`[roundManager] Error closing round #${roundId}:`, err.message);
    } finally {
      // Always schedule next round after the cooldown
      setTimeout(startNewAutoRound, POST_CLOSE_DELAY_MS);
    }
  }, Math.max(delayMs, 0));
}

// ─── Init (called once at server startup) ────────────────────────────────────
export function initRoundManager(): void {
  const current = storage.getCurrentRound();

  if (current && current.status === "open" && current.createdAt) {
    const elapsed   = Date.now() - current.createdAt;
    const remaining = ROUND_DURATION_MS() - elapsed;

    if (remaining > 0) {
      console.log(
        `[roundManager] Resuming round #${current.id}, ` +
        `${Math.ceil(remaining / 1000)}s remaining`
      );
      scheduleClose(current.id, remaining);
    } else {
      // Server was down during this round — close it immediately
      const overdue = Math.abs(remaining / 1000).toFixed(0);
      console.log(
        `[roundManager] Round #${current.id} overdue by ${overdue}s, closing immediately`
      );
      scheduleClose(current.id, 500);
    }
  } else {
    // No open round — start one after a short delay so the server is fully ready
    console.log("[roundManager] No open round found, starting one in 3s…");
    setTimeout(startNewAutoRound, 3000);
  }
}
