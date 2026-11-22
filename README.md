# sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/wildanfadhil888-collab/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/wildanfadhil888-collab/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

Push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver" bounty. Every level is a hallway with small rooms off it, and a box pushed into the hallway can never come back — so each room is solved on its own with a breadth-first search over pushes (first solved state met is push-optimal), with dead-square and frozen-2x2 pruning, and the rooms are stitched together with walks along the hallway. Practice set: 1,000,000/1,000,000, push-optimal on all 5 instances, 1.36s of a 60s budget.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads `/input/<id>/level.txt` for i001..i005 (or the `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` overrides) and writes `/output/<id>/solution.txt`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x03vwtz9&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
