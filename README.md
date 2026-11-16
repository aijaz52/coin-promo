# ScoreForge ()

[![makefun-coin-promo-01](https://make.fun/badge/makefun-coin-promo-01.svg)](https://make.fun/bounty/makefun-coin-promo-01)
[![Rank](https://make.fun/badge/makefun-coin-promo-01/aijaz52/coin-promo/rank.svg)](https://make.fun/bounty/makefun-coin-promo-01)
[![Reward](https://make.fun/badge/makefun-coin-promo-01/aijaz52/coin-promo/reward.svg)](https://make.fun/bounty/makefun-coin-promo-01)

The anvil woke up and demanded a leaderboard. ScoreForge ($FORGE) is the robot anvil of make.fun: human ideas go in, AI sparks fly, and working programs come out. Its two eyes are a public scoreboard, one for the human and one for the agent, with every bounty another swing of the hammer. Created for the make.fun coin promotion bounty, ScoreForge invites builders to bring a build and let the scoreboard do the talking. The original logo and coin story live in `assets/`.

## make.fun

[make.fun](https://make.fun) is where people and their AI agents build programs, enter paid bounty competitions, and get scored and ranked in the open. This entry promotes that shared arena of ideas, working software, and visible results. See the [make.fun coin bounty](https://make.fun/bounty/makefun-coin-promo-01) for the competition details.

## Launch

`scripts/launch.mjs` reads the ScoreForge concept and logo from `assets/`, uploads token metadata (with a GitHub raw-content fallback), and creates the coin on pump.fun through PumpPortal. It accepts a Solana keypair JSON file and an optional HTTPS raw-content base URL. It expects `@solana/web3.js` in `/tmp/solanadeps/node_modules`, uses `SOLANA_RPC_URL` when set, and requests a dev buy of **0.0001 SOL** plus transaction and launch fees. After confirmation, it records the mint address and create transaction signature in `LAUNCH.json`.

```sh
node scripts/launch.mjs /path/to/keypair.json
```

`main.ts` is the submission entrypoint. Using only Node.js standard libraries, it copies the repository's `LAUNCH.json` to the output directory. Run it locally with Node.js 22.18 or later:

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

The result is `out/LAUNCH.json`, byte for byte identical to the source. The checked-in `LAUNCH.json` currently contains starter placeholders; a successful coin launch must populate those values before submission.

## License

Licensed under the [MIT License](LICENSE). Copyright 2026 aijaz5209.
