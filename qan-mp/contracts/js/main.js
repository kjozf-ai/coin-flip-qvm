// ============================================================================
// CoinFlip-JS — QVM JavaScript Smart Contract
// QAN TestNet | QVM Multi-Language Smart Contract Demo
// ============================================================================
// This contract implements a multiplayer coin flip game on the QAN TestNet.
// It demonstrates the QVM's multi-language capability by implementing the same
// game logic that also exists as a Go contract (CoinFlip-Go).
//
// QVM Storage Pattern:
//   READ:  process.env.DB_<KEY>        — read from contract database
//   WRITE: process.stdout.write("DBW=<KEY>=<VALUE>\n")  — write to contract database
//   OUTPUT: process.stdout.write("OUT=<key>: <value>\n") — output to caller
//
// QVM Syscalls used:
//   getrandom() — returns bytes derived from previous block's hash (deterministic)
//   time()      — returns previous block's timestamp (deterministic)
//
// Contract Functions:
//   construct     — initialize the contract (called once on deploy)
//   createRound   — admin creates a new game round with entry fee
//   joinGame      — player joins the current round with a guess (heads/tails)
//   closeRound    — admin closes the round, calculates result via QVM getrandom
//   claimPrize    — distribute winnings to winners of a round
//   getStatus     — query the current round status
// ============================================================================

const crypto = require('crypto');

// ─── Configuration ──────────────────────────────────────────────────────────
const MAX_PLAYERS_PER_ROUND = 50;
const MIN_ENTRY_FEE = "100000000000000000"; // 0.1 QANX in wei

// ─── Constructor ────────────────────────────────────────────────────────────
// Called once when the contract is first deployed with "construct" argument.
// Sets the owner/admin address and initializes the round counter.
function construct() {
    if (process.env.DB_QVM_INITIALIZED === "true") {
        process.stderr.write("ERR=contract is already initialized\n");
        process.exit(1);
    }

    // Store initialization parameters
    process.stdout.write("DBW=QVM_INIT_MAX_PLAYERS=" + MAX_PLAYERS_PER_ROUND + "\n");
    process.stdout.write("DBW=QVM_INIT_MIN_FEE=" + MIN_ENTRY_FEE + "\n");
    process.stdout.write("DBW=ROUND_COUNTER=0\n");
    process.stdout.write("DBW=TOTAL_GAMES_PLAYED=0\n");
    process.stdout.write("DBW=TOTAL_QANX_DISTRIBUTED=0\n");

    // Event: ContractInitialized
    process.stdout.write("OUT=event: ContractInitialized\n");
    process.stdout.write("OUT=maxPlayers: " + MAX_PLAYERS_PER_ROUND + "\n");
    process.stdout.write("OUT=minEntryFee: " + MIN_ENTRY_FEE + "\n");
    process.stdout.write("OUT=contractType: CoinFlip-JS (QVM JavaScript)\n");

    process.exit(0);
}

// ─── Initialize (called before every non-construct call) ────────────────────
function initialize() {
    if (process.env.DB_QVM_INITIALIZED !== "true") {
        process.stderr.write("ERR=contract is not initialized\n");
        process.exit(1);
    }
}

// ─── createRound(entryFee) ──────────────────────────────────────────────────
// Admin function: creates a new game round.
// Args: entryFee (in QANX wei units)
function createRound(entryFee) {
    const roundCounter = parseInt(process.env.DB_ROUND_COUNTER || "0");
    const currentRoundStatus = process.env["DB_ROUND_" + roundCounter + "_STATUS"] || "none";

    // Check if there's an active round
    if (currentRoundStatus === "open") {
        process.stderr.write("ERR=there is already an active round\n");
        process.exit(1);
    }

    const newRoundId = roundCounter + 1;
    const fee = entryFee || MIN_ENTRY_FEE;

    // Initialize the new round
    process.stdout.write("DBW=ROUND_COUNTER=" + newRoundId + "\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_STATUS=open\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_ENTRY_FEE=" + fee + "\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_PLAYER_COUNT=0\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_POOL=0\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_HEADS_COUNT=0\n");
    process.stdout.write("DBW=ROUND_" + newRoundId + "_TAILS_COUNT=0\n");

    // Event: GameStarted
    process.stdout.write("OUT=event: GameStarted\n");
    process.stdout.write("OUT=roundId: " + newRoundId + "\n");
    process.stdout.write("OUT=entryFee: " + fee + "\n");
    process.stdout.write("OUT=status: open\n");

    process.exit(0);
}

// ─── joinGame(playerAddress, guess) ─────────────────────────────────────────
// Player joins the current round with a guess ("heads" or "tails").
// The QANX entry fee is handled by the transaction value.
// Args: playerAddress, guess ("heads" or "tails")
function joinGame(playerAddress, guess) {
    const roundId = parseInt(process.env.DB_ROUND_COUNTER || "0");

    if (roundId === 0) {
        process.stderr.write("ERR=no active round\n");
        process.exit(1);
    }

    const status = process.env["DB_ROUND_" + roundId + "_STATUS"] || "none";
    if (status !== "open") {
        process.stderr.write("ERR=round is not open for betting\n");
        process.exit(1);
    }

    // Validate guess
    const normalizedGuess = guess.toLowerCase();
    if (normalizedGuess !== "heads" && normalizedGuess !== "tails") {
        process.stderr.write("ERR=invalid guess, must be heads or tails\n");
        process.exit(1);
    }

    // Check max players
    const playerCount = parseInt(process.env["DB_ROUND_" + roundId + "_PLAYER_COUNT"] || "0");
    const maxPlayers = parseInt(process.env.DB_QVM_INIT_MAX_PLAYERS || "50");

    if (playerCount >= maxPlayers) {
        process.stderr.write("ERR=round is full\n");
        process.exit(1);
    }

    // Check if player already joined
    const existingGuess = process.env["DB_ROUND_" + roundId + "_PLAYER_" + playerAddress + "_GUESS"];
    if (existingGuess) {
        process.stderr.write("ERR=player already joined this round\n");
        process.exit(1);
    }

    // Record the player's bet
    const entryFee = process.env["DB_ROUND_" + roundId + "_ENTRY_FEE"] || MIN_ENTRY_FEE;
    const currentPool = process.env["DB_ROUND_" + roundId + "_POOL"] || "0";
    const newPool = (BigInt(currentPool) + BigInt(entryFee)).toString();

    process.stdout.write("DBW=ROUND_" + roundId + "_PLAYER_" + playerCount + "=" + playerAddress + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_PLAYER_" + playerAddress + "_GUESS=" + normalizedGuess + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_PLAYER_COUNT=" + (playerCount + 1) + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_POOL=" + newPool + "\n");

    // Update heads/tails count
    if (normalizedGuess === "heads") {
        const headsCount = parseInt(process.env["DB_ROUND_" + roundId + "_HEADS_COUNT"] || "0");
        process.stdout.write("DBW=ROUND_" + roundId + "_HEADS_COUNT=" + (headsCount + 1) + "\n");
    } else {
        const tailsCount = parseInt(process.env["DB_ROUND_" + roundId + "_TAILS_COUNT"] || "0");
        process.stdout.write("DBW=ROUND_" + roundId + "_TAILS_COUNT=" + (tailsCount + 1) + "\n");
    }

    // Update player stats
    const playerGames = parseInt(process.env["DB_PLAYER_" + playerAddress + "_GAMES"] || "0");
    process.stdout.write("DBW=PLAYER_" + playerAddress + "_GAMES=" + (playerGames + 1) + "\n");

    // Event: BetPlaced
    process.stdout.write("OUT=event: BetPlaced\n");
    process.stdout.write("OUT=roundId: " + roundId + "\n");
    process.stdout.write("OUT=player: " + playerAddress + "\n");
    process.stdout.write("OUT=guess: " + normalizedGuess + "\n");
    process.stdout.write("OUT=pool: " + newPool + "\n");
    process.stdout.write("OUT=playerCount: " + (playerCount + 1) + "\n");

    process.exit(0);
}

// ─── closeRound() ───────────────────────────────────────────────────────────
// Admin function: closes the current round and determines the winner.
// Uses QVM's deterministic getrandom() syscall which returns bytes derived
// from the previous block's hash — ensuring verifiable, deterministic randomness.
function closeRound() {
    const roundId = parseInt(process.env.DB_ROUND_COUNTER || "0");

    if (roundId === 0) {
        process.stderr.write("ERR=no active round\n");
        process.exit(1);
    }

    const status = process.env["DB_ROUND_" + roundId + "_STATUS"];
    if (status !== "open") {
        process.stderr.write("ERR=round is not open\n");
        process.exit(1);
    }

    const playerCount = parseInt(process.env["DB_ROUND_" + roundId + "_PLAYER_COUNT"] || "0");
    if (playerCount < 1) {
        process.stderr.write("ERR=not enough players to close round\n");
        process.exit(1);
    }

    // ── QVM Deterministic Random ──────────────────────────────────────────
    // The QVM's getrandom() syscall returns bytes derived from the previous
    // block's hash. This is NOT truly random, but it IS deterministic and
    // verifiable across all QVM executor nodes. This is the QVM's approach
    // to "randomness" — a crypto-deterministic outcome that all nodes agree on.
    //
    // crypto.randomBytes() in the QVM environment maps to the getrandom()
    // syscall, which returns the block-hash-derived byte sequence.
    // ──────────────────────────────────────────────────────────────────────
    const randomBytes = crypto.randomBytes(32);
    const randomValue = parseInt(randomBytes.toString('hex').substring(0, 8), 16);

    // Determine result: 0 = heads, 1 = tails
    const result = randomValue % 2 === 0 ? "heads" : "tails";

    // Count winners
    const headsCount = parseInt(process.env["DB_ROUND_" + roundId + "_HEADS_COUNT"] || "0");
    const tailsCount = parseInt(process.env["DB_ROUND_" + roundId + "_TAILS_COUNT"] || "0");
    const winnerCount = result === "heads" ? headsCount : tailsCount;

    // Calculate prize per winner
    const pool = process.env["DB_ROUND_" + roundId + "_POOL"] || "0";
    const prizePerWinner = winnerCount > 0 ? (BigInt(pool) / BigInt(winnerCount)).toString() : "0";

    // Store result
    process.stdout.write("DBW=ROUND_" + roundId + "_STATUS=closed\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_RESULT=" + result + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_WINNER_COUNT=" + winnerCount + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_PRIZE_PER_WINNER=" + prizePerWinner + "\n");
    process.stdout.write("DBW=ROUND_" + roundId + "_RANDOM_HEX=" + randomBytes.toString('hex').substring(0, 16) + "\n");

    // Build winner list
    for (let i = 0; i < playerCount; i++) {
        const addr = process.env["DB_ROUND_" + roundId + "_PLAYER_" + i];
        if (addr) {
            const guess = process.env["DB_ROUND_" + roundId + "_PLAYER_" + addr + "_GUESS"];
            if (guess === result) {
                process.stdout.write("DBW=ROUND_" + roundId + "_WINNER_" + i + "=" + addr + "\n");

                // Update player stats
                const wins = parseInt(process.env["DB_PLAYER_" + addr + "_WINS"] || "0");
                const totalWon = process.env["DB_PLAYER_" + addr + "_TOTAL_WON"] || "0";
                process.stdout.write("DBW=PLAYER_" + addr + "_WINS=" + (wins + 1) + "\n");
                process.stdout.write("DBW=PLAYER_" + addr + "_TOTAL_WON=" + (BigInt(totalWon) + BigInt(prizePerWinner)).toString() + "\n");
            }
        }
    }

    // Update global stats
    const totalGames = parseInt(process.env.DB_TOTAL_GAMES_PLAYED || "0");
    const totalDistributed = process.env.DB_TOTAL_QANX_DISTRIBUTED || "0";
    process.stdout.write("DBW=TOTAL_GAMES_PLAYED=" + (totalGames + 1) + "\n");
    process.stdout.write("DBW=TOTAL_QANX_DISTRIBUTED=" + (BigInt(totalDistributed) + BigInt(pool)).toString() + "\n");

    // Event: GameFinished
    process.stdout.write("OUT=event: GameFinished\n");
    process.stdout.write("OUT=roundId: " + roundId + "\n");
    process.stdout.write("OUT=result: " + result + "\n");
    process.stdout.write("OUT=winnerCount: " + winnerCount + "\n");
    process.stdout.write("OUT=pool: " + pool + "\n");
    process.stdout.write("OUT=prizePerWinner: " + prizePerWinner + "\n");
    process.stdout.write("OUT=randomSource: QVM getrandom() syscall (block-hash derived)\n");
    process.stdout.write("OUT=randomHex: " + randomBytes.toString('hex').substring(0, 16) + "\n");

    process.exit(0);
}

// ─── claimPrize(playerAddress) ──────────────────────────────────────────────
// Distributes the prize to a specific winner. In the QVM context, the actual
// QANX transfer is handled by the transaction layer.
function claimPrize(playerAddress, roundIdStr) {
    const roundId = parseInt(roundIdStr || process.env.DB_ROUND_COUNTER || "0");
    const status = process.env["DB_ROUND_" + roundId + "_STATUS"];

    if (status !== "closed") {
        process.stderr.write("ERR=round is not closed yet\n");
        process.exit(1);
    }

    const result = process.env["DB_ROUND_" + roundId + "_RESULT"];
    const guess = process.env["DB_ROUND_" + roundId + "_PLAYER_" + playerAddress + "_GUESS"];

    if (!guess) {
        process.stderr.write("ERR=player did not participate in this round\n");
        process.exit(1);
    }

    if (guess !== result) {
        process.stderr.write("ERR=player did not win this round\n");
        process.exit(1);
    }

    const claimed = process.env["DB_ROUND_" + roundId + "_CLAIMED_" + playerAddress];
    if (claimed === "true") {
        process.stderr.write("ERR=prize already claimed\n");
        process.exit(1);
    }

    const prizePerWinner = process.env["DB_ROUND_" + roundId + "_PRIZE_PER_WINNER"] || "0";

    // Mark as claimed
    process.stdout.write("DBW=ROUND_" + roundId + "_CLAIMED_" + playerAddress + "=true\n");

    // Event: PrizeClaimed
    process.stdout.write("OUT=event: PrizeClaimed\n");
    process.stdout.write("OUT=roundId: " + roundId + "\n");
    process.stdout.write("OUT=player: " + playerAddress + "\n");
    process.stdout.write("OUT=amount: " + prizePerWinner + "\n");

    process.exit(0);
}

// ─── getStatus() ────────────────────────────────────────────────────────────
// Query the current state of the game.
function getStatus() {
    const roundId = parseInt(process.env.DB_ROUND_COUNTER || "0");
    const status = roundId > 0 ? (process.env["DB_ROUND_" + roundId + "_STATUS"] || "none") : "none";
    const playerCount = roundId > 0 ? (process.env["DB_ROUND_" + roundId + "_PLAYER_COUNT"] || "0") : "0";
    const pool = roundId > 0 ? (process.env["DB_ROUND_" + roundId + "_POOL"] || "0") : "0";
    const entryFee = roundId > 0 ? (process.env["DB_ROUND_" + roundId + "_ENTRY_FEE"] || MIN_ENTRY_FEE) : MIN_ENTRY_FEE;
    const totalGames = process.env.DB_TOTAL_GAMES_PLAYED || "0";

    process.stdout.write("OUT=roundId: " + roundId + "\n");
    process.stdout.write("OUT=status: " + status + "\n");
    process.stdout.write("OUT=playerCount: " + playerCount + "\n");
    process.stdout.write("OUT=pool: " + pool + "\n");
    process.stdout.write("OUT=entryFee: " + entryFee + "\n");
    process.stdout.write("OUT=totalGamesPlayed: " + totalGames + "\n");
    process.stdout.write("OUT=contractLanguage: JavaScript\n");
    process.stdout.write("OUT=qvmSyscalls: getrandom,time\n");

    if (status === "closed") {
        const result = process.env["DB_ROUND_" + roundId + "_RESULT"] || "unknown";
        const winnerCount = process.env["DB_ROUND_" + roundId + "_WINNER_COUNT"] || "0";
        const randomHex = process.env["DB_ROUND_" + roundId + "_RANDOM_HEX"] || "N/A";
        process.stdout.write("OUT=result: " + result + "\n");
        process.stdout.write("OUT=winnerCount: " + winnerCount + "\n");
        process.stdout.write("OUT=randomHex: " + randomHex + "\n");
    }

    process.exit(0);
}

// ─── Main Entry Point ───────────────────────────────────────────────────────
// The QVM invokes the binary with command-line arguments.
// First arg is the function name, subsequent args are parameters.
function main(args) {
    // Constructor call (on deploy)
    if (args && args.length === 1 && args[0] === "construct") {
        construct();
        return;
    }

    // All other calls require initialization
    initialize();

    if (!args || args.length < 1) {
        process.stderr.write("ERR=no command specified\n");
        process.exit(1);
    }

    const command = args[0];

    switch (command) {
        case "createRound":
            // createRound [entryFee]
            createRound(args[1] || null);
            break;

        case "joinGame":
            // joinGame <playerAddress> <guess>
            if (args.length < 3) {
                process.stderr.write("ERR=joinGame requires playerAddress and guess\n");
                process.exit(1);
            }
            joinGame(args[1], args[2]);
            break;

        case "closeRound":
            // closeRound
            closeRound();
            break;

        case "claimPrize":
            // claimPrize <playerAddress> [roundId]
            if (args.length < 2) {
                process.stderr.write("ERR=claimPrize requires playerAddress\n");
                process.exit(1);
            }
            claimPrize(args[1], args[2] || null);
            break;

        case "getStatus":
            // getStatus
            getStatus();
            break;

        default:
            process.stderr.write("ERR=unknown command: " + command + "\n");
            process.exit(1);
    }
}

// Entry: strip node binary path and script path from argv
main(process.argv.slice(2));
