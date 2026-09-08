import type { EncryptedAmount } from '@stellar-confidential/core';

/**
 * Frozen test vectors (milestone M2.1).
 *
 * GENERATED FILE — produced by scripts/generate-vectors.ts. Do not hand-edit.
 *
 * Their job is to catch a silent change in encoding, derivation or limb layout:
 * if a refactor alters any of these bytes, ciphertexts written by an older
 * version of this package stop decrypting, and existing wallets lose their
 * history. The vectors are the contract that prevents that.
 *
 * They are also the portability check — the same vectors must decrypt in a
 * browser and in a mobile WebView, not just in Node.
 */
export interface CryptoTestVector {
  readonly name: string;
  /** Hex-encoded 32-byte seed. */
  readonly seed: string;
  readonly spendPublicKey: string;
  readonly viewingPublicKey: string;
  readonly amount: string;
  /** Deterministic randomness used at encryption time. */
  readonly randomSeed: string;
  readonly ciphertext: EncryptedAmount;
}

export const TEST_VECTORS: readonly CryptoTestVector[] = [
  {
    "name": "zero",
    "seed": "0000000000000000000000000000000000000000000000000000000000000000",
    "spendPublicKey": "8745ea682156dcfe1ef78a996b812bdb79b8370d533b6826775c67980fed8ccb",
    "viewingPublicKey": "d8bc51e1e0c7c02f6b8922e3fe52316d9bc5a01525f12183c34bacd95fd6ee58",
    "amount": "0",
    "randomSeed": "1",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "7677c3ef7dc400d809ecd4e34ea9b2d142bab953917d8e3c9b53e0aaa2560c31",
          "handle": "0e12c3854e38d9e375ebbada4544eb035bc75e61f0c6698018e561599269a62f"
        },
        {
          "commitment": "860f6e40837e4157bbc78d8c97d86f0636cc4301bdc62367915c6a4373b00f7f",
          "handle": "f6f479adcb0bcd8408d9f6d07ff206e41a0340f14f8e94f93197b3bc8c248a05"
        },
        {
          "commitment": "8215ef422583ee7818100b5de5a2ee894931ac65bbb999a96cef2ad617e7ff5e",
          "handle": "5c3902254d7cce9102c6bfae54ab548738c14304c9e7095b3d52a3dbe080065d"
        },
        {
          "commitment": "b653731bb90f3d9dc5edc6a3da26beff0f52512ef709568f656a45a5477b1404",
          "handle": "7c45b5b77e44f6a1eb1fd3264ed1dc74f549b062ffb52f3752f2a5cf2ef33f69"
        }
      ]
    }
  },
  {
    "name": "one-stroop",
    "seed": "0101010101010101010101010101010101010101010101010101010101010101",
    "spendPublicKey": "1be2d7cccbfb5fd4a5175776712221ea87d23d29e8346943f9420c31483e492a",
    "viewingPublicKey": "cac2acb78e0143fc8f59a7ba50db4bc557b0602cc1db8587947d65da3a096e0b",
    "amount": "1",
    "randomSeed": "2",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "da6b2fad9f520a0edcff0f632212b2b1bc84f4c641cc1128a54d00b84f76aa38",
          "handle": "2e17145c9a3d3a90e1246bf7a9ca2fba9a56d89ca01852c93fa6719866c06976"
        },
        {
          "commitment": "8c7979c9ec7038d25db29570d792dc97eb4876f6955e3437c48c33bec407f732",
          "handle": "b898e44e420d0eb91bb3c95a945cc651c14b82011592c2b7bcecdea959738130"
        },
        {
          "commitment": "c45e23db0c03203b4c7a9580dec5dca5f34021d105c8e22ed5587c52d5a8e71b",
          "handle": "849cec818df9af7d6b5001b450fd9d62281b707589b2752e2578df01697fbf55"
        },
        {
          "commitment": "164309c475066b761fd779c1c8030decbc501f14d5ebaa0a000daa23573f8d20",
          "handle": "043f7f152d23a1085e2d36f7d2f04d29362f77254e623deaadecc87586132b06"
        }
      ]
    }
  },
  {
    "name": "single-limb",
    "seed": "0202020202020202020202020202020202020202020202020202020202020202",
    "spendPublicKey": "f8ffbec4b068b5c3fd45a4e4335a7b4b5c04f3b3349ade63332292d8a6f19f1a",
    "viewingPublicKey": "ca77ade3cb3ee23f180c374d7833a74c712c0c9f2731f5e4419615472a23147a",
    "amount": "65535",
    "randomSeed": "3",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "38d4eca4574fc562d3c2f033daa4a4b47ebd54c8e08a1850e095c52cd7c8934c",
          "handle": "9ec2361e6f7b93ec6b9ac365a51665f2869345d33ec126a02edabf3b82a80507"
        },
        {
          "commitment": "369d5395239b00cc05b9dcd3269ee4b733580df84f36446b5844f36373c88863",
          "handle": "7a836df87b25523a0ab2bfd5aef40fff55e6922346150b1d0bb1b23c75bfa94e"
        },
        {
          "commitment": "cad434ce5babcb51eae565693e9ae18a939a78c0ba62e68427eae99552eb6277",
          "handle": "32cbbe53ad825f60efde5f95276d7921f8388868b730d0dc14ab3184c904ec41"
        },
        {
          "commitment": "8e8850580773721dc46325a21c07429daf7b63f35f3df7a9321fbc02eaa7983b",
          "handle": "4e943cc9a8becdc3e300ac27724ba39bbbafd2965d0db823e69905422071ed2f"
        }
      ]
    }
  },
  {
    "name": "limb-boundary",
    "seed": "0303030303030303030303030303030303030303030303030303030303030303",
    "spendPublicKey": "1f4b44d792a378bc6ed0239e0c4461e347b1d4226c9183f3eed561d75bfd19f4",
    "viewingPublicKey": "301cda5a14179920c6cbffc4f11cc9965b00dacde44e0f2d9bbaac95ee29631e",
    "amount": "65536",
    "randomSeed": "4",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "e45889824c184ff5a92542bcebb0bac064fd8d70bb4adda4c39031ce1a626e11",
          "handle": "cadf3d2921af47dd91ea6b2a3321d0a602e07a32d5a570fa4da32d93c7b0bd55"
        },
        {
          "commitment": "569631f4fc6fe6970fa4d5b159dd3173b7c1e27a6f2921eb25f69a4eef223829",
          "handle": "e05f8b423db82a88e22cf6e69fd40491df7e2610fe662a735a7c61619d98623f"
        },
        {
          "commitment": "86aa040d2cd23754f80365a9c05021121a4d00b133b423324e86ae5ae7199548",
          "handle": "920c68497d2d8545135daf30660a17bf0fdf1a146d1906aa7842af840ab0913a"
        },
        {
          "commitment": "6e25e5d5d61665009445df533c93254ef66c05ddfe14059736497fb8d464a52f",
          "handle": "42175a09e7e3790fbfeb302ae594e794c0bff0026953b1528fb1d3f37cdb3923"
        }
      ]
    }
  },
  {
    "name": "salary-100-xlm",
    "seed": "0404040404040404040404040404040404040404040404040404040404040404",
    "spendPublicKey": "632ce56c408a8f3c9d4c9088ffb9a4c8f411bf69a72ee04a55a893f7d2c1938a",
    "viewingPublicKey": "d2529dbede7fa7d3debfdf287d3e246e18fc8ed6e947fe71419969ae83b04a69",
    "amount": "1000000000",
    "randomSeed": "5",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "6a089334e65c7b243a3280861a7f7d7c00894e7c51304b919e46aef469fc4658",
          "handle": "92a1515f470be878e876bcccb0322fbd9d482615a7a975039336b844f7051052"
        },
        {
          "commitment": "fcc0cff8c51ab861dd3b7ea38cfb608aeda0c695752af14ae68c2d00a8447a6a",
          "handle": "becea5bc8b6ea92855239f286c66fde33475ec4ee043931e9979ea0a5c082027"
        },
        {
          "commitment": "b855b902a2043529b807be1d53ade9083df7f39e1026267d96f08db236c57563",
          "handle": "a6b037424809a34b197f8dfe91192a55e73719b15136d41705808295d2133466"
        },
        {
          "commitment": "605439b22e419a381b3d9717c797fe513a9f5247a783dcf418a86998f552504c",
          "handle": "8a2d14168b5583eb7b8361af0e5a34b821b8935a9741cbfb13f0e07b52c43376"
        }
      ]
    }
  },
  {
    "name": "max-u64-minus-one",
    "seed": "0505050505050505050505050505050505050505050505050505050505050505",
    "spendPublicKey": "f225a9e42fe7612c7cef56c6cab5fb1213f347b2ff32b803352c9e71ab18b697",
    "viewingPublicKey": "0293b7a247126a3c6963e73fcebed0c263f4759750b7dcb71944b3a776cc3874",
    "amount": "18446744073709551614",
    "randomSeed": "6",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "740563d07184cff7f3b5de81a75bd776505c0843dee3d70f0a437d0b85c7a43e",
          "handle": "10412ffe40a173dd8f1801ccb9d99eee321c8639d49201917db8490dcd7f9431"
        },
        {
          "commitment": "106498c8036b2a84001d7b2f8e528d0b155a926f282bf35dc3d68080663f273d",
          "handle": "a6750b6b8e9b15c9b1c950ba30f614079a60180e5070a3892951fe5cd430e200"
        },
        {
          "commitment": "444b002b797cf4a2c8156a8c05e140c07f0fde0a56464b0f118457e72794cf45",
          "handle": "2ce69b2c5d64e260cd12df5d62e7eced97879b1186ca944d404355aa81c21a2a"
        },
        {
          "commitment": "0059be06022430d3d5f5cc079beee4d981e362352695214150d206f91026a761",
          "handle": "a8d518d1cf26ca171895558f73b043f31a9ffc7353f267442fd2df1b41826c0b"
        }
      ]
    }
  },
  {
    "name": "mixed-bytes",
    "seed": "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    "spendPublicKey": "b050d7383497cca6e9c28876d629f937a1e1ba0703d8dce7c7df8c6166119bb5",
    "viewingPublicKey": "54e9d1ae6be9cd8ad9ade437011e7dee9fc72edfb2fa21c12c887af50c027a43",
    "amount": "4294967297",
    "randomSeed": "7",
    "ciphertext": {
      "limbs": [
        {
          "commitment": "404390a5dfaea08d001d6e01566feecec7acecfcba0b8bcff7725772640b675b",
          "handle": "9ac879c69aea4dc8b47785c7684defe0facae9624f2614b4d33ba498c011b41e"
        },
        {
          "commitment": "543306ad01afe60d2474b27fb8dc9845b390586e9da57f0f5c5f98271941660e",
          "handle": "ac2a66a85729f71062dbddbd922bf2e0f82ce6998681a38a1eec497084e1772e"
        },
        {
          "commitment": "7a1d846cad0708e3b7b799151e43a81e6eb62b2cfd672b6b9443a408daad5342",
          "handle": "bc4353aef79e0fb6a8408c090b6fd1e612aca5931bdfb2b6a3c0f430637fa818"
        },
        {
          "commitment": "3ee57a34a074f2689fede7a3eff2e241bfd5806b47e3c70bb2e5f6a3e6659e3a",
          "handle": "08400f4b250f0a600a14b93ba3dc648ac093f3714d956d90883110c8279e5c40"
        }
      ]
    }
  }
];
