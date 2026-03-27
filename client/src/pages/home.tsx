import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";
import { QAN_TESTNET } from "@/lib/qan-config";
import type { Round, LeaderboardEntry, GameEvent } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Coins, Wallet, Trophy, Activity, Zap,
  CircleDot, Users, ExternalLink, Shield, ChevronRight,
  Clock, TrendingUp, Sparkles,
} from "lucide-react";

// ─── Constants (mirrored from server) ────────────────────────────────────────
const ROUND_DURATION_MS  = 5 * 60 * 1000;
const FIXED_ENTRY_FEE    = "1.0";
const COMMISSION_PERCENT = 10;

function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
function formatQANX(value: string | number) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(n) ? "0" : n.toFixed(4);
}

// ─── Coin Flip Modal ─────────────────────────────────────────────────────────
interface CoinFlipResult {
  result: "heads" | "tails";
  winnerCount: number;
  randomHex?: string | null;
  blockNumber?: number | null;
}

function CoinFlipModal({ data, onClose }: { data: CoinFlipResult; onClose: () => void }) {
  const [phase, setPhase] = useState<"flipping" | "revealing">("flipping");

  useEffect(() => {
    const t = setTimeout(() => setPhase("revealing"), 3600);
    return () => clearTimeout(t);
  }, []);

  const isHeads = data.result === "heads";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-lg"
      onClick={phase === "revealing" ? onClose : undefined}
    >
      {/* Ambient glow */}
      <div
        className={`absolute w-[420px] h-[420px] rounded-full blur-[130px] opacity-20 pointer-events-none transition-colors duration-1000 ${
          isHeads ? "bg-amber-400" : "bg-violet-600"
        }`}
      />

      {/* 3D Coin */}
      <div style={{ perspective: "900px" }} className="relative z-10">
        <div className={`coin ${isHeads ? "coin-flip-heads" : "coin-flip-tails"}`}>
          <div className="coin-face coin-heads">H</div>
          <div className="coin-face coin-tails">T</div>
        </div>
      </div>

      {/* Result overlay */}
      {phase === "revealing" && (
        <div className="relative z-10 mt-10 text-center animate-fade-in-up space-y-4 px-6">
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Result</p>
          <h2 className={`text-6xl font-black tracking-tight ${
            isHeads
              ? "text-amber-400 drop-shadow-[0_0_24px_rgba(251,191,36,0.65)]"
              : "text-violet-400 drop-shadow-[0_0_24px_rgba(167,139,250,0.65)]"
          }`}>
            {isHeads ? "HEADS" : "TAILS"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {data.winnerCount} winner{data.winnerCount !== 1 ? "s" : ""}
          </p>
          {data.randomHex && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-muted-foreground">
              <Shield className="w-3 h-3 text-cyan-400" />
              {data.blockNumber && <span>Block #{data.blockNumber}</span>}
              <span>· {data.randomHex.slice(0, 14)}…</span>
            </div>
          )}
          <button
            onClick={onClose}
            className="mt-2 inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/8 border border-white/15 text-sm text-white/70 hover:bg-white/12 hover:text-white transition-all"
          >
            Continue <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {phase === "flipping" && (
        <p className="relative z-10 mt-8 text-xs text-muted-foreground tracking-widest animate-pulse uppercase">
          Flipping…
        </p>
      )}
    </div>
  );
}

// ─── Round Countdown Timer ────────────────────────────────────────────────────
function useRoundTimer() {
  const { data: timerData } = useQuery<{
    active: boolean;
    remainingMs: number;
    endsAt: number | null;
    durationMs: number;
  }>({
    queryKey: ["/api/rounds/timer"],
    refetchInterval: 15_000,
  });

  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!timerData?.endsAt || !timerData.active) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, timerData.endsAt! - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerData?.endsAt, timerData?.active]);

  return { remaining, active: timerData?.active ?? false, durationMs: timerData?.durationMs ?? ROUND_DURATION_MS };
}

function RoundTimerBar() {
  const { remaining, active, durationMs } = useRoundTimer();
  if (!active) return null;

  const minutes  = Math.floor(remaining / 60_000);
  const seconds  = Math.floor((remaining % 60_000) / 1000);
  const progress = Math.max(0, Math.min(100, (remaining / durationMs) * 100));
  const urgent   = remaining < 60_000;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Round closes in
        </span>
        <span className={`font-mono font-bold text-sm ${urgent ? "text-red-400 animate-pulse" : "text-cyan-400"}`}>
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgent ? "bg-red-400" : "bg-cyan-400"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ─── Wallet Connect ──────────────────────────────────────────────────────────
function WalletConnect() {
  const { address, balance, isConnected, isCorrectNetwork, isConnecting, connect, switchNetwork, disconnect } = useWallet();

  if (!isConnected) {
    return (
      <Button
        onClick={connect}
        disabled={isConnecting}
        size="sm"
        className="bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 transition-all"
        data-testid="button-connect-wallet"
      >
        <Wallet className="w-4 h-4 mr-2" />
        {isConnecting ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="text-xs">Wrong Network</Badge>
        <Button
          onClick={switchNetwork}
          size="sm"
          variant="outline"
          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          data-testid="button-switch-network"
        >
          Switch to QAN TestNet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Balance</div>
        <div className="font-mono text-sm font-semibold text-cyan-300" data-testid="text-balance">
          {balance || "0"} QANX
        </div>
      </div>
      <Badge variant="secondary" className="font-mono border border-white/10 bg-white/5" data-testid="text-address">
        {shortenAddress(address!)}
      </Badge>
      <Button
        onClick={disconnect}
        size="sm"
        variant="ghost"
        className="text-xs text-muted-foreground hover:text-foreground"
        data-testid="button-disconnect"
      >
        Disconnect
      </Button>
    </div>
  );
}

// ─── Game Lobby ──────────────────────────────────────────────────────────────
function GameLobby() {
  const { address, isConnected, isCorrectNetwork } = useWallet();
  const [guess, setGuess] = useState<"heads" | "tails" | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: currentRound, isLoading } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 2000,
  });

  const { data: gameAddress } = useQuery<{ address: string | null; enabled: boolean }>({
    queryKey: ["/api/game/address"],
  });

  const placeBet = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;

      if (isConnected && isCorrectNetwork && (window as any).ethereum && gameAddress?.address) {
        setTxStatus("Waiting for MetaMask approval…");
        const toAddr   = gameAddress.address;
        const feeParts = FIXED_ENTRY_FEE.split(".");
        const whole    = feeParts[0] || "0";
        const frac     = (feeParts[1] || "").padEnd(18, "0").slice(0, 18);
        const weiClean = (whole + frac).replace(/^0+/, "") || "0";
        const feeWei   = "0x" + BigInt(weiClean).toString(16);

        try {
          txHash = await (window as any).ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: address, to: toAddr, value: feeWei }],
          });
          setTxStatus("Transaction sent!");
        } catch (e: any) {
          setTxStatus(null);
          if (e.code === 4001) throw new Error("Transaction rejected");
          throw e;
        }
      }

      const res = await apiRequest("POST", "/api/bets", {
        roundId:       currentRound?.id,
        playerAddress: address || "0xDemo_" + Math.random().toString(16).slice(2, 8),
        guess,
        txHash,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Bet placed!", description: `${guess === "heads" ? "Heads" : "Tails"} — ${FIXED_ENTRY_FEE} QANX` });
      setGuess(null);
      setTimeout(() => setTxStatus(null), 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setTxStatus(null);
    },
  });

  const isOpen    = currentRound?.status === "open";
  const canBet    = isOpen && guess !== null;

  return (
    <Card className="border-glow-cyan bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="w-4 h-4 text-cyan-400" />
            Game Lobby
          </CardTitle>
          {currentRound && (
            <Badge
              className={
                isOpen
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-white/8 text-muted-foreground border border-white/10"
              }
              data-testid="badge-round-status"
            >
              {isOpen ? "● Open" : "Closed"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timer bar */}
        <RoundTimerBar />

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !currentRound || !isOpen ? (
          <div className="text-center py-6">
            <CircleDot className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">
              Next round starts automatically…
            </p>
            {currentRound?.result && (
              <div className="mt-3 inline-flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Last result:</span>
                <Badge className={
                  currentRound.result === "heads"
                    ? "bg-amber-500/15 border border-amber-500/25 text-amber-300"
                    : "bg-violet-500/15 border border-violet-500/25 text-violet-300"
                }>
                  {currentRound.result === "heads" ? "Heads" : "Tails"}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Round",   value: `#${currentRound.id}`,                                  id: "text-round-number" },
                { label: "Pot",     value: formatQANX(currentRound.totalPool || currentRound.pool), id: "text-pool",         suffix: "QANX" },
                { label: "Players", value: `${currentRound.playerCount || 0}`,                     id: "text-player-count" },
              ].map(s => (
                <div key={s.label} className="text-center p-2.5 rounded-lg bg-white/4 border border-white/8">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
                  <div className="font-bold text-base mt-0.5" data-testid={s.id}>
                    {s.value}
                    {s.suffix && <span className="text-[10px] font-normal text-muted-foreground ml-1">{s.suffix}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
              <span>
                Entry fee: <span className="text-cyan-300 font-semibold">{FIXED_ENTRY_FEE} QANX</span>
              </span>
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px]">{COMMISSION_PERCENT}% house fee</span>
              </span>
            </div>

            {parseFloat(currentRound.rolloverPool || "0") > 0 && (
              <div className="text-xs text-center text-muted-foreground">
                💰 +{currentRound.rolloverPool} QANX rollover from previous round
              </div>
            )}

            {isConnected && isCorrectNetwork ? (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Pick your side:</div>
                <div className="grid grid-cols-2 gap-3">
                  {/* HEADS */}
                  <button
                    onClick={() => setGuess("heads")}
                    data-testid="button-guess-heads"
                    className={`p-5 rounded-2xl border-2 text-center transition-all duration-200 ${
                      guess === "heads"
                        ? "border-amber-400/60 bg-amber-500/12 scale-[1.03] shadow-[0_0_24px_rgba(251,191,36,0.28)]"
                        : "border-white/10 hover:border-amber-400/30 hover:bg-amber-500/6"
                    }`}
                  >
                    <div className={`w-14 h-14 mx-auto mb-2.5 rounded-full flex items-center justify-center text-2xl font-black border-2 transition-all ${
                      guess === "heads"
                        ? "bg-gradient-to-br from-yellow-300 to-amber-600 border-amber-400/70 text-amber-900 shadow-[0_0_18px_rgba(251,191,36,0.55)]"
                        : "bg-gradient-to-br from-amber-900/25 to-yellow-900/25 border-amber-700/30 text-amber-700/60"
                    }`}>H</div>
                    <div className={`font-bold ${guess === "heads" ? "text-amber-300" : "text-muted-foreground"}`}>Heads</div>
                  </button>

                  {/* TAILS */}
                  <button
                    onClick={() => setGuess("tails")}
                    data-testid="button-guess-tails"
                    className={`p-5 rounded-2xl border-2 text-center transition-all duration-200 ${
                      guess === "tails"
                        ? "border-violet-400/60 bg-violet-500/12 scale-[1.03] shadow-[0_0_24px_rgba(167,139,250,0.28)]"
                        : "border-white/10 hover:border-violet-400/30 hover:bg-violet-500/6"
                    }`}
                  >
                    <div className={`w-14 h-14 mx-auto mb-2.5 rounded-full flex items-center justify-center text-2xl font-black border-2 transition-all ${
                      guess === "tails"
                        ? "bg-gradient-to-br from-violet-300 to-purple-700 border-violet-400/70 text-violet-100 shadow-[0_0_18px_rgba(167,139,250,0.55)]"
                        : "bg-gradient-to-br from-violet-900/25 to-purple-900/25 border-violet-700/30 text-violet-700/60"
                    }`}>T</div>
                    <div className={`font-bold ${guess === "tails" ? "text-violet-300" : "text-muted-foreground"}`}>Tails</div>
                  </button>
                </div>

                <Button
                  onClick={() => placeBet.mutate()}
                  disabled={!canBet || placeBet.isPending}
                  className="w-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 disabled:opacity-40 transition-all"
                  data-testid="button-place-bet"
                >
                  {placeBet.isPending
                    ? txStatus || "Processing…"
                    : `🔒 Enter — ${FIXED_ENTRY_FEE} QANX`}
                </Button>

                {txStatus && !placeBet.isPending && (
                  <p className="text-xs text-center text-emerald-400">{txStatus}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-center text-muted-foreground">
                Connect wallet to place bets.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Pending Prizes ───────────────────────────────────────────────────────────
function PendingPrizes() {
  const { address, isConnected } = useWallet();
  const { toast } = useToast();

  const { data: pendingData } = useQuery<{
    prizes: Array<{ roundId: number; betId: number; amount: string }>;
    totalAmount: string;
    count: number;
  }>({
    queryKey: ["/api/pending", address],
    refetchInterval: 4000,
    enabled: !!address && isConnected,
  });

  const claimPrize = useMutation({
    mutationFn: async (roundId: number) => {
      const res = await apiRequest("POST", "/api/claim", { playerAddress: address, roundId });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pending", address] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: data.blockchainTransfer ? "✅ QANX sent to your wallet!" : "Prize recorded",
        description: `${data.amount} QANX`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!isConnected || !pendingData || pendingData.count === 0) return null;

  return (
    <Card className="border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-emerald-400" />
          Pending Prizes
          <Badge className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs">
            {pendingData.count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Total */}
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
          <div className="text-2xl font-bold text-emerald-400">{pendingData.totalAmount}</div>
          <div className="text-xs text-muted-foreground mt-0.5">QANX claimable</div>
        </div>

        {/* Per-round prizes */}
        <div className="space-y-1.5">
          {pendingData.prizes.map(prize => (
            <div
              key={prize.roundId}
              className="flex items-center justify-between p-2.5 rounded-lg bg-white/4 border border-white/8"
            >
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Round #{prize.roundId}</div>
                <div className="font-semibold text-emerald-400 text-sm">{prize.amount} QANX</div>
              </div>
              <Button
                size="sm"
                onClick={() => claimPrize.mutate(prize.roundId)}
                disabled={claimPrize.isPending}
                className="bg-emerald-600/70 hover:bg-emerald-500/70 border border-emerald-400/30 text-white text-xs h-8 px-3"
              >
                Claim
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Jackpot Widget ───────────────────────────────────────────────────────────
interface PoolData {
  accumulated: string;
  jackpotPool: string;
  closedRoundCount: number;
  jackpotInterval: number;
  roundsUntilJackpot: number;
}

function JackpotWidget() {
  const { data: poolData } = useQuery<PoolData>({
    queryKey: ["/api/pool"],
    refetchInterval: 8000,
  });

  const jackpot        = parseFloat(poolData?.jackpotPool    || "0");
  const interval       = poolData?.jackpotInterval           ?? 10;
  const closed         = poolData?.closedRoundCount          ?? 0;
  const until          = poolData?.roundsUntilJackpot        ?? interval;
  const completed      = closed % interval;   // rounds already done in this cycle
  const progress       = interval > 0 ? (completed / interval) * 100 : 0;
  const isImminent     = until <= 2 && until > 0;

  return (
    <Card className={`border backdrop-blur-sm ${isImminent ? "border-yellow-400/40 bg-yellow-500/5" : "border-violet-500/25 bg-violet-500/5"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${isImminent ? "text-yellow-400 animate-pulse" : "text-violet-400"}`} />
          Jackpot Fund
          {isImminent && (
            <Badge className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 text-[10px] animate-pulse">
              SOON!
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Current jackpot amount */}
        <div className={`p-3 rounded-xl text-center border ${isImminent ? "bg-yellow-500/10 border-yellow-500/25" : "bg-violet-500/8 border-violet-500/20"}`}>
          <div className={`text-3xl font-black ${isImminent ? "text-yellow-300" : "text-violet-300"}`}>
            {jackpot.toFixed(4)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">QANX accumulated</div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Rounds this cycle
            </span>
            <span className={`font-mono font-bold ${isImminent ? "text-yellow-300" : "text-violet-300"}`}>
              {completed} / {interval}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/8 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                isImminent
                  ? "bg-gradient-to-r from-yellow-400 to-amber-300"
                  : "bg-gradient-to-r from-violet-500 to-purple-400"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {until === 0
              ? "🎰 Jackpot fires this round!"
              : `${until} more round${until !== 1 ? "s" : ""} until jackpot fires`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Event Log ───────────────────────────────────────────────────────────────
function EventLog() {
  const { data: events } = useQuery<GameEvent[]>({
    queryKey: ["/api/events"],
    refetchInterval: 3000,
  });

  const eventIcon = (type: string) => {
    switch (type) {
      case "GameStarted":      return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
      case "BetPlaced":        return <Coins className="w-3.5 h-3.5 text-cyan-400" />;
      case "GameFinished":     return <Trophy className="w-3.5 h-3.5 text-amber-400" />;
      case "PrizeClaimed":     return <Zap className="w-3.5 h-3.5 text-violet-400" />;
      case "RoundSkipped":     return <CircleDot className="w-3.5 h-3.5 text-muted-foreground" />;
      case "JackpotTriggered": return <Sparkles className="w-3.5 h-3.5 text-yellow-400" />;
      default:                 return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Event Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
          {(!events || events.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6">No events yet</p>
          ) : (
            events.map(evt => {
              const data = evt.data ? JSON.parse(evt.data) : {};
              return (
                <div key={evt.id} className="flex items-start gap-2 p-2 rounded-lg bg-white/3 border border-white/6 text-xs" data-testid={`event-${evt.id}`}>
                  <div className="mt-0.5 shrink-0">{eventIcon(evt.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground/80">{evt.type}</span>
                      {evt.roundId && (
                        <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">
                          #{evt.roundId}
                        </Badge>
                      )}
                    </div>
                    {evt.playerAddress && (
                      <div className="text-muted-foreground font-mono truncate">{shortenAddress(evt.playerAddress)}</div>
                    )}
                    {data.guess   && <span className="text-muted-foreground">Guess: {data.guess === "heads" ? "Heads" : "Tails"}</span>}
                    {data.result  && (
                      <span className="text-muted-foreground"> · Result: <span className={data.result === "heads" ? "text-amber-400" : "text-violet-400"}>
                        {data.result === "heads" ? "Heads" : "Tails"}</span>
                      </span>
                    )}
                    {data.winnerCount !== undefined && (
                      <span className="text-muted-foreground"> ({data.winnerCount} winner{data.winnerCount !== 1 ? "s" : ""})</span>
                    )}
                    {data.commission && (
                      <span className="text-muted-foreground"> · fee: {data.commission} QANX</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(evt.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
function Leaderboard() {
  const { data: entries } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 5000,
  });

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!entries || entries.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-6">No data yet</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 text-[10px] text-muted-foreground uppercase tracking-wider px-2 mb-2">
              <span>#</span>
              <span>Player</span>
              <span className="text-center">W/G</span>
              <span className="text-right">QANX Won</span>
            </div>
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className={`grid grid-cols-4 text-sm p-2.5 rounded-lg transition-colors ${
                  i === 0 ? "bg-amber-500/8 border border-amber-500/20" : "bg-white/3 border border-white/6 hover:bg-white/5"
                }`}
                data-testid={`leaderboard-row-${i}`}
              >
                <span className="text-base">{medals[i] || `${i + 1}.`}</span>
                <span className="font-mono text-xs text-muted-foreground truncate">{shortenAddress(entry.playerAddress)}</span>
                <span className="text-center font-semibold text-sm">
                  <span className="text-emerald-400">{entry.wins}</span>
                  <span className="text-muted-foreground text-xs">/{entry.totalGames}</span>
                </span>
                <span className="text-right font-mono text-xs text-cyan-400">{formatQANX(entry.totalWon)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin Panel (minimal — rounds are automatic) ─────────────────────────────
function AdminPanel() {
  const { address, isConnected } = useWallet();
  const { toast } = useToast();
  const [showEmergency, setShowEmergency] = useState(false);
  const [durationInput, setDurationInput] = useState("");

  // All hooks must be called unconditionally (Rules of Hooks)
  const { data: currentRound } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 5000,
  });

  const { data: adminBalance } = useQuery<{ balance: string; address: string; enabled: boolean } | null>({
    queryKey: ["/api/admin/balance"],
    refetchInterval: 15000,
    enabled: isConnected,
  });

  const { data: poolData } = useQuery<PoolData>({
    queryKey: ["/api/pool"],
    refetchInterval: 10000,
  });

  const { data: gameConfig, refetch: refetchConfig } = useQuery<{
    roundDurationMs: number;
    defaultDurationMs: number;
    commissionPercent: number;
    entryFee: string;
  }>({
    queryKey: ["/api/game/config"],
    refetchInterval: 30000,
  });

  // Sync input with live config (only when not editing)
  useEffect(() => {
    if (gameConfig && durationInput === "") {
      setDurationInput(String(gameConfig.roundDurationMs / 60_000));
    }
  }, [gameConfig?.roundDurationMs]);

  // Update round duration
  const updateDuration = useMutation({
    mutationFn: async (minutes: number) => {
      const res = await apiRequest("POST", "/api/admin/settings", {
        roundDurationMs: minutes * 60_000,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      refetchConfig();
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/timer"] });
      toast({
        title: "Round duration updated",
        description: `New rounds will last ${data.roundDurationMin} minute${data.roundDurationMin !== 1 ? "s" : ""}`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Emergency manual close
  const closeRound = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rounds/${currentRound?.id}/close`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Round closed manually" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const activeDurationMin = gameConfig ? gameConfig.roundDurationMs / 60_000 : 3;

  // Only show panel for the admin/game wallet — checked AFTER all hooks
  const isAdmin =
    isConnected &&
    !!address &&
    !!adminBalance?.address &&
    address.toLowerCase() === adminBalance.address.toLowerCase();

  if (!isAdmin) return null;

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-violet-400" />
          Game Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Accumulated pool */}
        {parseFloat(poolData?.accumulated || "0") > 0 && (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs">
            <span className="text-muted-foreground">Rollover pool</span>
            <span className="font-mono text-amber-400 font-semibold">{poolData?.accumulated} QANX</span>
          </div>
        )}

        {/* Jackpot pool teaser */}
        {parseFloat(poolData?.jackpotPool || "0") > 0 && (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-violet-500/8 border border-violet-500/20 text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-violet-400" />
              Jackpot fund
            </span>
            <span className="font-mono text-violet-300 font-semibold">{poolData?.jackpotPool} QANX</span>
          </div>
        )}

        {/* Game wallet balance */}
        {adminBalance?.enabled && adminBalance.balance && (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/4 border border-white/8 text-xs">
            <span className="text-muted-foreground">Game wallet</span>
            <span className="font-mono text-cyan-400">{adminBalance.balance} QANX</span>
          </div>
        )}

        {/* Round config stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-lg bg-white/4 border border-white/8 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Entry</div>
            <div className="font-semibold text-sm text-cyan-300 mt-0.5">{FIXED_ENTRY_FEE} QANX</div>
          </div>
          <div className="p-2.5 rounded-lg bg-white/4 border border-white/8 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">House</div>
            <div className="font-semibold text-sm text-violet-300 mt-0.5">{COMMISSION_PERCENT}%</div>
          </div>
          <div className="p-2.5 rounded-lg bg-cyan-500/8 border border-cyan-500/20 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Duration</div>
            <div className="font-semibold text-sm text-cyan-300 mt-0.5">{activeDurationMin} min</div>
          </div>
        </div>

        {/* Round duration editor */}
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Round duration</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              value={durationInput}
              onChange={e => setDurationInput(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-lg border border-white/12 bg-white/5 text-sm font-mono focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20"
              placeholder="minutes"
            />
            <span className="text-xs text-muted-foreground shrink-0">min</span>
            <Button
              size="sm"
              onClick={() => {
                const mins = parseFloat(durationInput);
                if (!isNaN(mins) && mins >= 1) updateDuration.mutate(mins);
              }}
              disabled={updateDuration.isPending}
              className="shrink-0 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 text-xs h-8 px-3"
            >
              {updateDuration.isPending ? "…" : "Set"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Takes effect from the next round (1–60 min). Resets to {gameConfig?.defaultDurationMs ? gameConfig.defaultDurationMs / 60_000 : 3} min on server restart.
          </p>
        </div>

        {/* Auto-round indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-white/3 border border-white/6">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          Rounds run automatically every {activeDurationMin} minute{activeDurationMin !== 1 ? "s" : ""}
        </div>

        {/* Emergency controls */}
        {isConnected && (
          <div>
            <button
              onClick={() => setShowEmergency(v => !v)}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full text-left"
            >
              {showEmergency ? "▼" : "▶"} Emergency controls
            </button>
            {showEmergency && (
              <div className="mt-2 pt-2 border-t border-white/8">
                <Button
                  onClick={() => closeRound.mutate()}
                  disabled={closeRound.isPending || !currentRound || currentRound.status !== "open" || (currentRound.playerCount || 0) < 1}
                  size="sm"
                  variant="outline"
                  className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs disabled:opacity-40"
                  data-testid="button-close-round"
                >
                  {closeRound.isPending ? "Closing…" : "Force Close Current Round"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Round History ────────────────────────────────────────────────────────────
function RoundHistory() {
  const { data: rounds } = useQuery<Round[]>({
    queryKey: ["/api/rounds"],
    refetchInterval: 5000,
  });

  const closed = rounds?.filter(r => r.status === "closed").slice(0, 6) ?? [];

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-muted-foreground" />
          Round History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {closed.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No rounds yet</p>
        ) : (
          <div className="space-y-1.5">
            {closed.map(round => (
              <div key={round.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/3 border border-white/6 text-sm hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground text-xs">#{round.id}</span>
                  <Badge className={
                    round.result === "heads"
                      ? "bg-amber-500/15 border border-amber-500/25 text-amber-300 text-[10px]"
                      : round.result === "tails"
                      ? "bg-violet-500/15 border border-violet-500/25 text-violet-300 text-[10px]"
                      : "bg-white/8 text-muted-foreground text-[10px]"
                  }>
                    {round.result === "heads" ? "Heads" : round.result === "tails" ? "Tails" : "No players"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{round.playerCount}</span>
                  <span className="font-mono text-cyan-400/70">{formatQANX(round.pool)} QANX</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [coinFlipResult, setCoinFlipResult] = useState<CoinFlipResult | null>(null);

  // Watch for automatic round close (open → closed transition)
  const { data: currentRound } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 2000,
  });

  const prevRoundRef = useRef<{ id: number; status: string } | null>(null);

  useEffect(() => {
    if (!currentRound) return;
    const prev = prevRoundRef.current;

    // Only fire animation if we've observed this round while it was OPEN
    if (
      prev &&
      prev.id === currentRound.id &&
      prev.status === "open" &&
      currentRound.status === "closed"
    ) {
      setCoinFlipResult({
        result:      currentRound.result as "heads" | "tails",
        winnerCount: currentRound.winnerCount ?? 0,
        randomHex:   currentRound.randomHex ?? null,
        blockNumber: null,
      });
    }

    prevRoundRef.current = { id: currentRound.id, status: currentRound.status };
  }, [currentRound?.id, currentRound?.status]);

  return (
    <div className="min-h-screen bg-background space-bg">
      {/* Coin Flip Modal */}
      {coinFlipResult && (
        <CoinFlipModal data={coinFlipResult} onClose={() => setCoinFlipResult(null)} />
      )}

      {/* Header */}
      <header className="border-b border-white/8 bg-card/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/30 to-violet-600/30 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-none gradient-text">QAN CoinFlip</h1>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                Auto rounds · 1 QANX entry · 90% winners · 5% jackpot
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <a href={QAN_TESTNET.faucetUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors hidden sm:flex items-center gap-1"
              data-testid="link-faucet">
              <ExternalLink className="w-3 h-3" />Faucet
            </a>
            <a href={QAN_TESTNET.blockExplorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors hidden sm:flex items-center gap-1"
              data-testid="link-explorer">
              <ExternalLink className="w-3 h-3" />Explorer
            </a>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* Left: Lobby + Admin */}
          <div className="lg:col-span-4 space-y-4">
            <GameLobby />
            <AdminPanel />
          </div>

          {/* Center: Prizes + Jackpot + History */}
          <div className="lg:col-span-4 space-y-4">
            <PendingPrizes />
            <JackpotWidget />
            <RoundHistory />
          </div>

          {/* Right: Events + Leaderboard */}
          <div className="lg:col-span-4 space-y-4">
            <Tabs defaultValue="events">
              <TabsList className="w-full bg-white/4 border border-white/8">
                <TabsTrigger value="events" className="flex-1 data-[state=active]:bg-white/10">
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />Events
                </TabsTrigger>
                <TabsTrigger value="leaderboard" className="flex-1 data-[state=active]:bg-white/10">
                  <Trophy className="w-3.5 h-3.5 mr-1.5 text-amber-400" />Leaderboard
                </TabsTrigger>
              </TabsList>
              <TabsContent value="events" className="mt-3"><EventLog /></TabsContent>
              <TabsContent value="leaderboard" className="mt-3"><Leaderboard /></TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── How It Works ──────────────────────────────────────────── */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-sm text-foreground/90">How It Works</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-white/8">

            {/* Step 1 */}
            <div className="px-5 py-4 space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-xs font-bold text-cyan-400 mb-2">1</div>
              <h4 className="text-sm font-semibold text-foreground/80">Join a Round</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Rounds open automatically every few minutes. Pay <span className="text-cyan-300 font-semibold">1 QANX</span> and pick Heads or Tails.
                You can join multiple rounds — your prizes persist until you claim them.
              </p>
            </div>

            {/* Step 2 */}
            <div className="px-5 py-4 space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-xs font-bold text-amber-400 mb-2">2</div>
              <h4 className="text-sm font-semibold text-foreground/80">Fair Randomness</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                At close time the result is determined by the latest <span className="text-amber-300 font-semibold">QAN block hash</span> — publicly verifiable
                on the block explorer. No server can manipulate the outcome.
              </p>
            </div>

            {/* Step 3 — prize split */}
            <div className="px-5 py-4 space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-xs font-bold text-emerald-400 mb-2">3</div>
              <h4 className="text-sm font-semibold text-foreground/80">Prize Split</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Every round's pot is split three ways:
              </p>
              <ul className="text-xs space-y-1 mt-1">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-emerald-300 font-semibold">90%</span>
                  <span className="text-muted-foreground">— divided equally among all winners</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                  <span className="text-violet-300 font-semibold">5%</span>
                  <span className="text-muted-foreground">— into the 🎰 Jackpot Fund</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
                  <span className="text-muted-foreground font-semibold">5%</span>
                  <span className="text-muted-foreground">— house fee (keeps the lights on)</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground mt-1">
                If nobody wins, the entire 90% rolls over into the next round's pot.
              </p>
            </div>

            {/* Step 4 — jackpot */}
            <div className="px-5 py-4 space-y-1.5">
              <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-xs font-bold text-violet-400 mb-2">4</div>
              <h4 className="text-sm font-semibold text-foreground/80">Jackpot Bonus</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The Jackpot Fund grows with every round: <span className="text-violet-300 font-semibold">5% of each pot</span> accumulates silently.
                Every <span className="text-yellow-300 font-semibold">10th closed round</span> the entire fund is injected into the next round's prize pool —
                creating a sudden mega-pot. The Jackpot Widget above shows real-time progress.
              </p>
            </div>
          </div>

          {/* Footer note */}
          <div className="px-5 py-3 border-t border-white/8 flex items-start gap-2.5 bg-white/2">
            <Shield className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              QAN TestNet is a <span className="text-cyan-300">post-quantum secure</span>, EVM-compatible blockchain.
              Results are verifiable on the{" "}
              <a href={QAN_TESTNET.blockExplorerUrl} target="_blank" rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 hover:underline">QAN Block Explorer</a>.
              Test QANX available at the{" "}
              <a href={QAN_TESTNET.faucetUrl} target="_blank" rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 hover:underline">faucet</a>.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 mt-12 py-5">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="gradient-text font-semibold">QAN CoinFlip</span>
            <span className="text-white/20">|</span>
            <span>Chain ID: {QAN_TESTNET.chainId}</span>
            <span className="text-white/20">|</span>
            <span>QVM Multi-Language Demo</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/60">
            <Shield className="w-3 h-3" />
            <span>Post-quantum secure</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
