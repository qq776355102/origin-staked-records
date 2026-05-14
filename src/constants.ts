
export const RPC_URL = "https://rpc.anubispace.org";

export const CONTRACTS = {
  BOND: [
    // "0x183E15f6cA33434BCb1B01a03a3aa58A31E74436",
  ],
  STAKING_600: [
    // "0x8cA97F41d2C81AF050656e8AD0Cf543820a24504",
  ],
  STAKING_360_LONG: [
    "0x5584CDeb1369673C91C6aD7EBea0cE7cB630ce60",
  ],
};

export const DECIMALS = {
  LGNS: 9,
  DAI: 18,
};

export const TOKENS = {
  DAI: "0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14",
  LGNS: "0x4D1D808a081FdAc440703b3765FC61f8028C06B8",
};

// Event ABIs for parsing
export const EVENT_ABIS = [
  "event DepositToken(address indexed currency, address indexed user, uint256 amount)",
  "event Staked(address indexed user, uint256 amount)",
  "event Staked(address indexed user, uint256 amount, uint8 duration)",
  "event Staked(address indexed user, uint256 stakeIndex, uint256 shares, uint256 amount, uint256 stakePeriodSeconds)",
];

export const CATEGORIES = {
  BOND: "360债券",
  STAKING_600: "600天质押",
  STAKING_360_LONG: "360长期质押",
};
