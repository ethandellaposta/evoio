use wasm_bindgen::prelude::*;
use js_sys::Float32Array;

// A wee_alloc global allocator for smaller binary size
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, evoio-wasm!");
}

// Simple seeded Xorshift RNG
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        let mut state = seed;
        for _ in 0..10 {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
        }
        Self { state }
    }
    #[inline(always)]
    pub fn next(&mut self) -> u32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        self.state
    }
    #[inline(always)]
    pub fn next_f32(&mut self) -> f32 {
        (self.next() as f32) / (u32::MAX as f32)
    }
    #[inline(always)]
    pub fn next_usize(&mut self, n: usize) -> usize {
        (self.next_f32() * n as f32) as usize
    }
    #[inline(always)]
    pub fn next_norm(&mut self) -> f32 {
        // Box-Muller approximation (fast)
        let u1 = self.next_f32();
        let u2 = self.next_f32();
        (-2.0 * u1.ln().sqrt()) * (2.0 * std::f32::consts::PI * u2).cos()
    }
}

// Helper: toroidal delta
#[inline(always)]
#[allow(dead_code)]
fn torus_delta(d: f32, size: f32) -> f32 {
    let half = size * 0.5;
    if d > half { d - size } else if d < -half { d + size } else { d }
}

// Exported: food diffusion
#[wasm_bindgen]
#[allow(unused_mut)]
pub fn diffuse_food(food: Float32Array, w: u32, h: u32, rate: f32, sample_scale: f32, rng_state: u32) -> Float32Array {
    let mut rng = Rng::new(rng_state);
    let n = ((w * h) as f32 * 0.5 * sample_scale) as usize;
    for _ in 0..n {
        let ix = rng.next_usize(w as usize);
        let iy = rng.next_usize(h as usize);
        let i = ix + iy * w as usize;
        let dir = rng.next_usize(4);
        let j = match dir {
            0 => ((ix + 1) % w as usize) + iy * w as usize,
            1 => ((ix + w as usize - 1) % w as usize) + iy * w as usize,
            2 => ix + ((iy + 1) % h as usize) * w as usize,
            _ => ix + ((iy + h as usize - 1) % h as usize) * w as usize,
        };
        let a = food.get_index(i as u32);
        let b = food.get_index(j as u32);
        let d = (a - b) * rate / sample_scale.max(0.25);
        food.set_index(i as u32, a - d);
        food.set_index(j as u32, b + d);
    }
    food
}

// Exported: food growth (uniform + patchy)
#[wasm_bindgen]
#[allow(unused_mut)]
pub fn grow_food(food: Float32Array, w: u32, h: u32, base: f32, patch: f32, sample_scale: f32, rng_state: u32) -> Float32Array {
    let mut rng = Rng::new(rng_state);
    let k = ((w * h) as f32 / 70.0 * sample_scale) as usize;
    let patch_k = (k as f32 * (0.25 + 1.75 * patch)) as usize;
    let uniform_k = k;
    let s = sample_scale.max(0.15).min(1.0);
    for _ in 0..uniform_k {
        let ix = rng.next_usize(w as usize);
        let iy = rng.next_usize(h as usize);
        let idx = ix + iy * w as usize;
        let v = food.get_index(idx as u32);
        let add = 0.01 * base / s * (0.3 + 0.7 * (1.0 - patch));
        food.set_index(idx as u32, (v + add).min(8.0));
    }
    for _ in 0..patch_k {
        let cx = rng.next_usize(w as usize);
        let cy = rng.next_usize(h as usize);
        let r = 3 + (rng.next_f32() * 9.0) as u32;
        let add = 0.02 * base / s * (0.2 + 0.8 * patch);
        for dy in 0..=r {
            for dx in 0..=r {
                let x = ((cx as i32 + dx as i32 - r as i32 + w as i32) % w as i32) as usize;
                let y = ((cy as i32 + dy as i32 - r as i32 + h as i32) % h as i32) as usize;
                let idx = x + y * w as usize;
                let v = food.get_index(idx as u32);
                food.set_index(idx as u32, (v + add).min(8.0));
            }
        }
    }
    food
}

/// Batch food sensing for all cells.
/// For each cell, samples the 3 food grids in 4 cardinal directions,
/// and writes the best food direction (bfx, bfy) and the food value at the cell position.
///
/// Input flat arrays (length n each):
///   cell_x, cell_y — positions
///   cell_sense — sense stat per cell
///   cell_diet — diet gene per cell (0=herb, 1=carn)
///
/// Output: out array, 3 floats per cell: [bfx, bfy, hereVal]
///   Total length = n * 3
#[wasm_bindgen]
pub fn batch_food_sense(
    cell_x: &Float32Array,
    cell_y: &Float32Array,
    cell_sense: &Float32Array,
    cell_diet: &Float32Array,
    food: &Float32Array,
    mineral: &Float32Array,
    meat: &Float32Array,
    w: u32, h: u32,
    use_full: u32, // 1 = 8 dirs + mineral, 0 = 4 dirs fast path
    out: Float32Array,
) -> Float32Array {
    let n = cell_x.length();
    let wf = w as f32;
    let hf = h as f32;
    let wu = w as usize;

    let dirs4: [(f32, f32); 4] = [(1.0,0.0), (-1.0,0.0), (0.0,1.0), (0.0,-1.0)];
    let dirs8: [(f32, f32); 4] = [(1.0,1.0), (-1.0,1.0), (1.0,-1.0), (-1.0,-1.0)];

    for i in 0..n {
        let x = cell_x.get_index(i);
        let y = cell_y.get_index(i);
        let sense = cell_sense.get_index(i);
        let diet = cell_diet.get_index(i);
        let herb_aff = 1.0 - diet;
        let carn_aff = diet;
        let sense_r = sense * 2.2;

        // Sample at cell position
        let ix = x.rem_euclid(wf) as usize;
        let iy = y.rem_euclid(hf) as usize;
        let j0 = ix + iy * wu;
        let mut here_val = food.get_index(j0 as u32) * herb_aff
            + meat.get_index(j0 as u32) * carn_aff * 2.0;
        if use_full != 0 {
            here_val += mineral.get_index(j0 as u32) * 1.5;
        }

        let mut best_val = here_val;
        let mut bfx: f32 = 0.0;
        let mut bfy: f32 = 0.0;

        // 4 cardinal directions
        for &(dx, dy) in dirs4.iter() {
            let sx = (x + dx * sense_r).rem_euclid(wf) as usize;
            let sy = (y + dy * sense_r).rem_euclid(hf) as usize;
            let ji = sx + sy * wu;
            let fv = food.get_index(ji as u32) * herb_aff
                + meat.get_index(ji as u32) * carn_aff * 2.0;
            if fv > best_val {
                best_val = fv;
                bfx = dx;
                bfy = dy;
            }
        }

        // 4 diagonal directions (full mode only)
        if use_full != 0 {
            for &(dx, dy) in dirs8.iter() {
                let sx = (x + dx * sense_r).rem_euclid(wf) as usize;
                let sy = (y + dy * sense_r).rem_euclid(hf) as usize;
                let ji = sx + sy * wu;
                let fv = food.get_index(ji as u32) * herb_aff
                    + mineral.get_index(ji as u32) * 1.5
                    + meat.get_index(ji as u32) * carn_aff * 2.0;
                if fv > best_val {
                    best_val = fv;
                    bfx = dx;
                    bfy = dy;
                }
            }
        }

        let oi = i * 3;
        out.set_index(oi, bfx);
        out.set_index(oi + 1, bfy);
        out.set_index(oi + 2, here_val);
    }
    out
}

/// Batch physics update: apply velocity to position with toroidal wrapping.
/// Replaces the per-cell JS position update loop.
#[wasm_bindgen]
pub fn batch_physics(
    pos_x: Float32Array,
    pos_y: Float32Array,
    vel_x: Float32Array,
    vel_y: Float32Array,
    move_amt: &Float32Array,
    wx: &Float32Array,
    wy: &Float32Array,
    world_w: f32,
    world_h: f32,
    damping: f32,
) {
    let n = pos_x.length();

    for i in 0..n {
        let ma = move_amt.get_index(i);
        let wxi = wx.get_index(i);
        let wyi = wy.get_index(i);

        let mut vx = vel_x.get_index(i) + wxi * ma;
        let mut vy = vel_y.get_index(i) + wyi * ma;

        vx *= damping;
        vy *= damping;

        let mut x = pos_x.get_index(i) + vx;
        let mut y = pos_y.get_index(i) + vy;

        if x < 0.0 { x += world_w; }
        else if x >= world_w { x -= world_w; }
        if y < 0.0 { y += world_h; }
        else if y >= world_h { y -= world_h; }

        pos_x.set_index(i, x);
        pos_y.set_index(i, y);
        vel_x.set_index(i, vx);
        vel_y.set_index(i, vy);
    }
}

/// Gas grid diffusion: diffuse O2 and CO2 between adjacent cells.
/// Also replenishes O2 toward ambient and decays CO2.
#[wasm_bindgen]
pub fn gas_grid_diffuse(
    o2_grid: Float32Array,
    co2_grid: Float32Array,
    gw: u32,
    gh: u32,
    o2_diff_rate: f32,
    co2_diff_rate: f32,
    ambient_o2: f32,
    ambient_replenish: f32,
    co2_decay: f32,
) {
    let w = gw as usize;
    let h = gh as usize;
    let n = w * h;

    for phase in 0..2u32 {
        for iy in 0..h {
            for ix in 0..w {
                if ((ix + iy) as u32 & 1) != phase { continue; }
                let i = (ix + iy * w) as u32;

                let rx = if ix + 1 < w { ix + 1 } else { 0 };
                let ri = (rx + iy * w) as u32;
                let o2d = (o2_grid.get_index(i) - o2_grid.get_index(ri)) * o2_diff_rate;
                o2_grid.set_index(i, o2_grid.get_index(i) - o2d);
                o2_grid.set_index(ri, o2_grid.get_index(ri) + o2d);
                let co2d = (co2_grid.get_index(i) - co2_grid.get_index(ri)) * co2_diff_rate;
                co2_grid.set_index(i, co2_grid.get_index(i) - co2d);
                co2_grid.set_index(ri, co2_grid.get_index(ri) + co2d);

                let dy = if iy + 1 < h { iy + 1 } else { 0 };
                let di = (ix + dy * w) as u32;
                let o2d2 = (o2_grid.get_index(i) - o2_grid.get_index(di)) * o2_diff_rate;
                o2_grid.set_index(i, o2_grid.get_index(i) - o2d2);
                o2_grid.set_index(di, o2_grid.get_index(di) + o2d2);
                let co2d2 = (co2_grid.get_index(i) - co2_grid.get_index(di)) * co2_diff_rate;
                co2_grid.set_index(i, co2_grid.get_index(i) - co2d2);
                co2_grid.set_index(di, co2_grid.get_index(di) + co2d2);
            }
        }
    }

    for i in 0..n as u32 {
        let o2v = o2_grid.get_index(i);
        o2_grid.set_index(i, o2v + (ambient_o2 - o2v) * ambient_replenish);
        let co2v = co2_grid.get_index(i);
        co2_grid.set_index(i, co2v * (1.0 - co2_decay));
    }
}

/// Batch food drift: shift food values by a global offset with fractional transfer.
#[wasm_bindgen]
pub fn batch_food_drift(
    food: Float32Array,
    w: u32,
    h: u32,
    dx: i32,
    dy: i32,
    frac: f32,
    phase: u32,
    stride: u32,
) {
    let wu = w as usize;
    let hu = h as usize;

    let mut iy = phase as usize;
    while iy < hu {
        for ix in 0..wu {
            let si = (ix + iy * wu) as u32;
            let val = food.get_index(si);
            if val < 0.02 { continue; }

            let tx = (((ix as i32 + dx) % w as i32 + w as i32) % w as i32) as usize;
            let ty = (((iy as i32 + dy) % h as i32 + h as i32) % h as i32) as usize;
            let ti = (tx + ty * wu) as u32;

            if ti != si {
                let transfer = val * frac;
                food.set_index(si, val - transfer);
                let dest_val = food.get_index(ti);
                food.set_index(ti, dest_val + transfer);
            }
        }
        iy += stride as usize;
    }
}

/// Batch neighbor interaction forces: flocking (cohesion/separation/alignment)
/// AND predator-prey (flee/chase) in a SINGLE spatial grid scan.
///
/// Instead of JS scanning neighbors twice (once for flocking, once for predAI),
/// this does it once in compiled Rust with f32 arithmetic.
///
/// Input per cell (flat arrays, length n):
///   cell_x, cell_y — positions
///   cell_vx, cell_vy — velocities (for alignment)
///   cell_clade — clade ID (u32 encoded as f32)
///   cell_diet — diet gene [0..1]
///   cell_energy — current energy
///   cell_sense — sense stat (for predAI range)
///   cell_social — effective sociality [0..1]
///   cell_speed — speed stat (for chase strength)
///   cell_flags — bitfield: bit0=do_flock, bit1=do_pred (encoded as f32)
///
/// Spatial grid: flat_grid (indices into cell arrays), bucket_offsets, bucket_sizes
///   grid is gw*gh buckets; bucket_offsets[b] = start index in flat_grid, bucket_sizes[b] = count
///
/// Output: out array, 8 floats per cell:
///   [flockX, flockY, fleeX, fleeY, chaseX, chaseY, nFlockNear, unused]
#[wasm_bindgen]
pub fn batch_neighbor_forces(
    cell_x: &Float32Array,
    cell_y: &Float32Array,
    cell_vx: &Float32Array,
    cell_vy: &Float32Array,
    cell_clade: &Float32Array,
    cell_diet: &Float32Array,
    cell_energy: &Float32Array,
    cell_sense: &Float32Array,
    cell_social: &Float32Array,
    cell_speed: &Float32Array,
    cell_flags: &Float32Array,
    flat_grid: &Float32Array,
    bucket_offsets: &Float32Array,
    bucket_sizes: &Float32Array,
    gw: u32, gh: u32,
    world_w: f32, world_h: f32,
    pop_scale: f32,
    search_radius_cells: u32,
    out: Float32Array,
) -> Float32Array {
    let n = cell_x.length();
    let gwu = gw as usize;
    let ghu = gh as usize;
    let half_w = world_w * 0.5;
    let half_h = world_h * 0.5;
    let inv_w = gw as f32 / world_w;
    let inv_h = gh as f32 / world_h;
    let sr = search_radius_cells as i32;

    for i in 0..n {
        let flags = cell_flags.get_index(i) as u32;
        let do_flock = (flags & 1) != 0;
        let do_pred = (flags & 2) != 0;
        if !do_flock && !do_pred {
            let oi = i * 8;
            for k in 0..8u32 { out.set_index(oi + k, 0.0); }
            continue;
        }

        let cx = cell_x.get_index(i);
        let cy = cell_y.get_index(i);
        let my_clade = cell_clade.get_index(i);
        let my_diet = cell_diet.get_index(i);
        let my_energy = cell_energy.get_index(i);
        let my_sense = cell_sense.get_index(i);
        let my_social = cell_social.get_index(i);
        let my_speed = cell_speed.get_index(i);

        // Flocking params
        let is_herb = my_diet < 0.4;
        let is_carn = my_diet > 0.6;
        let herd_drive = if is_herb { 0.3 + my_social * 0.7 }
                         else if is_carn { my_social * 0.6 }
                         else { my_social * 0.4 };
        let flock_r = if is_herb { 20.0 + my_social * 25.0 } else { 12.0 + my_social * 15.0 };
        let flock_r = flock_r * pop_scale;
        let flock_r2 = flock_r * flock_r;
        let comfort_r = if is_herb { 3.0 + my_social * 2.0 } else { 5.0 + my_social * 4.0 };
        let comfort_r2 = comfort_r * comfort_r;

        // PredAI params
        let pred_r = (my_sense * 2.5 + 4.0) * 1.2;
        let pred_r2 = pred_r * pred_r;

        let max_r2 = if flock_r2 > pred_r2 { flock_r2 } else { pred_r2 };

        let mut coh_x: f32 = 0.0; let mut coh_y: f32 = 0.0;
        let mut sep_x: f32 = 0.0; let mut sep_y: f32 = 0.0;
        let mut ali_x: f32 = 0.0; let mut ali_y: f32 = 0.0;
        let mut n_near: f32 = 0.0;
        let mut flee_x: f32 = 0.0; let mut flee_y: f32 = 0.0;
        let mut chase_x: f32 = 0.0; let mut chase_y: f32 = 0.0;

        let bx = ((cx * inv_w) as i32).max(0).min(gw as i32 - 1);
        let by = ((cy * inv_h) as i32).max(0).min(gh as i32 - 1);

        for oy in -sr..=sr {
            for ox in -sr..=sr {
                let gx = ((bx + ox) % gw as i32 + gw as i32) as usize % gwu;
                let gy = ((by + oy) % gh as i32 + gh as i32) as usize % ghu;
                let bi = gx + gy * gwu;
                let boff = bucket_offsets.get_index(bi as u32) as usize;
                let bsz = bucket_sizes.get_index(bi as u32) as usize;

                for k in 0..bsz {
                    let j = flat_grid.get_index((boff + k) as u32) as u32;
                    if j == i as u32 { continue; }

                    let ox2 = cell_x.get_index(j);
                    let oy2 = cell_y.get_index(j);
                    let mut ddx = ox2 - cx;
                    let mut ddy = oy2 - cy;
                    // Torus wrap
                    if ddx > half_w { ddx -= world_w; } else if ddx < -half_w { ddx += world_w; }
                    if ddy > half_h { ddy -= world_h; } else if ddy < -half_h { ddy += world_h; }
                    let d2 = ddx * ddx + ddy * ddy;
                    if d2 > max_r2 || d2 < 0.01 { continue; }

                    let other_clade = cell_clade.get_index(j);
                    let same_clade = (other_clade - my_clade).abs() < 0.5;

                    // Flocking: same clade only
                    if do_flock && same_clade && d2 <= flock_r2 && herd_drive > 0.1 {
                        let dist = d2.sqrt();
                        let inv_dist = 1.0 / dist;
                        let nx = ddx * inv_dist;
                        let ny = ddy * inv_dist;
                        n_near += 1.0;
                        // Cohesion
                        let coh_str = (dist - comfort_r).max(0.0) / flock_r;
                        coh_x += nx * coh_str;
                        coh_y += ny * coh_str;
                        // Separation
                        if d2 < comfort_r2 {
                            let sep_str = (comfort_r - dist) / comfort_r;
                            sep_x -= nx * sep_str;
                            sep_y -= ny * sep_str;
                        }
                        // Alignment
                        ali_x += cell_vx.get_index(j);
                        ali_y += cell_vy.get_index(j);
                    }

                    // Predator-prey: different clade only
                    if do_pred && !same_clade && d2 <= pred_r2 {
                        let dist = d2.sqrt();
                        let inv_dist = 1.0 / dist;
                        let nx = ddx * inv_dist;
                        let ny = ddy * inv_dist;
                        let other_diet = cell_diet.get_index(j);
                        let other_energy = cell_energy.get_index(j);

                        // FLEE
                        if my_diet < 0.5 && other_diet > 0.5 {
                            let threat = other_diet * other_energy * 0.5;
                            let urgency = 1.0 / (1.0 + dist * 0.15);
                            let flee_str = threat * urgency * (1.0 - my_diet) * my_sense;
                            flee_x -= nx * flee_str;
                            flee_y -= ny * flee_str;
                        }
                        // CHASE
                        if my_diet > 0.4 && other_energy < my_energy * 1.5 {
                            let prey_val = (1.0 - other_diet) * other_energy * 0.3;
                            let prox = 1.0 / (1.0 + dist * 0.1);
                            let chase_str = prey_val * prox * my_diet * my_speed;
                            chase_x += nx * chase_str;
                            chase_y += ny * chase_str;
                        }
                    }
                }
            }
        }

        // Apply flocking normalization
        if n_near > 0.5 && do_flock && herd_drive > 0.1 {
            let inv = 1.0 / n_near;
            let ali_len = (ali_x * ali_x + ali_y * ali_y).sqrt().max(1.0);
            let ali_str = if is_carn { 0.2 } else { 0.1 };
            let fx = coh_x * inv * herd_drive * 0.5
                   + sep_x * inv * herd_drive * 0.35
                   + (ali_x / ali_len) * herd_drive * ali_str;
            let fy = coh_y * inv * herd_drive * 0.5
                   + sep_y * inv * herd_drive * 0.35
                   + (ali_y / ali_len) * herd_drive * ali_str;
            let oi = i * 8;
            out.set_index(oi, fx);
            out.set_index(oi + 1, fy);
        } else {
            let oi = i * 8;
            out.set_index(oi, 0.0);
            out.set_index(oi + 1, 0.0);
        }

        let oi = i * 8;
        out.set_index(oi + 2, flee_x);
        out.set_index(oi + 3, flee_y);
        out.set_index(oi + 4, chase_x);
        out.set_index(oi + 5, chase_y);
        out.set_index(oi + 6, n_near);
        out.set_index(oi + 7, 0.0);
    }
    out
}

/// Batch metabolism + mechanism maintenance costs for all cells.
/// Computes total energy cost per cell from metabolism, organelle maintenance,
/// and all evolved mechanism costs.
///
/// Input per cell (flat arrays, length n):
///   cell_speed, cell_metabolism — organelle-modified stats
///   cell_membrane, cell_spines, cell_flipper, cell_cilia
///   cell_flagella, cell_jet, cell_amoeboid
///   cell_toxin, cell_spike, cell_constrict, cell_camo, cell_toxresist
///   cell_organelle_sum — sum of all organelle levels
///
/// Output: out array (length n) — total energy cost per cell
#[wasm_bindgen]
pub fn batch_energy_costs(
    cell_speed: &Float32Array,
    cell_metabolism: &Float32Array,
    cell_membrane: &Float32Array,
    cell_spines: &Float32Array,
    cell_flipper: &Float32Array,
    cell_cilia: &Float32Array,
    cell_flagella: &Float32Array,
    cell_jet: &Float32Array,
    cell_amoeboid: &Float32Array,
    cell_toxin: &Float32Array,
    cell_spike: &Float32Array,
    cell_constrict: &Float32Array,
    cell_camo: &Float32Array,
    cell_toxresist: &Float32Array,
    cell_organelle_sum: &Float32Array,
    metabolism_base: f32,
    dt: f32,
    out: Float32Array,
) -> Float32Array {
    let n = cell_speed.length();
    for i in 0..n {
        let speed = cell_speed.get_index(i);
        let metabolism = cell_metabolism.get_index(i);

        // Base metabolism
        let mut cost = metabolism_base * metabolism * (1.0 + 0.7 * speed) * dt;

        // Mechanism maintenance costs
        cost += cell_spines.get_index(i) * 0.002;
        cost += cell_flipper.get_index(i) * 0.001;
        cost += cell_cilia.get_index(i) * 0.0008;
        cost += cell_flagella.get_index(i) * 0.0012;
        cost += cell_jet.get_index(i) * 0.002;
        cost += cell_amoeboid.get_index(i) * 0.0003;
        cost += cell_toxin.get_index(i) * 0.0015;
        cost += cell_spike.get_index(i) * 0.001;
        cost += cell_constrict.get_index(i) * 0.0008;
        cost += cell_camo.get_index(i) * 0.001;
        cost += cell_toxresist.get_index(i) * 0.0005;
        cost += cell_membrane.get_index(i) * 0.0; // membrane has no extra cost beyond drag

        // Organelle maintenance
        cost += cell_organelle_sum.get_index(i) * 0.0005;

        out.set_index(i, cost);
    }
    out
}
