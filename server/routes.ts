import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isBlockchainEnabled, getAdminBalance, sendPrize } from "./blockchain";
import {
  executeCloseRound,
  getRoundDurationMs,
  setRoundDurationMs,
  DEFAULT_ROUND_DURATION_MS,
  FIXED_ENTRY_FEE,
  COMMISSION_PERCENT,
  JACKPOT_INTERVAL,
} from "./roundManager";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Get current round ─────────────────────────────────────────────────
  // Heads/tails distribution is hidden while the round is open (fairness).
  app.get("/api/rounds/current", async (_req, res) => {
    const round = storage.getCurrentRound();
    if (!round) return res.json(null);

    if (round.status === "open") {
      // Strip bet distribution — players must not see how others voted
      return res.json({ ...round, headsCount: null, tailsCount: null });
    }
    res.json(round);
  });

  // ── Round countdown timer ─────────────────────────────────────────────
  app.get("/api/rounds/timer", async (_req, res) => {
    const dur   = getRoundDurationMs();
    const round = storage.getCurrentRound();
    if (!round || round.status !== "open" || !round.createdAt) {
      return res.json({ active: false, remainingMs: 0, endsAt: null, durationMs: dur });
    }
    const endsAt      = round.createdAt + dur;
    const remainingMs = Math.max(0, endsAt - Date.now());
    res.json({ active: true, remainingMs, endsAt, durationMs: dur, roundId: round.id });
  });

  // ── Get recent rounds ─────────────────────────────────────────────────
  app.get("/api/rounds", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 10;
    res.json(storage.getRecentRounds(limit));
  });

  // ── Get accumulated + jackpot pool info ──────────────────────────────
  app.get("/api/pool", async (_req, res) => {
    const closedCount        = storage.getClosedRoundCount();
    const roundsUntilJackpot = JACKPOT_INTERVAL - (closedCount % JACKPOT_INTERVAL);
    res.json({
      accumulated:         storage.getAccumulatedPool(),
      jackpotPool:         storage.getJackpotPool(),
      closedRoundCount:    closedCount,
      jackpotInterval:     JACKPOT_INTERVAL,
      roundsUntilJackpot:  roundsUntilJackpot === JACKPOT_INTERVAL ? 0 : roundsUntilJackpot,
    });
  });

  // ── Game config info ──────────────────────────────────────────────────
  app.get("/api/game/config", async (_req, res) => {
    res.json({
      entryFee:            FIXED_ENTRY_FEE,
      roundDurationMs:     getRoundDurationMs(),
      defaultDurationMs:   DEFAULT_ROUND_DURATION_MS,
      commissionPercent:   COMMISSION_PERCENT * 100,
    });
  });

  // ── Admin: update round duration ──────────────────────────────────────
  app.post("/api/admin/settings", async (req, res) => {
    const { roundDurationMs } = req.body;
    if (!roundDurationMs || typeof roundDurationMs !== "number") {
      return res.status(400).json({ error: "roundDurationMs (number, ms) is required" });
    }
    const accepted = setRoundDurationMs(roundDurationMs);
    res.json({
      success:         true,
      roundDurationMs: accepted,
      roundDurationMin: accepted / 60_000,
    });
  });

  // ── Place a bet ───────────────────────────────────────────────────────
  app.post("/api/bets", async (req, res) => {
    const { roundId, playerAddress, guess, txHash } = req.body;
    if (!playerAddress || !guess) {
      return res.status(400).json({ error: "playerAddress and guess are required" });
    }
    if (guess !== "heads" && guess !== "tails") {
      return res.status(400).json({ error: "guess must be 'heads' or 'tails'" });
    }

    const round = storage.getRound(roundId);
    if (!round)                    return res.status(404).json({ error: "Round not found" });
    if (round.status !== "open")   return res.status(400).json({ error: "Round is no longer open" });

    const existing = storage.getBetByAddressAndRound(playerAddress, roundId);
    if (existing)                  return res.status(400).json({ error: "You already bet in this round" });

    const bet = storage.createBet({ roundId, playerAddress, guess, txHash: txHash || null });

    const newPool      = (parseFloat(round.pool)        + parseFloat(FIXED_ENTRY_FEE)).toFixed(4);
    const newTotalPool = (parseFloat(newPool)            + parseFloat(round.rolloverPool || "0")).toFixed(4);
    const newHeads     = guess === "heads" ? (round.headsCount || 0) + 1 : round.headsCount || 0;
    const newTails     = guess === "tails" ? (round.tailsCount || 0) + 1 : round.tailsCount || 0;

    storage.updateRound(roundId, {
      playerCount: (round.playerCount || 0) + 1,
      pool:        newPool,
      totalPool:   newTotalPool,
      headsCount:  newHeads,
      tailsCount:  newTails,
    });

    storage.createEvent({
      type:          "BetPlaced",
      roundId,
      playerAddress,
      data:          JSON.stringify({ pool: newPool, totalPool: newTotalPool, txHash }),
      timestamp:     Date.now(),
    });

    res.json(bet);
  });

  // ── Close round (emergency admin override) ────────────────────────────
  app.post("/api/rounds/:id/close", async (req, res) => {
    const round = storage.getRound(parseInt(req.params.id));
    if (!round)                    return res.status(404).json({ error: "Round not found" });
    if (round.status !== "open")   return res.status(400).json({ error: "Round is not open" });
    if ((round.playerCount || 0) < 1) {
      return res.status(400).json({ error: "No players in this round yet" });
    }

    try {
      const data = await executeCloseRound(round.id);
      res.json({
        status:          "closed",
        result:          data.result,
        winnerCount:     data.winnerCount,
        prizePerWinner:  data.prizePerWinner,
        commission:      data.commission.toFixed(4),
        distributedPool: data.distributedPool.toFixed(4),
        totalPool:       data.totalPool.toFixed(4),
        randomHex:       data.randomHex,
        blockHash:       data.blockHash,
        blockNumber:     data.blockNumber,
        blockExplorerUrl:data.blockExplorerUrl,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pending prizes for a player (across all rounds) ───────────────────
  app.get("/api/pending/:address", async (req, res) => {
    const address      = req.params.address;
    const unclaimedBets= storage.getUnclaimedBetsForAddress(address);

    const prizes: Array<{ roundId: number; betId: number; amount: string }> = [];
    let totalAmount = 0;

    for (const bet of unclaimedBets) {
      const round = storage.getRound(bet.roundId);
      if (!round || round.status !== "closed") continue;
      const amount = parseFloat(round.prizePerWinner || "0");
      if (amount <= 0) continue;
      prizes.push({ roundId: bet.roundId, betId: bet.id, amount: amount.toFixed(4) });
      totalAmount += amount;
    }

    res.json({ prizes, totalAmount: totalAmount.toFixed(4), count: prizes.length });
  });

  // ── Claim a single prize ──────────────────────────────────────────────
  app.post("/api/claim", async (req, res) => {
    const { playerAddress, roundId } = req.body;
    if (!playerAddress || !roundId) {
      return res.status(400).json({ error: "playerAddress and roundId are required" });
    }

    const round = storage.getRound(roundId);
    if (!round || round.status !== "closed") {
      return res.status(400).json({ error: "Round is not closed" });
    }

    const bet = storage.getBetByAddressAndRound(playerAddress, roundId);
    if (!bet)         return res.status(400).json({ error: "You did not participate in this round" });
    if (!bet.won)     return res.status(400).json({ error: "You did not win this round" });
    if (bet.claimed)  return res.status(400).json({ error: "Prize already claimed" });

    const prizeAmount = round.prizePerWinner || "0";
    let claimTxHash: string | null = null;
    let blockchainSuccess = false;

    if (isBlockchainEnabled()) {
      try {
        claimTxHash       = await sendPrize(playerAddress, prizeAmount);
        blockchainSuccess = true;
        console.log(`[claim] ${prizeAmount} QANX → ${playerAddress} | tx: ${claimTxHash}`);
      } catch (err: any) {
        console.error("[claim] Blockchain transfer failed:", err.message);
        return res.status(500).json({
          error:             `Blockchain transfer failed: ${err.message}`,
          blockchainEnabled: true,
        });
      }
    } else {
      console.warn("[claim] ADMIN_PRIVATE_KEY not set — DB-only claim (fallback mode)");
    }

    storage.updateBet(bet.id, { claimed: 1, claimTxHash });

    const unclaimed = parseFloat(round.unclaimedPrize || "0") - parseFloat(prizeAmount);
    storage.updateRound(roundId, { unclaimedPrize: Math.max(0, unclaimed).toFixed(4) });

    storage.createEvent({
      type:          "PrizeClaimed",
      roundId,
      playerAddress,
      data:          JSON.stringify({ amount: prizeAmount, txHash: claimTxHash, blockchainTransfer: blockchainSuccess }),
      timestamp:     Date.now(),
    });

    res.json({
      success:             true,
      amount:              prizeAmount,
      txHash:              claimTxHash,
      blockchainTransfer:  blockchainSuccess,
      message:             blockchainSuccess
        ? `${prizeAmount} QANX sent to your wallet! Tx: ${claimTxHash}`
        : `${prizeAmount} QANX recorded (blockchain transfer inactive — ADMIN_PRIVATE_KEY required)`,
    });
  });

  // ── Finalize round (move unclaimed to accumulated pool) ───────────────
  app.post("/api/rounds/:id/finalize", async (req, res) => {
    const round = storage.getRound(parseInt(req.params.id));
    if (!round || round.status !== "closed") {
      return res.status(400).json({ error: "Round is not closed" });
    }

    const allBets         = storage.getBetsByRound(round.id);
    const unclaimedWinners= allBets.filter(b => b.won && !b.claimed);
    const unclaimedAmount = unclaimedWinners.length * parseFloat(round.prizePerWinner || "0");

    if (unclaimedAmount > 0) {
      const acc = parseFloat(storage.getAccumulatedPool());
      storage.setAccumulatedPool((acc + unclaimedAmount).toFixed(4));
      storage.updateRound(round.id, { unclaimedPrize: "0" });
      storage.createEvent({
        type:    "PoolRollover",
        roundId: round.id,
        data:    JSON.stringify({ amount: unclaimedAmount.toFixed(4), reason: "unclaimed prizes" }),
        timestamp: Date.now(),
      });
    }

    res.json({ success: true, rolledOver: unclaimedAmount.toFixed(4) });
  });

  // ── Bets for a round ──────────────────────────────────────────────────
  app.get("/api/rounds/:id/bets", async (req, res) => {
    // Only expose bets after round is closed (hidden during play)
    const round = storage.getRound(parseInt(req.params.id));
    if (round && round.status === "open") {
      return res.json([]);
    }
    res.json(storage.getBetsByRound(parseInt(req.params.id)));
  });

  // ── Check single round claim eligibility ──────────────────────────────
  app.get("/api/claim/:roundId/:address", async (req, res) => {
    const bet = storage.getBetByAddressAndRound(req.params.address, parseInt(req.params.roundId));
    if (!bet)        return res.json({ canClaim: false, reason: "not_participated" });
    if (!bet.won)    return res.json({ canClaim: false, reason: "lost" });
    if (bet.claimed) return res.json({ canClaim: false, reason: "already_claimed" });
    const round = storage.getRound(parseInt(req.params.roundId));
    return res.json({ canClaim: true, amount: round?.prizePerWinner || "0" });
  });

  // ── Leaderboard ───────────────────────────────────────────────────────
  app.get("/api/leaderboard", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(storage.getLeaderboard(limit));
  });

  // ── Events ────────────────────────────────────────────────────────────
  app.get("/api/events", async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(storage.getRecentEvents(limit));
  });

  // ── Game wallet address ───────────────────────────────────────────────
  app.get("/api/game/address", async (_req, res) => {
    if (!isBlockchainEnabled()) return res.json({ address: null, enabled: false });
    try {
      const { address } = await getAdminBalance();
      res.json({ address, enabled: true });
    } catch {
      res.json({ address: null, enabled: false });
    }
  });

  // ── Admin: wallet balance ─────────────────────────────────────────────
  app.get("/api/admin/balance", async (_req, res) => {
    if (!isBlockchainEnabled()) {
      return res.json({ enabled: false, message: "ADMIN_PRIVATE_KEY not set", address: null, balance: null });
    }
    try {
      const { address, balance } = await getAdminBalance();
      res.json({ enabled: true, address, balance });
    } catch (err: any) {
      res.status(500).json({ enabled: true, error: err.message });
    }
  });

  return httpServer;
}
