// Sokoban solver: push-optimal, room by room.
//
// Every level this competition draws is a hallway with small rooms off it, and a
// box pushed out of a room into the hallway can never come back, so each room
// is its own problem and the level's optimum is the sum of the rooms'. This
// program splits a level into its rooms, solves each one with a breadth-first
// search over pushes (the first solved state met is push-optimal), and stitches
// the rooms together with plain walks along the hallway.
//
// Deterministic by construction: fixed direction order, FIFO queue, a cap on
// states (work, never the clock), no randomness, no environment input.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Directions: step letter (a walk) and push letter (a step that moves a box). */
const DIRS = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
] as const;

/** The most states one push search keeps before it gives up (work, not time). */
const STATE_CAP = 250_000;

interface Board {
  w: number;
  h: number;
  /** 1 where a wall stands (the outer frame counts as wall). */
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB text: # wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal. */
function parseBoard(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  goals.sort((a, b) => a - b);
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * The squares from which a box alone can be pushed onto some goal: pull back
 * from the goals over open floor. A box standing anywhere else is dead.
 */
function liveCells(b: Board): Uint8Array {
  const live = new Uint8Array(b.w * b.h);
  const queue = [...b.goals];
  for (const g of b.goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const d of DIRS) {
      const step = d.dy * b.w + d.dx;
      const y = x - step;
      if (!b.wall[y] && !b.wall[y - step] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood-fill the squares the player reaches from `from` without crossing
 * walls or the `blocked` squares (boxes). Marks them in `seen` with `stamp`
 * and returns the lowest square reached, which names the region.
 */
function regionLow(
  b: Board,
  blocked: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (const d of DIRS) {
      const q = p + d.dy * b.w + d.dx;
      if (!b.wall[q] && !blocked[q] && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/**
 * Whether the box just pushed onto `t` sits in a frozen 2x2 block: four
 * squares of walls and boxes with a box among them off its goal. Such a box
 * can never move again, so the state is dead.
 */
function frozenAt(b: Board, blocked: Uint8Array, isGoal: Uint8Array, t: number): boolean {
  const w = b.w;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const cells = [a, a + 1, a + w, a + w + 1];
    if (!cells.every((c) => b.wall[c] || blocked[c])) continue;
    if (cells.some((c) => blocked[c] && !isGoal[c])) return true;
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and `blocked` squares, in step letters. */
function walkPath(b: Board, blocked: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(b.w * b.h).fill(-1);
  const how = new Array<string>(b.w * b.h);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const d of DIRS) {
      const q = p + d.dy * b.w + d.dx;
      if (b.wall[q] || blocked[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d.step;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walk: destination out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

/** The square the player stands on after `moves` (case aside) from `from`. */
function endSquare(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

interface PushSolution {
  pushes: number;
  moves: string;
}

/**
 * The push-optimal solution of a board, or null when the search gives up.
 * States are (sorted box squares, player's region); they are expanded in
 * order of pushes made, so the first solved state met is optimal.
 */
function pushSearch(b: Board, cap = STATE_CAP): PushSolution | null {
  const size = b.w * b.h;
  const isGoal = new Uint8Array(size);
  for (const g of b.goals) isGoal[g] = 1;
  const live = liveCells(b);
  const blocked = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const solved = (boxes: number[]): boolean => boxes.every((x) => isGoal[x]);
  if (b.boxes.some((x) => !live[x])) return null;

  // The states in the order found: boxes, the square the player stands on,
  // and the push that made the state from its parent.
  const stateBoxes: number[][] = [b.boxes];
  const statePlayer: number[] = [b.player];
  const parent: number[] = [-1];
  const pushBox: number[] = [-1];
  const pushTo: number[] = [-1];
  const visited = new Map<string, number>();
  for (const x of b.boxes) blocked[x] = 1;
  const startLow = regionLow(b, blocked, b.player, seen, ++stamp, stack);
  for (const x of b.boxes) blocked[x] = 0;
  visited.set(b.boxes.join(',') + '|' + startLow, 0);

  let found = solved(b.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < stateBoxes.length; head++) {
    const boxes = stateBoxes[head]!;
    for (const x of boxes) blocked[x] = 1;
    const here = ++stamp;
    regionLow(b, blocked, statePlayer[head]!, seen, here, stack);
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const box = boxes[bi]!;
      for (const d of DIRS) {
        const step = d.dy * b.w + d.dx;
        const from = box - step;
        const to = box + step;
        // The player must be able to stand behind the box, and the box must
        // land on open, unoccupied, live floor.
        if (seen[from] !== here || b.wall[to] || blocked[to] || !live[to]) continue;
        blocked[box] = 0;
        blocked[to] = 1;
        const frozen = frozenAt(b, blocked, isGoal, to);
        let key = '';
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = to;
          next.sort((x, y) => x - y);
          const low = regionLow(b, blocked, box, mark, ++stamp, stack);
          key = next.join(',') + '|' + low;
        }
        blocked[to] = 0;
        blocked[box] = 1;
        if (frozen || visited.has(key)) continue;
        if (stateBoxes.length >= cap) {
          for (const x of boxes) blocked[x] = 0;
          return null;
        }
        visited.set(key, stateBoxes.length);
        stateBoxes.push(next!);
        statePlayer.push(box);
        parent.push(head);
        pushBox.push(box);
        pushTo.push(to);
        if (solved(next!)) {
          found = stateBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) blocked[x] = 0;
  }
  if (found < 0) return null;

  // Walk the parents back, then turn each push into a walk plus its letter.
  const chain: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) chain.push(s);
  chain.reverse();
  let moves = '';
  let player = b.player;
  let boxes = b.boxes;
  for (const s of chain) {
    const nextBoxes = stateBoxes[s]!;
    const from = pushBox[s]!;
    const to = pushTo[s]!;
    const d = DIRS.find((x) => x.dy * b.w + x.dx === to - from)!;
    for (const x of boxes) blocked[x] = 1;
    moves += walkPath(b, blocked, player, from - (d.dy * b.w + d.dx));
    for (const x of boxes) blocked[x] = 0;
    moves += d.push;
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: chain.length, moves };
}

interface Room {
  boxes: number[];
  goals: number[];
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each connected part left
 * that holds a box is a room. Null when the level is no set of rooms.
 */
function splitRooms(b: Board): Room[] | null {
  const live = liveCells(b);
  const row = Math.floor(b.player / b.w);
  const cut = new Uint8Array(b.w * b.h);
  for (let i = row * b.w; i < (row + 1) * b.w; i++) {
    if (!b.wall[i] && !live[i]) cut[i] = 1;
  }
  if (b.boxes.some((x) => cut[x])) return null;
  const part = new Int32Array(b.w * b.h).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < b.w * b.h; s++) {
    if (b.wall[s] || cut[s] || part[s] >= 0) continue;
    const cells = [s];
    part[s] = rooms.length;
    for (let i = 0; i < cells.length; i++) {
      for (const d of DIRS) {
        const q = cells[i]! + d.dy * b.w + d.dx;
        if (!b.wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          cells.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const x of b.boxes) rooms[part[x]!]!.boxes.push(x);
  for (const g of b.goals) {
    if (part[g] < 0) return null;
    rooms[part[g]!]!.goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * Solve a level room by room; the other rooms' boxes stand as walls (on their
 * goals once their room is done), the player walking on from where the last
 * room left it. Falls back to a search over the whole level, and to an empty
 * (valid, scoreless) answer when even that gives up.
 */
function solveLevel(b: Board): string {
  const rooms = splitRooms(b);
  if (rooms !== null) {
    let player = b.player;
    let moves = '';
    const done: boolean[] = rooms.map(() => false);
    for (let ri = 0; ri < rooms.length; ri++) {
      const room = rooms[ri]!;
      const wall = b.wall.slice();
      for (let oj = 0; oj < rooms.length; oj++) {
        if (oj === ri) continue;
        const other = rooms[oj]!;
        for (const x of done[oj]! ? other.goals : other.boxes) wall[x] = 1;
      }
      const sub: Board = {
        w: b.w,
        h: b.h,
        wall,
        goals: room.goals.slice().sort((a, z) => a - z),
        boxes: room.boxes.slice().sort((a, z) => a - z),
        player,
      };
      const solved = pushSearch(sub);
      if (solved === null) return solveWhole(b);
      moves += solved.moves;
      player = endSquare(b.w, player, solved.moves);
      done[ri] = true;
    }
    return moves;
  }
  return solveWhole(b);
}

function solveWhole(b: Board): string {
  const solved = pushSearch(b);
  return solved === null ? '' : solved.moves;
}

function solve(text: string): string {
  try {
    return solveLevel(parseBoard(text));
  } catch {
    // Never crash and never leave an instance unanswered: an empty answer is valid.
    return '';
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const moves = solve(readFileSync(join(IN_DIR, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
