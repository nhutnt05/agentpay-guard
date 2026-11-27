/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agent_payment_firewall.json`.
 */
export type AgentPaymentFirewall = {
  "address": "GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza",
  "metadata": {
    "name": "agentPaymentFirewall",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "AgentPay Guard — on-chain payment firewall for AI agents.",
    "`lib.rs` only dispatches; logic lives in `instructions/*`."
  ],
  "instructions": [
    {
      "name": "addMerchant",
      "discriminator": [
        198,
        82,
        166,
        156,
        165,
        93,
        203,
        72
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "docs": [
            "Seeds use the stored owner (proves a canonical policy PDA);",
            "`has_one = owner` is the authorization check (readable custom error)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "merchant",
          "docs": [
            "through the `merchant_allowlist` PDA seeds."
          ]
        },
        {
          "name": "merchantAllowlist",
          "docs": [
            "`init` (not `init_if_needed`): adding an existing merchant fails (ADR-017)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "merchant"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executePayment",
      "docs": [
        "Arguments order matters: `request_hash` is first because it is used in the receipt seeds."
      ],
      "discriminator": [
        86,
        4,
        7,
        7,
        120,
        139,
        232,
        139
      ],
      "accounts": [
        {
          "name": "agent",
          "docs": [
            "1. Only signer with spending rights; also pays the receipt rent."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "docs": [
            "2. Canonical policy PDA; authorizes the agent and pins mint/vault."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          },
          "relations": [
            "merchantAllowlist"
          ]
        },
        {
          "name": "merchant",
          "docs": [
            "Bound by the `merchant_allowlist` PDA seeds + `has_one = merchant`, and by the",
            "merchant ATA check below."
          ],
          "relations": [
            "merchantAllowlist"
          ]
        },
        {
          "name": "merchantAllowlist",
          "docs": [
            "4. Must exist for (policy, merchant). Missing → `AccountNotInitialized`."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "merchant"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "5. Classic SPL mint (owner check rejects Token-2022); equality via `has_one = mint`."
          ],
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "6. Vault ATA; authority must be the policy PDA."
          ],
          "writable": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "merchantTokenAccount",
          "docs": [
            "7. Merchant's ATA for the policy mint (ADR-022: ATA required in MVP)."
          ],
          "writable": true
        },
        {
          "name": "receipt",
          "docs": [
            "8. Replay protection: `init` fails if this request hash was already executed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "arg",
                "path": "requestHash"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "9. Classic SPL Token program only."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "10."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializePolicy",
      "discriminator": [
        9,
        186,
        86,
        225,
        129,
        162,
        231,
        56
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "policyId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Classic SPL Token mint (`anchor_spl::token::Mint` rejects Token-2022 by owner check)."
          ]
        },
        {
          "name": "vault",
          "docs": [
            "Vault = ATA(policy PDA, mint, classic Token program).",
            "`init_if_needed` (ADR-016): ATA creation is permissionless, so a pre-created canonical",
            "ATA must be adopted instead of failing. This is the ONLY use of `init_if_needed`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "policyId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "agent",
          "type": "pubkey"
        },
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pausePolicy",
      "discriminator": [
        162,
        125,
        168,
        118,
        196,
        17,
        113,
        165
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "removeMerchant",
      "discriminator": [
        55,
        213,
        255,
        172,
        106,
        179,
        207,
        38
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          },
          "relations": [
            "merchantAllowlist"
          ]
        },
        {
          "name": "merchant",
          "docs": [
            "and `has_one = merchant`."
          ],
          "relations": [
            "merchantAllowlist"
          ]
        },
        {
          "name": "merchantAllowlist",
          "docs": [
            "A merchant that was never added fails deserialization (`AccountNotInitialized`)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  114,
                  99,
                  104,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              },
              {
                "kind": "account",
                "path": "merchant"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "resumePolicy",
      "discriminator": [
        19,
        5,
        135,
        187,
        83,
        243,
        251,
        235
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updatePolicy",
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newMaxPerTx",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "newDailyLimit",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "newAgent",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "agentPolicy"
              },
              {
                "kind": "account",
                "path": "policy.policyId",
                "account": "agentPolicy"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Classic SPL mint; equality via `has_one = mint`."
          ],
          "relations": [
            "policy"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "destination",
          "docs": [
            "Any token account of the policy mint whose authority is the owner",
            "(ATA not required). Funds can never be routed to a third party."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentPolicy",
      "discriminator": [
        148,
        193,
        218,
        129,
        21,
        96,
        195,
        77
      ]
    },
    {
      "name": "merchantAllowlist",
      "discriminator": [
        212,
        124,
        138,
        252,
        196,
        30,
        149,
        177
      ]
    },
    {
      "name": "paymentReceipt",
      "discriminator": [
        168,
        198,
        209,
        4,
        60,
        235,
        126,
        109
      ]
    }
  ],
  "events": [
    {
      "name": "merchantAdded",
      "discriminator": [
        16,
        98,
        130,
        52,
        170,
        222,
        81,
        51
      ]
    },
    {
      "name": "merchantRemoved",
      "discriminator": [
        72,
        118,
        195,
        23,
        129,
        76,
        18,
        216
      ]
    },
    {
      "name": "paymentExecuted",
      "discriminator": [
        153,
        165,
        141,
        18,
        246,
        20,
        204,
        227
      ]
    },
    {
      "name": "policyInitialized",
      "discriminator": [
        102,
        184,
        59,
        178,
        235,
        69,
        251,
        181
      ]
    },
    {
      "name": "policyPaused",
      "discriminator": [
        125,
        114,
        89,
        149,
        229,
        231,
        254,
        37
      ]
    },
    {
      "name": "policyResumed",
      "discriminator": [
        243,
        2,
        93,
        35,
        174,
        176,
        65,
        5
      ]
    },
    {
      "name": "policyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "policyPaused",
      "msg": "Policy is paused"
    },
    {
      "code": 6001,
      "name": "unauthorizedAgent",
      "msg": "Signer is not the policy agent"
    },
    {
      "code": 6002,
      "name": "unauthorizedOwner",
      "msg": "Signer is not the policy owner"
    },
    {
      "code": 6003,
      "name": "merchantNotAllowed",
      "msg": "Merchant is not allowlisted"
    },
    {
      "code": 6004,
      "name": "invalidMint",
      "msg": "Mint does not match policy"
    },
    {
      "code": 6005,
      "name": "invalidVault",
      "msg": "Vault does not match policy"
    },
    {
      "code": 6006,
      "name": "invalidMerchantTokenAccount",
      "msg": "Merchant token account owner or mint is invalid"
    },
    {
      "code": 6007,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "exceedsMaxPerTx",
      "msg": "Amount exceeds per-transaction limit"
    },
    {
      "code": 6009,
      "name": "exceedsDailyLimit",
      "msg": "Amount exceeds remaining daily limit"
    },
    {
      "code": 6010,
      "name": "insufficientVaultBalance",
      "msg": "Vault balance is insufficient"
    },
    {
      "code": 6011,
      "name": "invalidRequestHash",
      "msg": "Request hash does not match payment fields"
    },
    {
      "code": 6012,
      "name": "requestExpired",
      "msg": "Payment request has expired"
    },
    {
      "code": 6013,
      "name": "requestExpiryTooFar",
      "msg": "Request expiry exceeds maximum TTL"
    },
    {
      "code": 6014,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6015,
      "name": "invalidPolicyLimits",
      "msg": "Limits must be > 0 and max_per_tx <= daily_limit"
    },
    {
      "code": 6016,
      "name": "invalidAgent",
      "msg": "Agent must be non-default and different from owner"
    },
    {
      "code": 6017,
      "name": "policyAlreadyPaused",
      "msg": "Policy is already paused"
    },
    {
      "code": 6018,
      "name": "policyNotPaused",
      "msg": "Policy is not paused"
    },
    {
      "code": 6019,
      "name": "invalidWithdrawDestination",
      "msg": "Withdraw destination must be an owner token account of the policy mint"
    },
    {
      "code": 6020,
      "name": "emptyUpdate",
      "msg": "update_policy called with no changes"
    },
    {
      "code": 6021,
      "name": "invalidMerchant",
      "msg": "Merchant must not be default, the policy, the vault, or the agent"
    }
  ],
  "types": [
    {
      "name": "agentPolicy",
      "docs": [
        "Payment policy and signing authority of the vault ATA (docs/03 §3).",
        "Size: 8 (discriminator) + 202 = 210 bytes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Wallet that created the policy. Immutable."
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "Only key allowed to sign `execute_payment`. Replaceable by the owner."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "Classic SPL Token mint. Immutable."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "ATA(owner = policy PDA, mint). Immutable."
            ],
            "type": "pubkey"
          },
          {
            "name": "policyId",
            "docs": [
              "Owner-chosen identifier, part of the PDA seeds. Immutable."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxPerTx",
            "docs": [
              "Maximum base units per payment."
            ],
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "docs": [
              "Maximum base units per UTC day."
            ],
            "type": "u64"
          },
          {
            "name": "spentToday",
            "docs": [
              "Base units spent during `day_index` (lazily reset)."
            ],
            "type": "u64"
          },
          {
            "name": "dayIndex",
            "docs": [
              "`unix_timestamp.div_euclid(86_400)` of the day `spent_today` refers to."
            ],
            "type": "i64"
          },
          {
            "name": "isPaused",
            "docs": [
              "When true, `execute_payment` fails."
            ],
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchantAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "merchantAllowlist",
      "docs": [
        "One allowlist entry per (policy, merchant wallet). Existence means \"allowed\" (docs/03 §5).",
        "Size: 8 + 74 = 82 bytes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "docs": [
              "Merchant wallet (not its token account)."
            ],
            "type": "pubkey"
          },
          {
            "name": "isAllowed",
            "docs": [
              "Always true while the account exists in the MVP; still checked (defense in depth)."
            ],
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "merchantRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "paymentExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "requestHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spentToday",
            "type": "u64"
          },
          {
            "name": "dayIndex",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "paymentReceipt",
      "docs": [
        "Proof that a canonical payment request executed. Never closed (docs/03 §6).",
        "Size: 8 + 177 = 185 bytes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "requestHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "merchant",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policyInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyResumed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "oldAgent",
            "type": "pubkey"
          },
          {
            "name": "newAgent",
            "type": "pubkey"
          },
          {
            "name": "oldMaxPerTx",
            "type": "u64"
          },
          {
            "name": "newMaxPerTx",
            "type": "u64"
          },
          {
            "name": "oldDailyLimit",
            "type": "u64"
          },
          {
            "name": "newDailyLimit",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "maxRequestTtlSeconds",
      "docs": [
        "Maximum distance of `expires_at` into the future for a payment request."
      ],
      "type": "i64",
      "value": "600"
    },
    {
      "name": "requestHashDomain",
      "docs": [
        "Domain separator of the canonical request hash (docs/11 §3). 25 bytes."
      ],
      "type": "bytes",
      "value": "[65, 71, 69, 78, 84, 80, 65, 89, 95, 71, 85, 65, 82, 68, 95, 80, 65, 89, 77, 69, 78, 84, 95, 86, 49]"
    },
    {
      "name": "secondsPerDay",
      "docs": [
        "UTC day length used for the daily spending window."
      ],
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "seedMerchant",
      "docs": [
        "PDA seed for `MerchantAllowlist`: [SEED_MERCHANT, policy, merchant]."
      ],
      "type": "bytes",
      "value": "[109, 101, 114, 99, 104, 97, 110, 116]"
    },
    {
      "name": "seedPolicy",
      "docs": [
        "PDA seed for `AgentPolicy`: [SEED_POLICY, owner, policy_id]."
      ],
      "type": "bytes",
      "value": "[112, 111, 108, 105, 99, 121]"
    },
    {
      "name": "seedReceipt",
      "docs": [
        "PDA seed for `PaymentReceipt`: [SEED_RECEIPT, policy, request_hash]."
      ],
      "type": "bytes",
      "value": "[114, 101, 99, 101, 105, 112, 116]"
    }
  ]
};
