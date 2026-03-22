// QAN TestNet Configuration
// Based on: https://docs.qanplatform.com/testnet/setup/wallet/metamask

export const QAN_TESTNET = {
  chainId: 1121,
  chainIdHex: "0x461",
  networkName: "QAN TestNet",
  rpcUrl: "https://rpc-testnet.qanplatform.com",
  currencySymbol: "QANX",
  blockExplorerUrl: "https://testnet.qanscan.com",
  faucetUrl: "https://faucet.qanplatform.com",
};

// Contract addresses
export const CONTRACTS = {
  js: {
    address: "0xC6DFb83410bAA0703447F019cC353441909579aE",
    language: "JavaScript",
    label: "CoinFlip-JS",
    description: "QVM JavaScript Smart Contract",
    syscalls: ["getrandom()", "time()"],
    compileCmd: "docker run --rm -v $(pwd):/ws qanplatform/qvm-compiler-js",
    storageRead: "process.env.DB_<KEY>",
    storageWrite: 'process.stdout.write("DBW=<KEY>=<VALUE>\\n")',
    randomImpl: "crypto.randomBytes(32) → QVM getrandom() syscall → block-hash derived bytes",
  },
  go: {
    address: "0x57e481642255925489c6da94CAD6CdfBFdde85b0",
    language: "Go (Golang)",
    label: "CoinFlip-Go",
    description: "QVM Golang Smart Contract",
    syscalls: ["getrandom()", "time()"],
    compileCmd: "docker run --rm -v $(pwd):/ws qanplatform/qvm-compiler-go",
    storageRead: 'os.Getenv("DB_<KEY>")',
    storageWrite: 'os.Stdout.WriteString(fmt.Sprintf("DBW=<KEY>=%s\\n", value))',
    randomImpl: "crypto/rand.Read(buf) → QVM getrandom() syscall → block-hash derived bytes",
  },
};

export type ContractType = keyof typeof CONTRACTS;
