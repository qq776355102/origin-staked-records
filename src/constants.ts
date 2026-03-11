
export const RPC_URL = "https://pol79729.allnodes.me:8545/fiBUP22lpmCFIeuv";

export const CONTRACTS = {
  BOND: [
    "0x183E15f6cA33434BCb1B01a03a3aa58A31E74436",
  ],
  STAKING_600: [
    "0x8cA97F41d2C81AF050656e8AD0Cf543820a24504",
  ],
};

export const DECIMALS = {
  LGNS: 9,
  DAI: 18,
};

export const TOKENS = {
  DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
  LGNS: "0xeb51d9a39ad5eef215dc0bf39a8821ff804a0f01",
};

// Event ABIs for parsing
export const EVENT_ABIS = [
  "event DepositToken(address indexed currency, address indexed user, uint256 amount)",
  "event Staked(address indexed user, uint256 amount)",
];

export const CATEGORIES = {
  BOND: "360债券",
  STAKING_600: "600天质押",
};
