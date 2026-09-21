// Where the postage contract lives, per chain.
//
// Addresses come from ethersphere/go-storage-incentives-abi, the package Bee
// itself builds against (read 2026-09-21). The Sepolia pair is the one S3
// transacted with, so it is verified by our own spike; the Gnosis pair is
// sourced but untouched — working rule 4 keeps us off mainnet without Peter.

export interface ChainConfig {
  name: string;
  chainId: number;
  /** The PostageStamp contract: `createBatch`, `topUp`, `batches`. */
  postageStamp: string;
  /** The BZZ token the contract is paid in. 16 decimals on both chains. */
  bzzToken: string;
  decimals: number;
  /** Seconds per block: postage is priced per chunk per block. */
  blockSeconds: number;
}

/** Gnosis Chain. Sourced from go-storage-incentives-abi; not exercised by us. */
export const gnosis: ChainConfig = {
  name: "gnosis",
  chainId: 100,
  postageStamp: "0x45a1502382541Cd610CC9068e88727426b696293",
  bzzToken: "0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da",
  decimals: 16,
  blockSeconds: 5,
};

/** Sepolia. These are the addresses S3 bought and topped up a batch with. */
export const sepolia: ChainConfig = {
  name: "sepolia",
  chainId: 11_155_111,
  postageStamp: "0xcdfdC3752caaA826fE62531E0000C40546eC56A6",
  bzzToken: "0x543dDb01Ba47acB11de34891cD86B675F04840db",
  decimals: 16,
  blockSeconds: 12,
};

/** A local cluster or a chain we do not ship: bring your own addresses. */
export const custom = (config: ChainConfig): ChainConfig => config;

export const byChainId = (chainId: number): ChainConfig | null =>
  chainId === gnosis.chainId ? gnosis : chainId === sepolia.chainId ? sepolia : null;
