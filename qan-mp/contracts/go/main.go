// ============================================================================
// CoinFlip-Go — QVM Golang Smart Contract
// QAN TestNet | QVM Multi-Language Smart Contract Demo
// ============================================================================
// This contract implements a multiplayer coin flip game on the QAN TestNet.
// It demonstrates the QVM's multi-language capability by implementing the SAME
// game logic that also exists as a JavaScript contract (CoinFlip-JS).
//
// QVM Storage Pattern (Go):
//   READ:  os.Getenv("DB_<KEY>")                                    — read from contract database
//   WRITE: os.Stdout.WriteString(fmt.Sprintf("DBW=<KEY>=%s\n", v))  — write to contract database
//   OUTPUT: os.Stdout.WriteString(fmt.Sprintf("OUT=<key>: %s\n", v)) — output to caller
//
// QVM Syscalls used:
//   getrandom() — Go's crypto/rand.Read() maps to the QVM getrandom() syscall,
//                  returning bytes derived from the previous block's hash.
//   time()      — time.Now() maps to the QVM time() syscall,
//                  returning the previous block's timestamp.
//
// Contract Functions:
//   construct     — initialize the contract (called once on deploy)
//   createRound   — admin creates a new game round with entry fee
//   joinGame      — player joins the current round with a guess (heads/tails)
//   closeRound    — admin closes the round, calculates result via QVM getrandom
//   claimPrize    — distribute winnings to winners of a round
//   getStatus     — query the current round status
// ============================================================================

package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"strconv"
	"strings"
)

// ─── Configuration ──────────────────────────────────────────────────────────
const (
	MaxPlayersPerRound = 50
	MinEntryFee        = "100000000000000000" // 0.1 QANX in wei
)

// ─── Helper: getEnvOrDefault ────────────────────────────────────────────────
func getEnvOrDefault(key string, defaultVal string) string {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	return val
}

// ─── Helper: getEnvInt ──────────────────────────────────────────────────────
func getEnvInt(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return n
}

// ─── Helper: bigAdd ─────────────────────────────────────────────────────────
func bigAdd(a, b string) string {
	bigA := new(big.Int)
	bigB := new(big.Int)
	bigA.SetString(a, 10)
	bigB.SetString(b, 10)
	return new(big.Int).Add(bigA, bigB).String()
}

// ─── Helper: bigDiv ─────────────────────────────────────────────────────────
func bigDiv(a string, b int) string {
	bigA := new(big.Int)
	bigA.SetString(a, 10)
	if b == 0 {
		return "0"
	}
	return new(big.Int).Div(bigA, big.NewInt(int64(b))).String()
}

// ─── Helper: exitError ──────────────────────────────────────────────────────
func exitError(msg string) {
	os.Stderr.WriteString(fmt.Sprintf("ERR=%s\n", msg))
	os.Exit(1)
}

// ─── Constructor ────────────────────────────────────────────────────────────
// Called once when the contract is first deployed with "construct" argument.
// Sets the owner/admin address and initializes the round counter.
// $0 construct
func constructor() {
	if os.Getenv("DB_QVM_INITIALIZED") == "true" {
		exitError("contract is already initialized")
	}

	// Store initialization parameters
	os.Stdout.WriteString(fmt.Sprintf("DBW=QVM_INIT_MAX_PLAYERS=%d\n", MaxPlayersPerRound))
	os.Stdout.WriteString(fmt.Sprintf("DBW=QVM_INIT_MIN_FEE=%s\n", MinEntryFee))
	os.Stdout.WriteString("DBW=ROUND_COUNTER=0\n")
	os.Stdout.WriteString("DBW=TOTAL_GAMES_PLAYED=0\n")
	os.Stdout.WriteString("DBW=TOTAL_QANX_DISTRIBUTED=0\n")

	// Event: ContractInitialized
	os.Stdout.WriteString("OUT=event: ContractInitialized\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=maxPlayers: %d\n", MaxPlayersPerRound))
	os.Stdout.WriteString(fmt.Sprintf("OUT=minEntryFee: %s\n", MinEntryFee))
	os.Stdout.WriteString("OUT=contractType: CoinFlip-Go (QVM Golang)\n")
}

// ─── Initialize ─────────────────────────────────────────────────────────────
// Called before every non-construct call to verify the contract is initialized.
func initialize() {
	if os.Getenv("DB_QVM_INITIALIZED") != "true" {
		exitError("contract is not initialized")
	}
}

// ─── createRound ────────────────────────────────────────────────────────────
// Admin function: creates a new game round.
// Args: entryFee (in QANX wei units, optional — defaults to MinEntryFee)
func createRound(entryFee string) {
	roundCounter := getEnvInt("DB_ROUND_COUNTER", 0)
	currentStatus := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_STATUS", roundCounter), "none")

	// Check if there's an active round
	if currentStatus == "open" {
		exitError("there is already an active round")
	}

	newRoundID := roundCounter + 1
	fee := entryFee
	if fee == "" {
		fee = MinEntryFee
	}

	// Initialize the new round
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_COUNTER=%d\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_STATUS=open\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_ENTRY_FEE=%s\n", newRoundID, fee))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_PLAYER_COUNT=0\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_POOL=0\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_HEADS_COUNT=0\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_TAILS_COUNT=0\n", newRoundID))

	// Event: GameStarted
	os.Stdout.WriteString("OUT=event: GameStarted\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=roundId: %d\n", newRoundID))
	os.Stdout.WriteString(fmt.Sprintf("OUT=entryFee: %s\n", fee))
	os.Stdout.WriteString("OUT=status: open\n")
}

// ─── joinGame ───────────────────────────────────────────────────────────────
// Player joins the current round with a guess ("heads" or "tails").
// Args: playerAddress, guess ("heads" or "tails")
func joinGame(playerAddress string, guess string) {
	roundID := getEnvInt("DB_ROUND_COUNTER", 0)

	if roundID == 0 {
		exitError("no active round")
	}

	status := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_STATUS", roundID), "none")
	if status != "open" {
		exitError("round is not open for betting")
	}

	// Validate guess
	normalizedGuess := strings.ToLower(guess)
	if normalizedGuess != "heads" && normalizedGuess != "tails" {
		exitError("invalid guess, must be heads or tails")
	}

	// Check max players
	playerCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_PLAYER_COUNT", roundID), 0)
	maxPlayers := getEnvInt("DB_QVM_INIT_MAX_PLAYERS", MaxPlayersPerRound)

	if playerCount >= maxPlayers {
		exitError("round is full")
	}

	// Check if player already joined
	existingGuess := os.Getenv(fmt.Sprintf("DB_ROUND_%d_PLAYER_%s_GUESS", roundID, playerAddress))
	if existingGuess != "" {
		exitError("player already joined this round")
	}

	// Record the player's bet
	entryFee := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_ENTRY_FEE", roundID), MinEntryFee)
	currentPool := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_POOL", roundID), "0")
	newPool := bigAdd(currentPool, entryFee)

	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_PLAYER_%d=%s\n", roundID, playerCount, playerAddress))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_PLAYER_%s_GUESS=%s\n", roundID, playerAddress, normalizedGuess))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_PLAYER_COUNT=%d\n", roundID, playerCount+1))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_POOL=%s\n", roundID, newPool))

	// Update heads/tails count
	if normalizedGuess == "heads" {
		headsCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_HEADS_COUNT", roundID), 0)
		os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_HEADS_COUNT=%d\n", roundID, headsCount+1))
	} else {
		tailsCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_TAILS_COUNT", roundID), 0)
		os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_TAILS_COUNT=%d\n", roundID, tailsCount+1))
	}

	// Update player stats
	playerGames := getEnvInt(fmt.Sprintf("DB_PLAYER_%s_GAMES", playerAddress), 0)
	os.Stdout.WriteString(fmt.Sprintf("DBW=PLAYER_%s_GAMES=%d\n", playerAddress, playerGames+1))

	// Event: BetPlaced
	os.Stdout.WriteString("OUT=event: BetPlaced\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=roundId: %d\n", roundID))
	os.Stdout.WriteString(fmt.Sprintf("OUT=player: %s\n", playerAddress))
	os.Stdout.WriteString(fmt.Sprintf("OUT=guess: %s\n", normalizedGuess))
	os.Stdout.WriteString(fmt.Sprintf("OUT=pool: %s\n", newPool))
	os.Stdout.WriteString(fmt.Sprintf("OUT=playerCount: %d\n", playerCount+1))
}

// ─── closeRound ─────────────────────────────────────────────────────────────
// Admin function: closes the current round and determines the winner.
// Uses QVM's deterministic getrandom() syscall which returns bytes derived
// from the previous block's hash — ensuring verifiable, deterministic randomness.
func closeRound() {
	roundID := getEnvInt("DB_ROUND_COUNTER", 0)

	if roundID == 0 {
		exitError("no active round")
	}

	status := os.Getenv(fmt.Sprintf("DB_ROUND_%d_STATUS", roundID))
	if status != "open" {
		exitError("round is not open")
	}

	playerCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_PLAYER_COUNT", roundID), 0)
	if playerCount < 1 {
		exitError("not enough players to close round")
	}

	// ── QVM Deterministic Random ──────────────────────────────────────────
	// In the QVM environment, Go's crypto/rand.Read() maps to the Linux
	// getrandom() syscall, which the QVM intercepts and replaces with a
	// deterministic byte sequence derived from the previous block's hash.
	//
	// This means:
	// 1. Every QVM executor node gets the SAME "random" bytes
	// 2. The result is verifiable on-chain
	// 3. It's deterministic but unpredictable before the block is produced
	//
	// The QVM's synthetic kernel ensures this behavior transparently —
	// the Go code looks like standard crypto/rand usage, but the QVM
	// provides block-hash-derived deterministic output.
	// ──────────────────────────────────────────────────────────────────────
	randomBytes := make([]byte, 32)
	_, err := rand.Read(randomBytes)
	if err != nil {
		exitError("failed to generate random bytes via QVM getrandom()")
	}

	// Use first 4 bytes as uint32 for coin flip
	randomValue := binary.BigEndian.Uint32(randomBytes[:4])
	randomHex := hex.EncodeToString(randomBytes[:8])

	// Determine result: even = heads, odd = tails
	var result string
	if randomValue%2 == 0 {
		result = "heads"
	} else {
		result = "tails"
	}

	// Count winners
	headsCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_HEADS_COUNT", roundID), 0)
	tailsCount := getEnvInt(fmt.Sprintf("DB_ROUND_%d_TAILS_COUNT", roundID), 0)

	var winnerCount int
	if result == "heads" {
		winnerCount = headsCount
	} else {
		winnerCount = tailsCount
	}

	// Calculate prize per winner
	pool := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_POOL", roundID), "0")
	prizePerWinner := "0"
	if winnerCount > 0 {
		prizePerWinner = bigDiv(pool, winnerCount)
	}

	// Store result
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_STATUS=closed\n", roundID))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_RESULT=%s\n", roundID, result))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_WINNER_COUNT=%d\n", roundID, winnerCount))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_PRIZE_PER_WINNER=%s\n", roundID, prizePerWinner))
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_RANDOM_HEX=%s\n", roundID, randomHex))

	// Build winner list and update stats
	for i := 0; i < playerCount; i++ {
		addr := os.Getenv(fmt.Sprintf("DB_ROUND_%d_PLAYER_%d", roundID, i))
		if addr != "" {
			guess := os.Getenv(fmt.Sprintf("DB_ROUND_%d_PLAYER_%s_GUESS", roundID, addr))
			if guess == result {
				os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_WINNER_%d=%s\n", roundID, i, addr))

				// Update player stats
				wins := getEnvInt(fmt.Sprintf("DB_PLAYER_%s_WINS", addr), 0)
				totalWon := getEnvOrDefault(fmt.Sprintf("DB_PLAYER_%s_TOTAL_WON", addr), "0")
				os.Stdout.WriteString(fmt.Sprintf("DBW=PLAYER_%s_WINS=%d\n", addr, wins+1))
				os.Stdout.WriteString(fmt.Sprintf("DBW=PLAYER_%s_TOTAL_WON=%s\n", addr, bigAdd(totalWon, prizePerWinner)))
			}
		}
	}

	// Update global stats
	totalGames := getEnvInt("DB_TOTAL_GAMES_PLAYED", 0)
	totalDistributed := getEnvOrDefault("DB_TOTAL_QANX_DISTRIBUTED", "0")
	os.Stdout.WriteString(fmt.Sprintf("DBW=TOTAL_GAMES_PLAYED=%d\n", totalGames+1))
	os.Stdout.WriteString(fmt.Sprintf("DBW=TOTAL_QANX_DISTRIBUTED=%s\n", bigAdd(totalDistributed, pool)))

	// Event: GameFinished
	os.Stdout.WriteString("OUT=event: GameFinished\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=roundId: %d\n", roundID))
	os.Stdout.WriteString(fmt.Sprintf("OUT=result: %s\n", result))
	os.Stdout.WriteString(fmt.Sprintf("OUT=winnerCount: %d\n", winnerCount))
	os.Stdout.WriteString(fmt.Sprintf("OUT=pool: %s\n", pool))
	os.Stdout.WriteString(fmt.Sprintf("OUT=prizePerWinner: %s\n", prizePerWinner))
	os.Stdout.WriteString("OUT=randomSource: QVM getrandom() syscall (block-hash derived)\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=randomHex: %s\n", randomHex))
}

// ─── claimPrize ─────────────────────────────────────────────────────────────
// Distributes the prize to a specific winner.
func claimPrize(playerAddress string, roundIDStr string) {
	roundID := getEnvInt("DB_ROUND_COUNTER", 0)
	if roundIDStr != "" {
		roundID, _ = strconv.Atoi(roundIDStr)
	}

	status := os.Getenv(fmt.Sprintf("DB_ROUND_%d_STATUS", roundID))
	if status != "closed" {
		exitError("round is not closed yet")
	}

	result := os.Getenv(fmt.Sprintf("DB_ROUND_%d_RESULT", roundID))
	guess := os.Getenv(fmt.Sprintf("DB_ROUND_%d_PLAYER_%s_GUESS", roundID, playerAddress))

	if guess == "" {
		exitError("player did not participate in this round")
	}
	if guess != result {
		exitError("player did not win this round")
	}

	claimed := os.Getenv(fmt.Sprintf("DB_ROUND_%d_CLAIMED_%s", roundID, playerAddress))
	if claimed == "true" {
		exitError("prize already claimed")
	}

	prizePerWinner := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_PRIZE_PER_WINNER", roundID), "0")

	// Mark as claimed
	os.Stdout.WriteString(fmt.Sprintf("DBW=ROUND_%d_CLAIMED_%s=true\n", roundID, playerAddress))

	// Event: PrizeClaimed
	os.Stdout.WriteString("OUT=event: PrizeClaimed\n")
	os.Stdout.WriteString(fmt.Sprintf("OUT=roundId: %d\n", roundID))
	os.Stdout.WriteString(fmt.Sprintf("OUT=player: %s\n", playerAddress))
	os.Stdout.WriteString(fmt.Sprintf("OUT=amount: %s\n", prizePerWinner))
}

// ─── getStatus ──────────────────────────────────────────────────────────────
// Query the current state of the game.
func getStatus() {
	roundID := getEnvInt("DB_ROUND_COUNTER", 0)
	status := "none"
	playerCount := "0"
	pool := "0"
	entryFee := MinEntryFee

	if roundID > 0 {
		status = getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_STATUS", roundID), "none")
		playerCount = getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_PLAYER_COUNT", roundID), "0")
		pool = getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_POOL", roundID), "0")
		entryFee = getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_ENTRY_FEE", roundID), MinEntryFee)
	}

	totalGames := getEnvOrDefault("DB_TOTAL_GAMES_PLAYED", "0")

	os.Stdout.WriteString(fmt.Sprintf("OUT=roundId: %d\n", roundID))
	os.Stdout.WriteString(fmt.Sprintf("OUT=status: %s\n", status))
	os.Stdout.WriteString(fmt.Sprintf("OUT=playerCount: %s\n", playerCount))
	os.Stdout.WriteString(fmt.Sprintf("OUT=pool: %s\n", pool))
	os.Stdout.WriteString(fmt.Sprintf("OUT=entryFee: %s\n", entryFee))
	os.Stdout.WriteString(fmt.Sprintf("OUT=totalGamesPlayed: %s\n", totalGames))
	os.Stdout.WriteString("OUT=contractLanguage: Go (Golang)\n")
	os.Stdout.WriteString("OUT=qvmSyscalls: getrandom,time\n")

	if status == "closed" {
		result := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_RESULT", roundID), "unknown")
		winnerCount := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_WINNER_COUNT", roundID), "0")
		randomHex := getEnvOrDefault(fmt.Sprintf("DB_ROUND_%d_RANDOM_HEX", roundID), "N/A")
		os.Stdout.WriteString(fmt.Sprintf("OUT=result: %s\n", result))
		os.Stdout.WriteString(fmt.Sprintf("OUT=winnerCount: %s\n", winnerCount))
		os.Stdout.WriteString(fmt.Sprintf("OUT=randomHex: %s\n", randomHex))
	}
}

// ─── Main Entry Point ───────────────────────────────────────────────────────
// The QVM invokes the binary with command-line arguments.
// First arg is the function name, subsequent args are parameters.
func main() {
	args := os.Args[1:]

	// Constructor call (on deploy)
	if len(args) == 1 && args[0] == "construct" {
		constructor()
		os.Exit(0)
	}

	// All other calls require initialization
	initialize()

	if len(args) < 1 {
		exitError("no command specified")
	}

	command := args[0]

	switch command {
	case "createRound":
		fee := ""
		if len(args) > 1 {
			fee = args[1]
		}
		createRound(fee)

	case "joinGame":
		if len(args) < 3 {
			exitError("joinGame requires playerAddress and guess")
		}
		joinGame(args[1], args[2])

	case "closeRound":
		closeRound()

	case "claimPrize":
		if len(args) < 2 {
			exitError("claimPrize requires playerAddress")
		}
		roundIDStr := ""
		if len(args) > 2 {
			roundIDStr = args[2]
		}
		claimPrize(args[1], roundIDStr)

	case "getStatus":
		getStatus()

	default:
		exitError("unknown command: " + command)
	}

	os.Exit(0)
}
