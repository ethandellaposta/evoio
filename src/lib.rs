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
fn torus_delta(d: f32, size: f32) -> f32 {
    let half = size * 0.5;
    if d > half { d - size } else if d < -half { d + size } else { d }
}

// Exported: food diffusion
#[wasm_bindgen]
#[allow(unused_mut)]
pub fn diffuse_food(mut food: Float32Array, w: u32, h: u32, rate: f32, sample_scale: f32, rng_state: u32) -> Float32Array {
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
pub fn grow_food(mut food: Float32Array, w: u32, h: u32, base: f32, patch: f32, sample_scale: f32, rng_state: u32) -> Float32Array {
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

    let mut out = out;

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
    let mut out = out;

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
