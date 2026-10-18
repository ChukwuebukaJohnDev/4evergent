export interface PolicyRules {
  maxTxAmount: Record<string, string>;
  dailySpendingLimit: Record<string, string>;
  allowedAssets: string[];
  allowedDestinations: string[];
  allowedContractIds: string[];
  txTypeRestrictions: Record<string, boolean>;
  approvalThreshold: string;
  requireHumanApprovalForAmountAbove: string;
}

export const DEFAULT_RULES: PolicyRules = {
  maxTxAmount: { XLM: "100" },
  dailySpendingLimit: { XLM: "500" },
  allowedAssets: ["XLM"],
  allowedDestinations: [],
  allowedContractIds: [],
  txTypeRestrictions: {
    payment: true,
    trustline: true,
    contract_call: false,
    account_settings: false,
  },
  approvalThreshold: "50",
  requireHumanApprovalForAmountAbove: "50",
};
