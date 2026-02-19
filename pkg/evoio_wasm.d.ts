/* tslint:disable */
/* eslint-disable */

/**
 * Batch metabolism + mechanism maintenance costs for all cells.
 * Computes total energy cost per cell from metabolism, organelle maintenance,
 * and all evolved mechanism costs.
 *
 * Input per cell (flat arrays, length n):
 *   cell_speed, cell_metabolism — organelle-modified stats
 *   cell_membrane, cell_spines, cell_flipper, cell_cilia
 *   cell_flagella, cell_jet, cell_amoeboid
 *   cell_toxin, cell_spike, cell_constrict, cell_camo, cell_toxresist
 *   cell_organelle_sum — sum of all organelle levels
 *
 * Output: out array (length n) — total energy cost per cell
 */
export function batch_energy_costs(cell_speed: Float32Array, cell_metabolism: Float32Array, cell_membrane: Float32Array, cell_spines: Float32Array, cell_flipper: Float32Array, cell_cilia: Float32Array, cell_flagella: Float32Array, cell_jet: Float32Array, cell_amoeboid: Float32Array, cell_toxin: Float32Array, cell_spike: Float32Array, cell_constrict: Float32Array, cell_camo: Float32Array, cell_toxresist: Float32Array, cell_organelle_sum: Float32Array, metabolism_base: number, dt: number, out: Float32Array): Float32Array;

/**
 * Batch food drift: shift food values by a global offset with fractional transfer.
 */
export function batch_food_drift(food: Float32Array, w: number, h: number, dx: number, dy: number, frac: number, phase: number, stride: number): void;

/**
 * Batch food sensing for all cells.
 * For each cell, samples the 3 food grids in 4 cardinal directions,
 * and writes the best food direction (bfx, bfy) and the food value at the cell position.
 *
 * Input flat arrays (length n each):
 *   cell_x, cell_y — positions
 *   cell_sense — sense stat per cell
 *   cell_diet — diet gene per cell (0=herb, 1=carn)
 *
 * Output: out array, 3 floats per cell: [bfx, bfy, hereVal]
 *   Total length = n * 3
 */
export function batch_food_sense(cell_x: Float32Array, cell_y: Float32Array, cell_sense: Float32Array, cell_diet: Float32Array, food: Float32Array, mineral: Float32Array, meat: Float32Array, w: number, h: number, use_full: number, out: Float32Array): Float32Array;

/**
 * Batch neighbor interaction forces: flocking (cohesion/separation/alignment)
 * AND predator-prey (flee/chase) in a SINGLE spatial grid scan.
 *
 * Instead of JS scanning neighbors twice (once for flocking, once for predAI),
 * this does it once in compiled Rust with f32 arithmetic.
 *
 * Input per cell (flat arrays, length n):
 *   cell_x, cell_y — positions
 *   cell_vx, cell_vy — velocities (for alignment)
 *   cell_clade — clade ID (u32 encoded as f32)
 *   cell_diet — diet gene [0..1]
 *   cell_energy — current energy
 *   cell_sense — sense stat (for predAI range)
 *   cell_social — effective sociality [0..1]
 *   cell_speed — speed stat (for chase strength)
 *   cell_flags — bitfield: bit0=do_flock, bit1=do_pred (encoded as f32)
 *
 * Spatial grid: flat_grid (indices into cell arrays), bucket_offsets, bucket_sizes
 *   grid is gw*gh buckets; bucket_offsets[b] = start index in flat_grid, bucket_sizes[b] = count
 *
 * Output: out array, 8 floats per cell:
 *   [flockX, flockY, fleeX, fleeY, chaseX, chaseY, nFlockNear, unused]
 */
export function batch_neighbor_forces(cell_x: Float32Array, cell_y: Float32Array, cell_vx: Float32Array, cell_vy: Float32Array, cell_clade: Float32Array, cell_diet: Float32Array, cell_energy: Float32Array, cell_sense: Float32Array, cell_social: Float32Array, cell_speed: Float32Array, cell_flags: Float32Array, flat_grid: Float32Array, bucket_offsets: Float32Array, bucket_sizes: Float32Array, gw: number, gh: number, world_w: number, world_h: number, pop_scale: number, search_radius_cells: number, out: Float32Array): Float32Array;

/**
 * Batch physics update: apply velocity to position with toroidal wrapping.
 * Replaces the per-cell JS position update loop.
 */
export function batch_physics(pos_x: Float32Array, pos_y: Float32Array, vel_x: Float32Array, vel_y: Float32Array, move_amt: Float32Array, wx: Float32Array, wy: Float32Array, world_w: number, world_h: number, damping: number): void;

export function diffuse_food(food: Float32Array, w: number, h: number, rate: number, sample_scale: number, rng_state: number): Float32Array;

/**
 * Gas grid diffusion: diffuse O2 and CO2 between adjacent cells.
 * Also replenishes O2 toward ambient and decays CO2.
 */
export function gas_grid_diffuse(o2_grid: Float32Array, co2_grid: Float32Array, gw: number, gh: number, o2_diff_rate: number, co2_diff_rate: number, ambient_o2: number, ambient_replenish: number, co2_decay: number): void;

export function greet(): void;

export function grow_food(food: Float32Array, w: number, h: number, base: number, patch: number, sample_scale: number, rng_state: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly batch_energy_costs: (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any, m: any, n: any, o: any, p: number, q: number, r: any) => any;
    readonly batch_food_drift: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly batch_food_sense: (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: number, i: number, j: number, k: any) => any;
    readonly batch_neighbor_forces: (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any, m: any, n: any, o: number, p: number, q: number, r: number, s: number, t: number, u: any) => any;
    readonly batch_physics: (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: number, i: number, j: number) => void;
    readonly diffuse_food: (a: any, b: number, c: number, d: number, e: number, f: number) => any;
    readonly gas_grid_diffuse: (a: any, b: any, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly greet: () => void;
    readonly grow_food: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
