// Exact-in schemas pinned from the deployed Jupiter program on 2026-10-07.
// Source and original-IDL hash: NOTICE.md. Snake-case field names adapted for the coder.
export const jupiterIdl = {
  "address": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "metadata": {
    "name": "jupiter",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Jupiter aggregator program"
  },
  "instructions": [
    {
      "name": "route",
      "discriminator": [
        229,
        23,
        203,
        151,
        122,
        227,
        173,
        42
      ],
      "accounts": [
        {
          "name": "tokenProgram"
        },
        {
          "name": "userTransferAuthority",
          "signer": true
        },
        {
          "name": "userSourceTokenAccount",
          "writable": true
        },
        {
          "name": "userDestinationTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "destinationMint"
        },
        {
          "name": "platformFeeAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "eventAuthority",
          "address": "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "routePlan",
          "type": {
            "vec": {
              "defined": {
                "name": "RoutePlanStep"
              }
            }
          }
        },
        {
          "name": "inAmount",
          "type": "u64"
        },
        {
          "name": "quotedOutAmount",
          "type": "u64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "platformFeeBps",
          "type": "u8"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "sharedAccountsRoute",
      "discriminator": [
        193,
        32,
        155,
        51,
        65,
        214,
        156,
        129
      ],
      "accounts": [
        {
          "name": "tokenProgram"
        },
        {
          "name": "programAuthority"
        },
        {
          "name": "userTransferAuthority",
          "signer": true
        },
        {
          "name": "sourceTokenAccount",
          "writable": true
        },
        {
          "name": "programSourceTokenAccount",
          "writable": true
        },
        {
          "name": "programDestinationTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "sourceMint"
        },
        {
          "name": "destinationMint"
        },
        {
          "name": "platformFeeAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "token2022Program",
          "optional": true
        },
        {
          "name": "eventAuthority",
          "address": "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        },
        {
          "name": "routePlan",
          "type": {
            "vec": {
              "defined": {
                "name": "RoutePlanStep"
              }
            }
          }
        },
        {
          "name": "inAmount",
          "type": "u64"
        },
        {
          "name": "quotedOutAmount",
          "type": "u64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "platformFeeBps",
          "type": "u8"
        }
      ],
      "returns": "u64"
    },
    {
      "name": "routeV2",
      "discriminator": [
        187,
        100,
        250,
        204,
        49,
        196,
        175,
        20
      ],
      "accounts": [
        {
          "name": "userTransferAuthority",
          "signer": true
        },
        {
          "name": "userSourceTokenAccount",
          "writable": true
        },
        {
          "name": "userDestinationTokenAccount",
          "writable": true
        },
        {
          "name": "sourceMint"
        },
        {
          "name": "destinationMint"
        },
        {
          "name": "sourceTokenProgram"
        },
        {
          "name": "destinationTokenProgram"
        },
        {
          "name": "destinationTokenAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "eventAuthority",
          "address": "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "inAmount",
          "type": "u64"
        },
        {
          "name": "quotedOutAmount",
          "type": "u64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "platformFeeBps",
          "type": "u16"
        },
        {
          "name": "positiveSlippageBps",
          "type": "u16"
        },
        {
          "name": "routePlan",
          "type": {
            "vec": {
              "defined": {
                "name": "RoutePlanStepV2"
              }
            }
          }
        }
      ],
      "returns": "u64"
    },
    {
      "name": "sharedAccountsRouteV2",
      "discriminator": [
        209,
        152,
        83,
        147,
        124,
        254,
        216,
        233
      ],
      "accounts": [
        {
          "name": "programAuthority"
        },
        {
          "name": "userTransferAuthority",
          "signer": true
        },
        {
          "name": "sourceTokenAccount",
          "writable": true
        },
        {
          "name": "programSourceTokenAccount",
          "writable": true
        },
        {
          "name": "programDestinationTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "sourceMint"
        },
        {
          "name": "destinationMint"
        },
        {
          "name": "sourceTokenProgram"
        },
        {
          "name": "destinationTokenProgram"
        },
        {
          "name": "eventAuthority",
          "address": "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u8"
        },
        {
          "name": "inAmount",
          "type": "u64"
        },
        {
          "name": "quotedOutAmount",
          "type": "u64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        },
        {
          "name": "platformFeeBps",
          "type": "u16"
        },
        {
          "name": "positiveSlippageBps",
          "type": "u16"
        },
        {
          "name": "routePlan",
          "type": {
            "vec": {
              "defined": {
                "name": "RoutePlanStepV2"
              }
            }
          }
        }
      ],
      "returns": "u64"
    }
  ],
  "types": [
    {
      "name": "FeeEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RemainingAccountsInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "slices",
            "type": {
              "vec": {
                "defined": {
                  "name": "RemainingAccountsSlice"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "RemainingAccountsSlice",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "accountsType",
            "type": "u8"
          },
          {
            "name": "length",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "AccountsType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "TransferHookA"
          },
          {
            "name": "TransferHookB"
          },
          {
            "name": "TransferHookReward"
          },
          {
            "name": "TransferHookInput"
          },
          {
            "name": "TransferHookIntermediate"
          },
          {
            "name": "TransferHookOutput"
          },
          {
            "name": "SupplementalTickArrays"
          },
          {
            "name": "SupplementalTickArraysOne"
          },
          {
            "name": "SupplementalTickArraysTwo"
          }
        ]
      }
    },
    {
      "name": "DefiTunaAccountsType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "TransferHookA"
          },
          {
            "name": "TransferHookB"
          },
          {
            "name": "TransferHookInput"
          },
          {
            "name": "TransferHookIntermediate"
          },
          {
            "name": "TransferHookOutput"
          },
          {
            "name": "SupplementalTickArrays"
          },
          {
            "name": "SupplementalTickArraysOne"
          },
          {
            "name": "SupplementalTickArraysTwo"
          }
        ]
      }
    },
    {
      "name": "RoutePlanStep",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "swap",
            "type": {
              "defined": {
                "name": "Swap"
              }
            }
          },
          {
            "name": "percent",
            "type": "u8"
          },
          {
            "name": "inputIndex",
            "type": "u8"
          },
          {
            "name": "outputIndex",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "RoutePlanStepV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "swap",
            "type": {
              "defined": {
                "name": "Swap"
              }
            }
          },
          {
            "name": "bps",
            "type": "u16"
          },
          {
            "name": "inputIndex",
            "type": "u8"
          },
          {
            "name": "outputIndex",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Bid"
          },
          {
            "name": "Ask"
          }
        ]
      }
    },
    {
      "name": "BisonFiPredictSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Yes"
          },
          {
            "name": "No"
          }
        ]
      }
    },
    {
      "name": "Swap",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Saber"
          },
          {
            "name": "SaberAddDecimalsDeposit"
          },
          {
            "name": "SaberAddDecimalsWithdraw"
          },
          {
            "name": "TokenSwap"
          },
          {
            "name": "Sencha"
          },
          {
            "name": "Step"
          },
          {
            "name": "Cropper"
          },
          {
            "name": "Raydium"
          },
          {
            "name": "Crema",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Lifinity"
          },
          {
            "name": "Mercurial"
          },
          {
            "name": "Cykura"
          },
          {
            "name": "Serum",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "MarinadeDeposit"
          },
          {
            "name": "MarinadeUnstake"
          },
          {
            "name": "Aldrin",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "AldrinV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "Whirlpool",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Invariant",
            "fields": [
              {
                "name": "xToY",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Meteora"
          },
          {
            "name": "GooseFX"
          },
          {
            "name": "DeltaFi",
            "fields": [
              {
                "name": "stable",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Balansol"
          },
          {
            "name": "MarcoPolo",
            "fields": [
              {
                "name": "xToY",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Dradex",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "LifinityV2"
          },
          {
            "name": "RaydiumClmm"
          },
          {
            "name": "Openbook",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "Phoenix",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "Symmetry",
            "fields": [
              {
                "name": "fromTokenId",
                "type": "u64"
              },
              {
                "name": "toTokenId",
                "type": "u64"
              }
            ]
          },
          {
            "name": "TokenSwapV2"
          },
          {
            "name": "HeliumTreasuryManagementRedeemV0"
          },
          {
            "name": "StakeDexStakeWrappedSol"
          },
          {
            "name": "StakeDexSwapViaStake",
            "fields": [
              {
                "name": "bridgeStakeSeed",
                "type": "u32"
              }
            ]
          },
          {
            "name": "GooseFXV2"
          },
          {
            "name": "Perps"
          },
          {
            "name": "PerpsAddLiquidity"
          },
          {
            "name": "PerpsRemoveLiquidity"
          },
          {
            "name": "MeteoraDlmm"
          },
          {
            "name": "OpenBookV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "RaydiumClmmV2"
          },
          {
            "name": "StakeDexPrefundWithdrawStakeAndDepositStake",
            "fields": [
              {
                "name": "bridgeStakeSeed",
                "type": "u32"
              }
            ]
          },
          {
            "name": "Clone",
            "fields": [
              {
                "name": "poolIndex",
                "type": "u8"
              },
              {
                "name": "quantityIsInput",
                "type": "bool"
              },
              {
                "name": "quantityIsCollateral",
                "type": "bool"
              }
            ]
          },
          {
            "name": "SanctumS",
            "fields": [
              {
                "name": "srcLstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "dstLstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "srcLstIndex",
                "type": "u32"
              },
              {
                "name": "dstLstIndex",
                "type": "u32"
              }
            ]
          },
          {
            "name": "SanctumSAddLiquidity",
            "fields": [
              {
                "name": "lstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "lstIndex",
                "type": "u32"
              }
            ]
          },
          {
            "name": "SanctumSRemoveLiquidity",
            "fields": [
              {
                "name": "lstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "lstIndex",
                "type": "u32"
              }
            ]
          },
          {
            "name": "RaydiumCP"
          },
          {
            "name": "WhirlpoolSwapV2",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              },
              {
                "name": "remainingAccountsInfo",
                "type": {
                  "option": {
                    "defined": {
                      "name": "RemainingAccountsInfo"
                    }
                  }
                }
              }
            ]
          },
          {
            "name": "OneIntro"
          },
          {
            "name": "PumpWrappedBuy"
          },
          {
            "name": "PumpWrappedSell"
          },
          {
            "name": "PerpsV2"
          },
          {
            "name": "PerpsV2AddLiquidity"
          },
          {
            "name": "PerpsV2RemoveLiquidity"
          },
          {
            "name": "MoonshotWrappedBuy"
          },
          {
            "name": "MoonshotWrappedSell"
          },
          {
            "name": "StabbleStableSwap"
          },
          {
            "name": "StabbleWeightedSwap"
          },
          {
            "name": "Obric",
            "fields": [
              {
                "name": "xToY",
                "type": "bool"
              }
            ]
          },
          {
            "name": "FoxBuyFromEstimatedCost"
          },
          {
            "name": "FoxClaimPartial",
            "fields": [
              {
                "name": "isY",
                "type": "bool"
              }
            ]
          },
          {
            "name": "SolFi",
            "fields": [
              {
                "name": "isQuoteToBase",
                "type": "bool"
              }
            ]
          },
          {
            "name": "SolayerDelegateNoInit"
          },
          {
            "name": "SolayerUndelegateNoInit"
          },
          {
            "name": "TokenMill",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "DaosFunBuy"
          },
          {
            "name": "DaosFunSell"
          },
          {
            "name": "ZeroFi"
          },
          {
            "name": "StakeDexWithdrawWrappedSol"
          },
          {
            "name": "VirtualsBuy"
          },
          {
            "name": "VirtualsSell"
          },
          {
            "name": "Perena",
            "fields": [
              {
                "name": "inIndex",
                "type": "u8"
              },
              {
                "name": "outIndex",
                "type": "u8"
              }
            ]
          },
          {
            "name": "PumpSwapBuy"
          },
          {
            "name": "PumpSwapSell"
          },
          {
            "name": "Gamma"
          },
          {
            "name": "MeteoraDlmmSwapV2",
            "fields": [
              {
                "name": "remainingAccountsInfo",
                "type": {
                  "defined": {
                    "name": "RemainingAccountsInfo"
                  }
                }
              }
            ]
          },
          {
            "name": "Woofi"
          },
          {
            "name": "MeteoraDammV2"
          },
          {
            "name": "MeteoraDynamicBondingCurveSwap"
          },
          {
            "name": "StabbleStableSwapV2"
          },
          {
            "name": "StabbleWeightedSwapV2"
          },
          {
            "name": "RaydiumLaunchlabBuy",
            "fields": [
              {
                "name": "shareFeeRate",
                "type": "u64"
              }
            ]
          },
          {
            "name": "RaydiumLaunchlabSell",
            "fields": [
              {
                "name": "shareFeeRate",
                "type": "u64"
              }
            ]
          },
          {
            "name": "BoopdotfunWrappedBuy"
          },
          {
            "name": "BoopdotfunWrappedSell"
          },
          {
            "name": "Plasma",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "GoonFi",
            "fields": [
              {
                "name": "isBid",
                "type": "bool"
              },
              {
                "name": "blacklistBump",
                "type": "u8"
              }
            ]
          },
          {
            "name": "HumidiFi",
            "fields": [
              {
                "name": "swapId",
                "type": "u64"
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "MeteoraDynamicBondingCurveSwapWithRemainingAccounts"
          },
          {
            "name": "TesseraV",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "PumpWrappedBuyV2"
          },
          {
            "name": "PumpWrappedSellV2"
          },
          {
            "name": "PumpSwapBuyV2"
          },
          {
            "name": "PumpSwapSellV2"
          },
          {
            "name": "Heaven",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "SolFiV2",
            "fields": [
              {
                "name": "isQuoteToBase",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Aquifer"
          },
          {
            "name": "PumpWrappedBuyV3"
          },
          {
            "name": "PumpWrappedSellV3"
          },
          {
            "name": "PumpSwapBuyV3"
          },
          {
            "name": "PumpSwapSellV3"
          },
          {
            "name": "JupiterLendDeposit"
          },
          {
            "name": "JupiterLendRedeem"
          },
          {
            "name": "DefiTuna",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              },
              {
                "name": "remainingAccountsInfo",
                "type": {
                  "option": {
                    "defined": {
                      "name": "RemainingAccountsInfo"
                    }
                  }
                }
              }
            ]
          },
          {
            "name": "AlphaQ",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "RaydiumV2"
          },
          {
            "name": "SarosDlmm",
            "fields": [
              {
                "name": "swapForY",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Futarchy",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "MeteoraDammV2WithRemainingAccounts"
          },
          {
            "name": "Obsidian"
          },
          {
            "name": "WhaleStreet",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "DynamicV1",
            "fields": [
              {
                "name": "candidateSwaps",
                "type": {
                  "vec": {
                    "defined": {
                      "name": "CandidateSwap"
                    }
                  }
                }
              },
              {
                "name": "bestPosition",
                "type": {
                  "option": "u8"
                }
              }
            ]
          },
          {
            "name": "PumpWrappedBuyV4"
          },
          {
            "name": "PumpWrappedSellV4"
          },
          {
            "name": "CarrotIssue"
          },
          {
            "name": "CarrotRedeem"
          },
          {
            "name": "Manifest",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "BisonFi",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiV2",
            "fields": [
              {
                "name": "swapId",
                "type": "u64"
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PerenaStar",
            "fields": [
              {
                "name": "isMint",
                "type": "bool"
              }
            ]
          },
          {
            "name": "JupiterRfqV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              },
              {
                "name": "fillData",
                "type": "bytes"
              }
            ]
          },
          {
            "name": "GoonFiV2",
            "fields": [
              {
                "name": "isBid",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Scorch",
            "fields": [
              {
                "name": "swapId",
                "type": "u128"
              }
            ]
          },
          {
            "name": "VaultLiquidUnstake",
            "fields": [
              {
                "name": "lstAmounts",
                "type": {
                  "array": [
                    "u64",
                    5
                  ]
                }
              },
              {
                "name": "seed",
                "type": "u64"
              }
            ]
          },
          {
            "name": "XOrca"
          },
          {
            "name": "Quantum",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "WhaleStreetV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              },
              {
                "name": "authAmountIn",
                "type": "u64"
              },
              {
                "name": "auth",
                "type": "u64"
              }
            ]
          },
          {
            "name": "Riptide",
            "fields": [
              {
                "name": "amountIsTokenA",
                "type": "bool"
              }
            ]
          },
          {
            "name": "RunnerRodeo"
          },
          {
            "name": "TaurusFi",
            "fields": [
              {
                "name": "isBaseIn",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Omnipair"
          },
          {
            "name": "MSwap"
          },
          {
            "name": "Hylo",
            "fields": [
              {
                "name": "swapType",
                "type": {
                  "defined": {
                    "name": "HyloSwapType"
                  }
                }
              }
            ]
          },
          {
            "name": "VoltrDeposit"
          },
          {
            "name": "VoltrWithdraw"
          },
          {
            "name": "SanctumSV2",
            "fields": [
              {
                "name": "srcLstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "dstLstValueCalcAccs",
                "type": "u8"
              },
              {
                "name": "srcLstIndex",
                "type": "u32"
              },
              {
                "name": "dstLstIndex",
                "type": "u32"
              }
            ]
          },
          {
            "name": "LemmingsFi",
            "fields": [
              {
                "name": "isBaseIn",
                "type": "bool"
              }
            ]
          },
          {
            "name": "ScaleVmmBuy"
          },
          {
            "name": "ScaleVmmSell"
          },
          {
            "name": "ScaleAmmBuy"
          },
          {
            "name": "ScaleAmmSell"
          },
          {
            "name": "BisonFiV2",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Trends"
          },
          {
            "name": "HumaDeposit"
          },
          {
            "name": "HumaInstantWithdraw"
          },
          {
            "name": "Kipseli",
            "fields": [
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "DynamicV2",
            "fields": [
              {
                "name": "candidateSwaps",
                "type": {
                  "vec": {
                    "defined": {
                      "name": "CandidateSwapWithBps"
                    }
                  }
                }
              },
              {
                "name": "maxSplitQuoteCalls",
                "type": "u8"
              },
              {
                "name": "maxSplitCandidates",
                "type": "u8"
              }
            ]
          },
          {
            "name": "PumpSwapBuyV3WithCashbackClaim"
          },
          {
            "name": "PumpSwapSellV3WithCashbackClaim"
          },
          {
            "name": "PumpWrappedBuyV4WithCashbackClaim"
          },
          {
            "name": "PumpWrappedSellV4WithCashbackClaim"
          },
          {
            "name": "GoonFiV3",
            "fields": [
              {
                "name": "isBid",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PumpWrappedBuyV5",
            "fields": [
              {
                "name": "claimCashback",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PumpWrappedSellV5",
            "fields": [
              {
                "name": "claimCashback",
                "type": "bool"
              }
            ]
          },
          {
            "name": "ZeroFiSwapV2"
          },
          {
            "name": "BisonFiPredict",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "BisonFiPredictSide"
                  }
                }
              },
              {
                "name": "isBuy",
                "type": "bool"
              }
            ]
          },
          {
            "name": "ByrealDynamicV3"
          },
          {
            "name": "Flux",
            "fields": [
              {
                "name": "swapId",
                "type": "u64"
              },
              {
                "name": "baseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "VaultLiquidSellLst"
          },
          {
            "name": "VaultLiquidBuyLst",
            "fields": [
              {
                "name": "lstAmount",
                "type": "u64"
              }
            ]
          },
          {
            "name": "KipseliV2",
            "fields": [
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Deriverse",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              },
              {
                "name": "instrId",
                "type": "u32"
              }
            ]
          },
          {
            "name": "Hadron",
            "fields": [
              {
                "name": "isX",
                "type": "bool"
              }
            ]
          },
          {
            "name": "BinaryFi"
          },
          {
            "name": "Metric",
            "fields": [
              {
                "name": "zeroForOne",
                "type": "bool"
              }
            ]
          },
          {
            "name": "JupiterLendDexSwap",
            "fields": [
              {
                "name": "swap0to1",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Gatorswap",
            "fields": [
              {
                "name": "baseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Flint",
            "fields": [
              {
                "name": "isGlobal",
                "type": "bool"
              },
              {
                "name": "takerBuy",
                "type": "bool"
              }
            ]
          },
          {
            "name": "Denali",
            "fields": [
              {
                "name": "baseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PerenaStarV2Deposit"
          },
          {
            "name": "PerenaStarV2WithdrawFromExternal",
            "fields": [
              {
                "name": "externalLiquiditySource",
                "type": "u8"
              }
            ]
          },
          {
            "name": "SanctumSols",
            "fields": [
              {
                "name": "swapType",
                "type": {
                  "defined": {
                    "name": "SanctumSolsSwapType"
                  }
                }
              }
            ]
          },
          {
            "name": "HyloV2",
            "fields": [
              {
                "name": "swapType",
                "type": {
                  "defined": {
                    "name": "HyloSwapType"
                  }
                }
              }
            ]
          },
          {
            "name": "SanctumPamm"
          },
          {
            "name": "Archer",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "TrenchWrappedBuy"
          },
          {
            "name": "TrenchWrappedSell"
          },
          {
            "name": "BisonFiMarketBacked",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "TesseraVV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "Stableswap"
          },
          {
            "name": "BinaryFiV2"
          },
          {
            "name": "KipseliV3",
            "fields": [
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PerenaStarV2TrancheDeposit",
            "fields": [
              {
                "name": "kind",
                "type": {
                  "defined": {
                    "name": "PerenaTrancheKind"
                  }
                }
              }
            ]
          },
          {
            "name": "PerenaStarV2TrancheWithdrawFromExternal",
            "fields": [
              {
                "name": "kind",
                "type": {
                  "defined": {
                    "name": "PerenaTrancheKind"
                  }
                }
              },
              {
                "name": "externalLiquiditySource",
                "type": {
                  "option": "u8"
                }
              }
            ]
          },
          {
            "name": "Quay",
            "fields": [
              {
                "name": "sellBase",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiRouter",
            "fields": [
              {
                "name": "claimedMs",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiRouterV2",
            "fields": [
              {
                "name": "routerId",
                "type": "u64"
              },
              {
                "name": "claimedMs",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "PumpWrappedBuyV6",
            "fields": [
              {
                "name": "claimCashback",
                "type": "bool"
              },
              {
                "name": "allowPartialFill",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HyloRouter"
          },
          {
            "name": "Memefun",
            "fields": [
              {
                "name": "quoteToBase",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiRouterV3",
            "fields": [
              {
                "name": "routerId",
                "type": "u64"
              },
              {
                "name": "generation",
                "type": "u64"
              },
              {
                "name": "minted",
                "type": "u64"
              },
              {
                "name": "expiry",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "PerenaTrancheKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Junior"
          },
          {
            "name": "Senior"
          }
        ]
      }
    },
    {
      "name": "CandidateSwapWithBps",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "candidateSwap",
            "type": {
              "defined": {
                "name": "CandidateSwap"
              }
            }
          },
          {
            "name": "bps",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "CandidateSwap",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "HumidiFi",
            "fields": [
              {
                "name": "swapId",
                "type": "u64"
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "TesseraV",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "HumidiFiV2",
            "fields": [
              {
                "name": "swapId",
                "type": "u64"
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "RaydiumV2"
          },
          {
            "name": "RaydiumClmm"
          },
          {
            "name": "Whirlpool",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "ZeroFi"
          },
          {
            "name": "BisonFiV2",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "GoonFiV2",
            "fields": [
              {
                "name": "isBid",
                "type": "bool"
              }
            ]
          },
          {
            "name": "GoonFiV3",
            "fields": [
              {
                "name": "isBid",
                "type": "bool"
              }
            ]
          },
          {
            "name": "WhirlpoolV2",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              },
              {
                "name": "remainingAccountsInfo",
                "type": {
                  "option": {
                    "defined": {
                      "name": "RemainingAccountsInfo"
                    }
                  }
                }
              }
            ]
          },
          {
            "name": "ZeroFiSwapV2"
          },
          {
            "name": "BisonFiMarketBacked",
            "fields": [
              {
                "name": "aToB",
                "type": "bool"
              }
            ]
          },
          {
            "name": "RaydiumClmmV2"
          },
          {
            "name": "TesseraVV2",
            "fields": [
              {
                "name": "side",
                "type": {
                  "defined": {
                    "name": "Side"
                  }
                }
              }
            ]
          },
          {
            "name": "HumidiFiRouter",
            "fields": [
              {
                "name": "claimedMs",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiRouterV2",
            "fields": [
              {
                "name": "routerId",
                "type": "u64"
              },
              {
                "name": "claimedMs",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          },
          {
            "name": "HumidiFiRouterV3",
            "fields": [
              {
                "name": "routerId",
                "type": "u64"
              },
              {
                "name": "generation",
                "type": "u64"
              },
              {
                "name": "minted",
                "type": "u64"
              },
              {
                "name": "expiry",
                "type": "u64"
              },
              {
                "name": "seedRng",
                "type": {
                  "array": [
                    "u8",
                    32
                  ]
                }
              },
              {
                "name": "token",
                "type": {
                  "array": [
                    "u8",
                    16
                  ]
                }
              },
              {
                "name": "isBaseToQuote",
                "type": "bool"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "SanctumSolsSwapType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Mint"
          },
          {
            "name": "Claim"
          },
          {
            "name": "ClaimHolding"
          }
        ]
      }
    },
    {
      "name": "HyloSwapType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "MintStable"
          },
          {
            "name": "RedeemStable"
          },
          {
            "name": "MintLever"
          },
          {
            "name": "RedeemLever"
          },
          {
            "name": "SwapStableToLever"
          },
          {
            "name": "SwapLeverToStable"
          },
          {
            "name": "StabilityPoolDeposit"
          },
          {
            "name": "StabilityPoolWithdraw"
          }
        ]
      }
    },
    {
      "name": "SwapEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amm",
            "type": "pubkey"
          },
          {
            "name": "inputMint",
            "type": "pubkey"
          },
          {
            "name": "inputAmount",
            "type": "u64"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "outputAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SwapEventV2",
      "docs": [
        "Changing these fields breaks downstream IDL users and Ultra, which parses",
        "this event by hardcoded byte offset. Ship the matching `parseSwapEvents`",
        "change in jup-ag/swap-api first."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "inputMint",
            "type": "pubkey"
          },
          {
            "name": "inputAmount",
            "type": "u64"
          },
          {
            "name": "outputMint",
            "type": "pubkey"
          },
          {
            "name": "outputAmount",
            "type": "u64"
          },
          {
            "name": "amm",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "SwapsEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "swapEvents",
            "type": {
              "vec": {
                "defined": {
                  "name": "SwapEventV2"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "TokenLedger",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenAccount",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "BestSwapOutAmountViolation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "expectedOutAmount",
            "type": "u64"
          },
          {
            "name": "outAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CandidateSwapResult",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "OutAmount",
            "fields": [
              "u64"
            ]
          },
          {
            "name": "ProgramError",
            "fields": [
              "u64"
            ]
          }
        ]
      }
    },
    {
      "name": "CandidateSwapResults",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "results",
            "type": {
              "vec": {
                "defined": {
                  "name": "CandidateSwapResult"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "CandidateSwapQuoteError",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "candidateIndex",
            "type": "u64"
          },
          {
            "name": "inAmount",
            "type": "u64"
          },
          {
            "name": "errorCode",
            "type": "u64"
          }
        ]
      }
    }
  ]
} as const;
