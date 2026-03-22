import { useState, useCallback, useEffect } from "react";
import { QAN_TESTNET } from "@/lib/qan-config";

interface WalletState {
  address: string | null;
  balance: string | null;
  chainId: number | null;
  isConnected: boolean;
  isCorrectNetwork: boolean;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    balance: null,
    chainId: null,
    isConnected: false,
    isCorrectNetwork: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);

  const getBalance = useCallback(async (address: string) => {
    if (typeof window === "undefined" || !(window as any).ethereum) return null;
    try {
      const balance = await (window as any).ethereum.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });
      const balanceInQANX = parseInt(balance, 16) / 1e18;
      return balanceInQANX.toFixed(4);
    } catch {
      return null;
    }
  }, []);

  const checkConnection = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    try {
      const accounts = await (window as any).ethereum.request({ method: "eth_accounts" });
      const chainId = await (window as any).ethereum.request({ method: "eth_chainId" });
      const chainIdNum = parseInt(chainId, 16);
      if (accounts.length > 0) {
        const balance = await getBalance(accounts[0]);
        setWallet({
          address: accounts[0],
          balance,
          chainId: chainIdNum,
          isConnected: true,
          isCorrectNetwork: chainIdNum === QAN_TESTNET.chainId,
        });
      }
    } catch {}
  }, [getBalance]);

  useEffect(() => {
    checkConnection();
    if (typeof window !== "undefined" && (window as any).ethereum) {
      (window as any).ethereum.on("accountsChanged", checkConnection);
      (window as any).ethereum.on("chainChanged", checkConnection);
      return () => {
        (window as any).ethereum.removeListener("accountsChanged", checkConnection);
        (window as any).ethereum.removeListener("chainChanged", checkConnection);
      };
    }
  }, [checkConnection]);

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      const chainId = await (window as any).ethereum.request({ method: "eth_chainId" });
      const chainIdNum = parseInt(chainId, 16);
      const balance = await getBalance(accounts[0]);
      setWallet({
        address: accounts[0],
        balance,
        chainId: chainIdNum,
        isConnected: true,
        isCorrectNetwork: chainIdNum === QAN_TESTNET.chainId,
      });
    } catch (err) {
      console.error("Connection failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, [getBalance]);

  const switchNetwork = useCallback(async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: QAN_TESTNET.chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: QAN_TESTNET.chainIdHex,
            chainName: QAN_TESTNET.networkName,
            nativeCurrency: {
              name: "QANX",
              symbol: QAN_TESTNET.currencySymbol,
              decimals: 18,
            },
            rpcUrls: [QAN_TESTNET.rpcUrl],
            blockExplorerUrls: [QAN_TESTNET.blockExplorerUrl],
          }],
        });
      }
    }
    await checkConnection();
  }, [checkConnection]);

  const disconnect = useCallback(() => {
    setWallet({
      address: null,
      balance: null,
      chainId: null,
      isConnected: false,
      isCorrectNetwork: false,
    });
  }, []);

  return {
    ...wallet,
    isConnecting,
    connect,
    disconnect,
    switchNetwork,
    refreshBalance: () => wallet.address && getBalance(wallet.address).then(b => setWallet(prev => ({ ...prev, balance: b }))),
  };
}
