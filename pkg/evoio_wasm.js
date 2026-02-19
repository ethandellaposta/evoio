/* @ts-self-types="./evoio_wasm.d.ts" */

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
 * @param {Float32Array} cell_speed
 * @param {Float32Array} cell_metabolism
 * @param {Float32Array} cell_membrane
 * @param {Float32Array} cell_spines
 * @param {Float32Array} cell_flipper
 * @param {Float32Array} cell_cilia
 * @param {Float32Array} cell_flagella
 * @param {Float32Array} cell_jet
 * @param {Float32Array} cell_amoeboid
 * @param {Float32Array} cell_toxin
 * @param {Float32Array} cell_spike
 * @param {Float32Array} cell_constrict
 * @param {Float32Array} cell_camo
 * @param {Float32Array} cell_toxresist
 * @param {Float32Array} cell_organelle_sum
 * @param {number} metabolism_base
 * @param {number} dt
 * @param {Float32Array} out
 * @returns {Float32Array}
 */
export function batch_energy_costs(cell_speed, cell_metabolism, cell_membrane, cell_spines, cell_flipper, cell_cilia, cell_flagella, cell_jet, cell_amoeboid, cell_toxin, cell_spike, cell_constrict, cell_camo, cell_toxresist, cell_organelle_sum, metabolism_base, dt, out) {
    const ret = wasm.batch_energy_costs(cell_speed, cell_metabolism, cell_membrane, cell_spines, cell_flipper, cell_cilia, cell_flagella, cell_jet, cell_amoeboid, cell_toxin, cell_spike, cell_constrict, cell_camo, cell_toxresist, cell_organelle_sum, metabolism_base, dt, out);
    return ret;
}

/**
 * Batch food drift: shift food values by a global offset with fractional transfer.
 * @param {Float32Array} food
 * @param {number} w
 * @param {number} h
 * @param {number} dx
 * @param {number} dy
 * @param {number} frac
 * @param {number} phase
 * @param {number} stride
 */
export function batch_food_drift(food, w, h, dx, dy, frac, phase, stride) {
    wasm.batch_food_drift(food, w, h, dx, dy, frac, phase, stride);
}

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
 * @param {Float32Array} cell_x
 * @param {Float32Array} cell_y
 * @param {Float32Array} cell_sense
 * @param {Float32Array} cell_diet
 * @param {Float32Array} food
 * @param {Float32Array} mineral
 * @param {Float32Array} meat
 * @param {number} w
 * @param {number} h
 * @param {number} use_full
 * @param {Float32Array} out
 * @returns {Float32Array}
 */
export function batch_food_sense(cell_x, cell_y, cell_sense, cell_diet, food, mineral, meat, w, h, use_full, out) {
    const ret = wasm.batch_food_sense(cell_x, cell_y, cell_sense, cell_diet, food, mineral, meat, w, h, use_full, out);
    return ret;
}

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
 * @param {Float32Array} cell_x
 * @param {Float32Array} cell_y
 * @param {Float32Array} cell_vx
 * @param {Float32Array} cell_vy
 * @param {Float32Array} cell_clade
 * @param {Float32Array} cell_diet
 * @param {Float32Array} cell_energy
 * @param {Float32Array} cell_sense
 * @param {Float32Array} cell_social
 * @param {Float32Array} cell_speed
 * @param {Float32Array} cell_flags
 * @param {Float32Array} flat_grid
 * @param {Float32Array} bucket_offsets
 * @param {Float32Array} bucket_sizes
 * @param {number} gw
 * @param {number} gh
 * @param {number} world_w
 * @param {number} world_h
 * @param {number} pop_scale
 * @param {number} search_radius_cells
 * @param {Float32Array} out
 * @returns {Float32Array}
 */
export function batch_neighbor_forces(cell_x, cell_y, cell_vx, cell_vy, cell_clade, cell_diet, cell_energy, cell_sense, cell_social, cell_speed, cell_flags, flat_grid, bucket_offsets, bucket_sizes, gw, gh, world_w, world_h, pop_scale, search_radius_cells, out) {
    const ret = wasm.batch_neighbor_forces(cell_x, cell_y, cell_vx, cell_vy, cell_clade, cell_diet, cell_energy, cell_sense, cell_social, cell_speed, cell_flags, flat_grid, bucket_offsets, bucket_sizes, gw, gh, world_w, world_h, pop_scale, search_radius_cells, out);
    return ret;
}

/**
 * Batch physics update: apply velocity to position with toroidal wrapping.
 * Replaces the per-cell JS position update loop.
 * @param {Float32Array} pos_x
 * @param {Float32Array} pos_y
 * @param {Float32Array} vel_x
 * @param {Float32Array} vel_y
 * @param {Float32Array} move_amt
 * @param {Float32Array} wx
 * @param {Float32Array} wy
 * @param {number} world_w
 * @param {number} world_h
 * @param {number} damping
 */
export function batch_physics(pos_x, pos_y, vel_x, vel_y, move_amt, wx, wy, world_w, world_h, damping) {
    wasm.batch_physics(pos_x, pos_y, vel_x, vel_y, move_amt, wx, wy, world_w, world_h, damping);
}

/**
 * @param {Float32Array} food
 * @param {number} w
 * @param {number} h
 * @param {number} rate
 * @param {number} sample_scale
 * @param {number} rng_state
 * @returns {Float32Array}
 */
export function diffuse_food(food, w, h, rate, sample_scale, rng_state) {
    const ret = wasm.diffuse_food(food, w, h, rate, sample_scale, rng_state);
    return ret;
}

/**
 * Gas grid diffusion: diffuse O2 and CO2 between adjacent cells.
 * Also replenishes O2 toward ambient and decays CO2.
 * @param {Float32Array} o2_grid
 * @param {Float32Array} co2_grid
 * @param {number} gw
 * @param {number} gh
 * @param {number} o2_diff_rate
 * @param {number} co2_diff_rate
 * @param {number} ambient_o2
 * @param {number} ambient_replenish
 * @param {number} co2_decay
 */
export function gas_grid_diffuse(o2_grid, co2_grid, gw, gh, o2_diff_rate, co2_diff_rate, ambient_o2, ambient_replenish, co2_decay) {
    wasm.gas_grid_diffuse(o2_grid, co2_grid, gw, gh, o2_diff_rate, co2_diff_rate, ambient_o2, ambient_replenish, co2_decay);
}

export function greet() {
    wasm.greet();
}

/**
 * @param {Float32Array} food
 * @param {number} w
 * @param {number} h
 * @param {number} base
 * @param {number} patch
 * @param {number} sample_scale
 * @param {number} rng_state
 * @returns {Float32Array}
 */
export function grow_food(food, w, h, base, patch, sample_scale, rng_state) {
    const ret = wasm.grow_food(food, w, h, base, patch, sample_scale, rng_state);
    return ret;
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_alert_8ff9b14abf933b39: function(arg0, arg1) {
            alert(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_index_80a69050a46aaf91: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_length_9a7876c9728a0979: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_set_index_41955224420ba3c6: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./evoio_wasm_bg.js": import0,
    };
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('evoio_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
