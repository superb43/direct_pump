// Official Meteora DLMM account-only IDL. See NOTICE.md for pinned source.
import type { Idl } from '@coral-xyz/anchor';
export const DLMM_IDL = {
  "address": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "metadata": {
    "name": "lb_clmm",
    "version": "0.12.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [],
  "accounts": [
    {
      "name": "LbPair",
      "discriminator": [
        33,
        11,
        49,
        98,
        181,
        101,
        177,
        13
      ]
    }
  ],
  "types": [
    {
      "name": "LbPair",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "parameters",
            "type": {
              "defined": {
                "name": "StaticParameters"
              }
            }
          },
          {
            "name": "v_parameters",
            "type": {
              "defined": {
                "name": "VariableParameters"
              }
            }
          },
          {
            "name": "bump_seed",
            "type": {
              "array": [
                "u8",
                1
              ]
            }
          },
          {
            "name": "bin_step_seed",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "pair_type",
            "type": "u8"
          },
          {
            "name": "active_id",
            "type": "i32"
          },
          {
            "name": "bin_step",
            "type": "u16"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "require_base_factor_seed",
            "type": "u8"
          },
          {
            "name": "base_factor_seed",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "activation_type",
            "type": "u8"
          },
          {
            "name": "creator_pool_on_off_control",
            "type": "u8"
          },
          {
            "name": "token_x_mint",
            "type": "pubkey"
          },
          {
            "name": "token_y_mint",
            "type": "pubkey"
          },
          {
            "name": "reserve_x",
            "type": "pubkey"
          },
          {
            "name": "reserve_y",
            "type": "pubkey"
          },
          {
            "name": "protocol_fee",
            "type": {
              "defined": {
                "name": "ProtocolFee"
              }
            }
          },
          {
            "name": "_padding_1",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "reward_infos",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "RewardInfo"
                  }
                },
                2
              ]
            }
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "bin_array_bitmap",
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "last_updated_at",
            "type": "i64"
          },
          {
            "name": "_padding_2",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pre_activation_swap_address",
            "type": "pubkey"
          },
          {
            "name": "base_key",
            "type": "pubkey"
          },
          {
            "name": "activation_point",
            "type": "u64"
          },
          {
            "name": "pre_activation_duration",
            "type": "u64"
          },
          {
            "name": "_padding_3",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "_padding_4",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "token_mint_x_program_flag",
            "type": "u8"
          },
          {
            "name": "token_mint_y_program_flag",
            "type": "u8"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "_reserved",
            "type": {
              "array": [
                "u8",
                21
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ProtocolFee",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount_x",
            "type": "u64"
          },
          {
            "name": "amount_y",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RewardInfo",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "reward_duration",
            "type": "u64"
          },
          {
            "name": "reward_duration_end",
            "type": "u64"
          },
          {
            "name": "reward_rate",
            "type": "u128"
          },
          {
            "name": "last_update_time",
            "type": "u64"
          },
          {
            "name": "cumulative_seconds_with_empty_liquidity_reward",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "StaticParameters",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "base_factor",
            "type": "u16"
          },
          {
            "name": "filter_period",
            "type": "u16"
          },
          {
            "name": "decay_period",
            "type": "u16"
          },
          {
            "name": "reduction_factor",
            "type": "u16"
          },
          {
            "name": "variable_fee_control",
            "type": "u32"
          },
          {
            "name": "max_volatility_accumulator",
            "type": "u32"
          },
          {
            "name": "min_bin_id",
            "type": "i32"
          },
          {
            "name": "max_bin_id",
            "type": "i32"
          },
          {
            "name": "protocol_share",
            "type": "u16"
          },
          {
            "name": "base_fee_power_factor",
            "type": "u8"
          },
          {
            "name": "function_type",
            "type": "u8"
          },
          {
            "name": "collect_fee_mode",
            "type": "u8"
          },
          {
            "name": "_padding",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "VariableParameters",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "volatility_accumulator",
            "type": "u32"
          },
          {
            "name": "volatility_reference",
            "type": "u32"
          },
          {
            "name": "index_reference",
            "type": "i32"
          },
          {
            "name": "_padding",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "last_update_timestamp",
            "type": "i64"
          },
          {
            "name": "_padding_1",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          }
        ]
      }
    }
  ]
} as Idl;
