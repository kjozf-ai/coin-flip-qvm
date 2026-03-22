import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Game rounds
export const rounds = sqliteTable("rounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("open"), // open, closed
  entryFee: text("entry_fee").notNull().default("0.1"),
  pool: text("pool").notNull().default("0"),
  rolloverPool: text("rollover_pool").notNull().default("0"), // from previous unclaimed
  totalPool: text("total_pool").notNull().default("0"), // pool + rollover
  result: text("result"), // heads, tails
  winnerCount: integer("winner_count").default(0),
  prizePerWinner: text("prize_per_winner").default("0"),
  randomHex: text("random_hex"),
  contractType: text("contract_type").notNull().default("js"),
  playerCount: integer("player_count").default(0),
  headsCount: integer("heads_count").default(0),
  tailsCount: integer("tails_count").default(0),
  unclaimedPrize: text("unclaimed_prize").default("0"), // prize not yet claimed
  createdAt: integer("created_at"),
});

// Bets
export const bets = sqliteTable("bets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roundId: integer("round_id").notNull(),
  playerAddress: text("player_address").notNull(),
  guess: text("guess").notNull(), // heads, tails
  txHash: text("tx_hash"), // MetaMask transaction hash
  won: integer("won").default(0),
  claimed: integer("claimed").default(0),
  claimTxHash: text("claim_tx_hash"),
});

// Leaderboard
export const leaderboard = sqliteTable("leaderboard", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerAddress: text("player_address").notNull().unique(),
  totalGames: integer("total_games").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  totalWon: text("total_won").notNull().default("0"),
});

// Event log
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  roundId: integer("round_id"),
  playerAddress: text("player_address"),
  data: text("data"),
  timestamp: integer("timestamp").notNull(),
});

// Game config (single row for global state)
export const gameConfig = sqliteTable("game_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminAddress: text("admin_address"),
  accumulatedPool: text("accumulated_pool").notNull().default("0"), // unclaimed prizes rolling over
});

export const insertRoundSchema = createInsertSchema(rounds).omit({ id: true });
export const insertBetSchema = createInsertSchema(bets).omit({ id: true });
export const insertLeaderboardSchema = createInsertSchema(leaderboard).omit({ id: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true });

export type Round = typeof rounds.$inferSelect;
export type InsertRound = z.infer<typeof insertRoundSchema>;
export type Bet = typeof bets.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type LeaderboardEntry = typeof leaderboard.$inferSelect;
export type GameEvent = typeof events.$inferSelect;
