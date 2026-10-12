// Copyright (c) Meta Platforms, Inc. and affiliates.
// Adapted from muse-gadget-sdk/esp32/avatar/muse_pixel.c (Apache-2.0).
// Source and character-rights notice: docs/avatar-attribution.md.
// Procedural 64x64 rendering only; no image/video assets.
export const AVATAR_MODES = ['boot','idle','listening','thinking','speaking','error','off'];
export function createPixelAvatar() {
const dimRGB={r:0,g:0,b:0};
// Copyright (c) Meta Platforms, Inc. and affiliates.

const C_BG = 0, C_OUT = 1, C_OUT2 = 2, C_BD = 3, C_BM = 4, C_BL = 5, C_BH = 6, C_RIM = 7, C_SKIND = 8, C_SKIN = 9, C_SKINL = 10, C_IRIS = 11, C_SHINE = 12, C_BROW = 13, C_BLUSH = 14, C_BLUSHD = 15, C_MOUTH = 16, C_TONGUE = 17, C_G0 = 18, C_G1 = 19, C_G2 = 20, C_G3 = 21, C_AURA1 = 22, C_AURA2 = 23, C_SPK = 24, C_ACC = 25, C_SHADOW = 26, C_HEART = 27, C_WHITE = 28, C_COUNT = 29;

const W = 64, H = 64, TAU = 6.2831853;
const MUSE_MODE_BOOT=0, MUSE_MODE_IDLE=1, MUSE_MODE_LISTENING=2,
      MUSE_MODE_THINKING=3, MUSE_MODE_SPEAKING=4, MUSE_MODE_ERROR=5,
      MUSE_MODE_OFF=6, MUSE_MODE_COUNT=7;
const SCHEMES = [
 {f:[0xffffff,0xcfe0ff,0x8fa8ff,0x5a5fe0],acc:0xa9c0ff},
 {f:[0xf4e8ff,0xc7a4ff,0x9a6bff,0x5b3fd9],acc:0xa77dff},
 {f:[0xe8faff,0x8fdcff,0x3fa2ff,0x2a5bd7],acc:0x5cb8ff},
 {f:[0xffe6ff,0xff9cf0,0xd35bff,0x7a2bd9],acc:0xe07bff},
 {f:[0xeafff4,0x9ff5cf,0x3fd9a0,0x1f9a7a],acc:0x6ff0bf},
 {f:[0xffd6d6,0xff6b6b,0xc7304a,0x6b1a3a],acc:0xff5c5c},
 {f:[0xd8d4ff,0x8f86d9,0x5a4fb0,0x2e2870],acc:0x7c72d0}
];
const FIXED = new Uint32Array(C_COUNT);
FIXED[C_BG] = 0x000000;
FIXED[C_OUT] = 0x3a2b22;
FIXED[C_OUT2] = 0x8c7560;
FIXED[C_BD] = 0xae987e;
FIXED[C_BM] = 0xcfbc9f;
FIXED[C_BL] = 0xe6d7bd;
FIXED[C_BH] = 0xf8eedc;
FIXED[C_SKIND] = 0xe9cba4;
FIXED[C_SKIN] = 0xf6dfbd;
FIXED[C_SKINL] = 0xfdeed6;
FIXED[C_IRIS] = 0x120d0b;
FIXED[C_SHINE] = 0xffffff;
FIXED[C_BROW] = 0x6b5444;
FIXED[C_BLUSH] = 0xf4aaa0;
FIXED[C_BLUSHD] = 0xea8f8e;
FIXED[C_MOUTH] = 0x3a1f1a;
FIXED[C_TONGUE] = 0xe86a7a;
FIXED[C_SHADOW] = 0x16101f;
FIXED[C_HEART] = 0xff4f8b;
FIXED[C_WHITE] = 0xffffff;
const s_scheme = Array.from({length:5},()=>({r:0,g:0,b:0}));
let s_scheme_init=false;
const s_pal=new Uint16Array(C_COUNT), s_pal_dim=new Uint16Array(C_COUNT);
const s_fb=new Uint8Array(W*H), s_mask=new Uint8Array(W*H);
const BAYER4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
const Q=12, ONE=1<<Q, QF=v=>Math.trunc(v*ONE);
const POW_LUT_N=256, POW_LUT_MAX_Q=QF(1.2), SQRT_LUT_N=1024;
const s_pow_dome=new Int16Array(POW_LUT_N+1), s_pow_base=new Int16Array(POW_LUT_N+1), s_sqrt=new Int16Array(SQRT_LUT_N+1);
for(let i=0;i<=POW_LUT_N;i++){
 const u=i*POW_LUT_MAX_Q/POW_LUT_N/ONE;
 s_pow_dome[i]=Math.pow(u,2.7)*ONE; s_pow_base[i]=Math.pow(u,3.6)*ONE;
}
for(let i=0;i<=SQRT_LUT_N;i++)s_sqrt[i]=Math.sqrt(i/SQRT_LUT_N)*ONE;
const tgt=Array.from({length:5},()=>({r:0,g:0,b:0}));
const pal=Array.from({length:C_COUNT},()=>({r:0,g:0,b:0}));
const scratch={ux:0,lx:0,ly:0};
const row={}, arm_q=[{},{}], foot_q=[{},{}], arms=[{},{ }], feet=[{},{}], j={};
function pow_q(lut, a) {
    return lut[(a * (Math.trunc(POW_LUT_N * 65536 / POW_LUT_MAX_Q))) >> 16];
}

function sqrt_q(x) {
    return s_sqrt[x >> 2];
}

function bayer_q(x, y) {
    return BAYER4[y & 3][x & 3] * (ONE / 16) + ONE / 32;
}

function bayer(x, y) {
    return (BAYER4[y & 3][x & 3] + 0.5) / 16.0;
}

function hex_rgb(c, out) {
    out.r=(c>>16)&255; out.g=(c>>8)&255; out.b=c&255; return out;
}

function mix(a, b, t, out) {
    out.r=a.r+(b.r-a.r)*t; out.g=a.g+(b.g-a.g)*t; out.b=a.b+(b.b-a.b)*t; return out;
}

function scale_rgb(a, k, out) {
    out.r=a.r*k; out.g=a.g*k; out.b=a.b*k; return out;
}

function to565(c) {
    let r = Math.trunc(c.r + 0.5), g = Math.trunc(c.g + 0.5), b = Math.trunc(c.b + 0.5);
    r = r < 0 ? 0 : (r > 255 ? 255 : r);
    g = g < 0 ? 0 : (g > 255 ? 255 : g);
    b = b < 0 ? 0 : (b > 255 ? 255 : b);
    return Math.trunc(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

function muse_pixel_accent(mode) {
    return SCHEMES[mode < MUSE_MODE_COUNT ? mode : MUSE_MODE_IDLE].acc;
}

function update_palette(target, dt) {
    
    for (let i = 0; i < 4; i++) {
        tgt[i] = hex_rgb(target.f[i],tgt[i]);
    }
    tgt[4] = hex_rgb(target.acc,tgt[4]);

    let k = s_scheme_init ? 1.0 - Math.exp(-dt * 7.0) : 1.0;
    for (let i = 0; i < 5; i++) {
        s_scheme[i] = mix(s_scheme[i], tgt[i], k,s_scheme[i]);
    }
    s_scheme_init = true;

    for (let i = 0; i < C_COUNT; i++) {
        pal[i] = hex_rgb(FIXED[i],pal[i]);
    }
    let acc = s_scheme[4];
    Object.assign(pal[C_G0], s_scheme[0]);
    Object.assign(pal[C_G1], s_scheme[1]);
    Object.assign(pal[C_G2], s_scheme[2]);
    Object.assign(pal[C_G3], s_scheme[3]);
    Object.assign(pal[C_ACC], acc);
    pal[C_RIM] = mix(pal[C_BL], acc, 0.45,pal[C_RIM]);
    pal[C_AURA1] = scale_rgb(acc, 0.16,pal[C_AURA1]);
    pal[C_AURA2] = scale_rgb(acc, 0.34,pal[C_AURA2]);
    pal[C_SPK] = mix(acc, pal[C_WHITE], 0.45,pal[C_SPK]);

    for (let i = 0; i < C_COUNT; i++) {
        s_pal[i] = to565(pal[i]);
        
        s_pal_dim[i] = to565(scale_rgb(pal[i], 0.72,dimRGB));
    }
}

function px(x, y, c) {
    if ((x >>> 0) < W && (y >>> 0) < H) {
        s_fb[y * W + x] = c;
    }
}

function get_px(x, y) {
    if ((x >>> 0) < W && (y >>> 0) < H) {
        return s_fb[y * W + x];
    }
    return C_BG;
}

function iround(v) {
    return Math.floor(v + 0.5);
}

function clampf(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function fracf(v) {
    return v - Math.floor(v);
}

let s_rng = 0x9e3779b9;
function frand() {
    s_rng ^= s_rng << 13;
    s_rng ^= s_rng >>> 17;
    s_rng ^= s_rng << 5;
    return (s_rng & 0xffffff) / (0x1000000);
}

function stamp(rows, nrows, x0, y0, fill, alt) {
    for (let r = 0; r < nrows; r++) {
        for (let c = 0; rows[r][c]; c++) {
            let ch = rows[r][c];
            if (ch == '#') {
                px(x0 + c, y0 + r, fill);
            } else if (ch == 'o') {
                px(x0 + c, y0 + r, alt);
            }
        }
    }
}

const s_eyes = {next_blink:1.5,blink_start:-10,next_gaze:1,gx:0,gy:0,tgx:0,tgy:0,last_t:0};

function eyes_update(p, dt) {
    let e = s_eyes;

    if (p.t >= e.next_blink) {
        e.blink_start = p.t;
        
        e.next_blink = p.t + (frand() < 0.2 ? 0.28 : 2.2 + frand() * 3.0);
    }

    if (p.t >= e.next_gaze) {
        e.next_gaze = p.t + 1.2 + frand() * 2.4;
        if (frand() < 0.35) {
            e.tgx = 0;
            e.tgy = 0;
        } else {
            e.tgx = frand() * 2 - 1;
            e.tgy = (frand() * 2 - 1) * 0.6;
        }
    }

    let tgx = e.tgx, tgy = e.tgy;
    switch (p.mode) {
    case MUSE_MODE_LISTENING:
        tgx = 0;
        tgy = 0.1;
        break;
    case MUSE_MODE_THINKING:
        tgx = 0.75 * Math.sin(p.mode_t * 1.3) + 0.25;
        tgy = -0.85;
        break;
    case MUSE_MODE_SPEAKING:
        tgx *= 0.3;
        tgy = 0;
        break;
    default:
        break;
    }
    let k = 1.0 - Math.exp(-dt * 14.0);
    e.gx += (tgx - e.gx) * k;
    e.gy += (tgy - e.gy) * k;

    let bt = (p.t - e.blink_start) / 0.16;
    if (bt < 0 || bt > 1) {
        return 0;
    }
    return 1.0 - Math.abs(bt * 2 - 1);
}

function draw_aura(cx, cy, radius, strength) {
    let x0 = Math.trunc(cx - radius - 1), x1 = Math.trunc(cx + radius + 1);
    let y0 = Math.trunc(cy - radius - 1), y1 = Math.trunc(cy + radius + 1);
    
    let cx16 = Math.trunc(cx * 16), r2 = Math.trunc(radius * radius * 256);
    let to_idx = Math.trunc((SQRT_LUT_N) * 65536 / r2);
    let str = QF(strength);
    for (let y = y0; y <= y1; y++) {
        let dy = Math.trunc((y + 0.5 - cy) * 1.1 * 16);
        let dy2 = dy * dy;
        if (dy2 >= r2) {
            continue;
        }
        for (let x = x0; x <= x1; x++) {
            let dx = x * 16 + 8 - cx16;
            let d2 = dx * dx + dy2;
            if (d2 >= r2) {
                continue;
            }
            let i = ((ONE - s_sqrt[(d2 * to_idx) >> 16]) * str) >> Q;
            let b = bayer_q(x, y);
            if (i > QF(0.55) + ((b * QF(0.35)) >> Q)) {
                px(x, y, C_AURA2);
            } else if (i > (b * QF(0.9)) >> Q) {
                px(x, y, C_AURA1);
            }
        }
    }
}

function draw_rings(cx, cy, t, level, speed) {
    for (let k = 0; k < 2; k++) {
        let ph = fracf(t * speed + k * 0.5);
        let r = 20 + ph * 11;
        let fade = (1 - ph) * (0.35 + level);
        let n = Math.trunc(r * 2.2);
        for (let i = 0; i < n; i++) {
            let a = i * TAU / n;
            let x = iround(cx + Math.cos(a) * r);
            let y = iround(cy + Math.sin(a) * r * 0.92);
            if (get_px(x, y) == C_BG || get_px(x, y) == C_AURA1) {
                if (bayer(x, y) < fade) {
                    px(x, y, fade > 0.6 ? C_ACC : C_AURA2);
                }
            }
        }
    }
}

function draw_shadow(cx, y, half_w) {
    for (let row = 0; row < 3; row++) {
        let hw = half_w * (row == 1 ? 1.0 : 0.72);
        for (let x = iround(cx - hw); x <= iround(cx + hw); x++) {
            let edge = Math.abs(x + 0.5 - cx) / hw;
            if (bayer(x, Math.trunc(y) + row) > edge * 0.8) {
                px(x, Math.trunc(y) + row, C_SHADOW);
            }
        }
    }
}

function hash16(x, y) {
    let h = (Math.imul(x,374761393) + Math.imul(y,668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13),1274126177) >>> 0;
    return (h ^ (h >>> 16)) & 0xffff;
}

function row_setup(j, y, r) {
    let v = (y - j.cy) / j.b;
    let a = j.a * (1 + 0.07 * clampf(v, -1, 1));   
    r.v = QF(v);
    r.inv_a = QF(1.0 / a);
    r.lut = v < 0 ? s_pow_dome : s_pow_base;
    r.body = Math.abs(r.v) <= POW_LUT_MAX_Q;
    r.v_pow = r.body ? pow_q(r.lut, Math.abs(r.v)) : 0;
    let fv = clampf((y - j.fy) / j.fb, -8, 8);
    r.fv = QF(fv);
    r.fv4 = QF(Math.min(fv * fv * fv * fv, 16));
}

function body_field(r, dx, scratch) {
    let u = (dx * r.inv_a) >> Q;
    scratch.ux = u;
    if (!r.body || Math.abs(u) > POW_LUT_MAX_Q) {
        return 2 * ONE;
    }
    return pow_q(r.lut, Math.abs(u)) + r.v_pow;
}

function fur(nx, ny, x, y, ox, oy) {
    let r2 = (nx * nx + ny * ny) >> Q;
    let nz = r2 >= ONE ? 0 : sqrt_q(ONE - r2);
    let l = (-QF(0.40) * nx - QF(0.50) * ny + QF(0.76) * nz) >> Q;
    let b = bayer_q(x, y);
    let rx = x - ox, ry = y - oy;
    let streak = (hash16(rx, Math.trunc((ry + (rx & 1) * 2) / 3)) >> 4) - ONE / 2;
    let lv = l + (((b - ONE / 2) * QF(0.2)) >> Q) + ((streak * QF(0.22)) >> Q);
    if (r2 > QF(0.86) && ((nx * QF(0.6) + ny * QF(0.8)) >> Q) > QF(0.72) && b < QF(0.4)) {
        return C_RIM;
    }
    return lv > QF(0.95) ? C_BH : lv > QF(0.62) ? C_BL : lv > QF(0.28) ? C_BM : C_BD;
}

function limb_setup(l, rx, ry, q) {
    q.x = QF(l.x);
    q.y = QF(l.y);
    q.c = QF(Math.cos(l.angle));
    q.s = QF(Math.sin(l.angle));
    q.inv_rx = QF(1.0 / rx);
    q.inv_ry = QF(1.0 / ry);
    q.r = QF(rx > ry ? rx : ry);
}

function in_limb(l, x, y, scratch) {
    let dx = x - l.x, dy = y - l.y;
    if (Math.abs(dx) > l.r || Math.abs(dy) > l.r) {
        return false;
    }
    let u = ((((dx * l.c) >> Q) + ((dy * l.s) >> Q)) * l.inv_rx) >> Q;
    let v = ((((dy * l.c) >> Q) - ((dx * l.s) >> Q)) * l.inv_ry) >> Q;
    scratch.lx = u;
    scratch.ly = v;
    return u * u + v * v <= ONE * ONE;
}

const M_NONE = 0, M_BODY = 1, M_ARM = 2, M_FOOT = 3, M_FACE = 4;

function draw_avatar(j, arms, feet) {
    s_mask.fill(0);
    
    for (let i = 0; i < 2; i++) {
        limb_setup(arms[i], 2.9, 5.2, arm_q[i]);
        limb_setup(feet[i], 4.4, 2.6, foot_q[i]);
    }
    
    let x0 = Math.trunc(j.cx - j.a * 1.1 - 8), x1 = Math.trunc(j.cx + j.a * 1.1 + 8);
    let y0 = Math.trunc(j.cy - j.b - 8), y1 = Math.trunc(j.cy + j.b + 5);
    x0 = x0 < 0 ? 0 : x0;
    y0 = y0 < 0 ? 0 : y0;
    x1 = x1 >= W ? W - 1 : x1;
    y1 = y1 >= H ? H - 1 : y1;
    let ox = iround(j.cx), oy = iround(j.cy);
    let cx = QF(j.cx), fcx = QF(j.fx), inv_fa = QF(1.0 / j.fa);

    for (let y = y0; y <= y1; y++) {
        
        row_setup(j, y + 0.5, row);
        let fy = y * ONE + ONE / 2;
        for (let x = x0; x <= x1; x++) {
            let fx = x * ONE + ONE / 2;

            let arm = false;
            for (let a = 0; a < 2 && !arm; a++) {
                if (in_limb(arm_q[a], fx, fy, scratch)) {
                    s_mask[y * W + x] = M_ARM;
                    let nx = ((scratch.lx * QF(0.85)) >> Q) + (a ? QF(0.25) : -QF(0.25));
                    px(x, y, fur(nx, (scratch.ly * QF(0.8)) >> Q, x, y, ox, oy));
                    arm = true;
                }
            }
            if (arm) {
                continue;
            }

            let uy = row.v;
            let v = body_field(row, fx - cx, scratch);
            
            let tuft = ((hash16(x - ox, y - oy) - 32768) * QF(0.16)) >> 16;
            if (v <= ONE + tuft) {
                let fu = ((fx - fcx) * inv_fa) >> Q;
                fu = fu > 3 * ONE ? 3 * ONE : fu < -3 * ONE ? -3 * ONE : fu;
                let fu2 = (fu * fu) >> Q;
                let ff = ((fu2 * fu2) >> Q) + row.fv4;
                let b = bayer_q(x, y);
                if (ff <= ONE) {
                    s_mask[y * W + x] = M_FACE;
                    let fv = row.fv, fv1 = fv + QF(0.15);
                    let c = C_SKIN;
                    if (fv < -QF(0.55) && b < ((-fv - QF(0.45)) * QF(1.8)) >> Q) {
                        c = C_SKIND;   
                    } else if (((fu2 * QF(1.4)) >> Q) + ((fv1 * fv1) >> Q) < QF(0.32) && b < QF(0.55)) {
                        c = C_SKINL;
                    } else if (fv > QF(0.75) && b < QF(0.4)) {
                        c = C_SKIND;
                    }
                    px(x, y, c);
                } else {
                    s_mask[y * W + x] = M_BODY;
                    
                    if (ff < QF(1.75) && (ff < QF(1.3) || b < ((QF(1.75) - ff) * QF(1.4)) >> Q)) {
                        px(x, y, ff < QF(1.3) ? C_OUT2 : C_BD);
                    } else {
                        px(x, y, fur((scratch.ux * QF(0.95)) >> Q, (uy * QF(0.95)) >> Q, x, y, ox, oy));
                    }
                }
                continue;
            }

            for (let f = 0; f < 2; f++) {
                if (in_limb(foot_q[f], fx, fy, scratch)) {
                    s_mask[y * W + x] = M_FOOT;
                    px(x, y, scratch.ly < -QF(0.2) ? C_BM : C_BD);
                    break;
                }
            }
        }
    }

    const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let m = s_mask[y * W + x];
            if (m == M_NONE || m == M_FACE) {
                continue;
            }
            for (let k = 0; k < 4; k++) {
                let xx = x + N4[k][0], yy = y + N4[k][1];
                let n = ((xx >>> 0) < W && (yy >>> 0) < H) ? s_mask[yy * W + xx] : M_NONE;
                if (n == M_NONE || (m == M_ARM && (n == M_BODY || n == M_FACE)) || (m == M_BODY && n == M_FOOT)) {
                    px(x, y, C_OUT);
                    break;
                }
            }
        }
    }
}

const EYES_NORMAL = 0, EYES_WIDE = 1, EYES_HAPPY = 2, EYES_X = 3;

function draw_eye(ex, ey, openness, style, gx, gy) {
    let cx = iround(ex + gx * 0.8), cy = iround(ey + gy * 0.7);

    if (style == EYES_HAPPY) {
        const HAPPY = [ ".##.", "#..#" ];
        stamp(HAPPY, 2, iround(ex) - 2, iround(ey), C_IRIS, C_IRIS);
        return;
    }
    if (style == EYES_X) {
        const XS = [ "#..#", ".##.", ".##.", "#..#" ];
        stamp(XS, 4, iround(ex) - 2, iround(ey) - 1, C_IRIS, C_IRIS);
        return;
    }
    if (openness < 0.3) {
        const SHUT = [ "#..#", ".##." ];
        stamp(SHUT, 2, iround(ex) - 2, iround(ey) + 1, C_IRIS, C_IRIS);
        return;
    }

    const BEAD = [ ".##.", "#o##", "####", ".##." ];
    const BIG = [ ".##.", "#o##", "#o##", "####", ".##." ];
    let rows = style == EYES_WIDE ? BIG : BEAD;
    let n = style == EYES_WIDE ? 5 : 4;
    
    let skip = iround((1 - openness) * (n - 1));
    stamp(rows.slice(skip), n - skip, cx - 2, cy - 2 + skip, C_IRIS, skip ? C_IRIS : C_SHINE);
}

function draw_blush(x, y, strength) {
    const CHEEK = [ ".##.", "####", ".##." ];
    for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 4; i++) {
            if (CHEEK[j][i] != '#') {
                continue;
            }
            let b = bayer(x + i, y + j);
            if (b < strength) {
                px(x - 2 + i, y + j, (j == 1 && b < strength * 0.5) ? C_BLUSHD : C_BLUSH);
            }
        }
    }
}

const MOUTH_SMILE = 0, MOUTH_O = 1, MOUTH_HMM = 2, MOUTH_TALK = 3, MOUTH_GRIN = 4, MOUTH_FLAT = 5;

function draw_mouth(x, y, m, open) {
    switch (m) {
    case MOUTH_SMILE: {
        const S = [ "#..#", ".##." ];
        stamp(S, 2, x - 2, y, C_MOUTH, C_MOUTH);
        break;
    }
    case MOUTH_O: {
        const S = [ ".##.", "#oo#", ".##." ];
        stamp(S, 3, x - 2, y - 1, C_MOUTH, C_TONGUE);
        break;
    }
    case MOUTH_HMM: {
        const S = [ "..#", "##." ];
        stamp(S, 2, x - 1, y, C_MOUTH, C_MOUTH);
        break;
    }
    case MOUTH_TALK: {
        let h = 1 + iround(clampf(open, 0, 1) * 3.0);
        let w = h > 2 ? 4 : 3;
        for (let j = 0; j < h; j++) {
            let inset = (j == 0 || j == h - 1) && h > 2 ? 1 : 0;
            for (let i = inset; i < w - inset; i++) {
                let tongue = h >= 3 && j == h - 2 && i > inset && i < w - inset - 1;
                px(x - Math.trunc(w / 2) + i, y + j, tongue ? C_TONGUE : C_MOUTH);
            }
        }
        break;
    }
    case MOUTH_GRIN: {
        const S = [ "#####", ".#o#.", "..#.." ];
        stamp(S, 3, x - 2, y, C_MOUTH, C_TONGUE);
        break;
    }
    case MOUTH_FLAT: {
        const S = [ "##" ];
        stamp(S, 1, x - 1, y + 1, C_MOUTH, C_MOUTH);
        break;
    }
    }
}

function draw_sparkle(x, y, twinkle, front) {
    let arm = front ? C_ACC : C_AURA2;
    let core = front ? C_WHITE : C_SPK;
    if (twinkle > 0.8) {
        px(x, y, core);
        for (let k = 1; k <= 2; k++) {
            let c = k == 1 ? (front ? C_SPK : arm) : arm;
            px(x + k, y, c);
            px(x - k, y, c);
            px(x, y + k, c);
            px(x, y - k, c);
        }
    } else if (twinkle > 0.45) {
        px(x, y, front ? C_SPK : arm);
        px(x + 1, y, arm);
        px(x - 1, y, arm);
        px(x, y + 1, arm);
        px(x, y - 1, arm);
    } else if (twinkle > 0.15) {
        px(x, y, arm);
    }
}

function draw_sparkles(p, cx, cy, front, speed, count) {
    for (let i = 0; i < count; i++) {
        let a = p.t * speed + i * TAU / count;
        let s = Math.sin(a);
        if ((s > 0) != front) {
            continue;
        }
        let rr = 25.0 + 2.0 * Math.sin(i * 1.9 + p.t * 0.7);
        let x = iround(cx + Math.cos(a) * rr);
        let y = iround(cy - 3 + s * rr * 0.42);
        let tw = 0.5 + 0.5 * Math.sin(p.t * 5.0 + i * 1.7);
        draw_sparkle(x, y, tw, front);
    }
}

function draw_waves(cx, cy, body_rx, level, t) {
    let n = 1 + Math.trunc(clampf(level, 0, 1) * 3.2);
    if (n > 3) {
        n = 3;
    }
    for (let k = 0; k < n; k++) {
        let r = body_rx + 5.0 + k * 3.0;
        let span = 2 + k;
        let flick = 0.5 + 0.5 * Math.sin(t * 12.0 - k * 1.4);
        for (let side = -1; side <= 1; side += 2) {
            for (let j = -span; j <= span; j++) {
                let xo = r - (j * j) / (2.0 * r) * 3.0;
                let x = iround(cx + side * xo);
                let y = iround(cy - 2 + j);
                if (k == 0 || bayer(x, y) < 0.35 + flick * 0.65) {
                    px(x, y, k == 0 ? C_ACC : (k == 1 ? C_G1 : C_G2));
                }
            }
        }
    }
}

function draw_thought_dots(x, y, t) {
    let active = Math.trunc(fracf(t * 1.6) * 3.0);
    for (let i = 0; i < 3; i++) {
        let bx = iround(x + i * 4);
        let by = iround(y - i * 3) - (i == active ? 1 : 0);
        let c = i == active ? C_G0 : C_ACC;
        px(bx, by, c);
        px(bx + 1, by, c);
        px(bx, by + 1, c);
        px(bx + 1, by + 1, i == active ? C_G1 : C_G2);
    }
}

function draw_hearts(cx, top, t, amount) {
    const HEART = [ ".#.#.", "#o###", "#####", ".###.", "..#.." ];
    for (let i = 0; i < 2; i++) {
        let ph = fracf(t * 0.9 + i * 0.5);
        if (ph > amount) {
            continue;
        }
        let hx = iround(cx + (i ? 13 : -18) + Math.sin(ph * TAU + i) * 2);
        let hy = iround(top - ph * 10);
        stamp(HEART, 5, hx, hy, C_HEART, C_WHITE);
    }
}

function draw_alert(x, y) {
    const BANG = [ ".##.", ".##.", ".##.", ".##.", "....", ".##." ];
    stamp(BANG, 6, x - 2, y, C_ACC, C_ACC);
}

function muse_pixel_render(p) {

    let dt = s_eyes.last_t > 0 ? clampf(p.t - s_eyes.last_t, 0, 0.2) : 0.04;
    s_eyes.last_t = p.t;

    let mode = p.mode;
    
    let fade = mode == MUSE_MODE_OFF ? clampf(1.0 - p.mode_t / 1.3, 0, 1) : 1.0;
    let happy = p.happy;
    let level = p.level;
    let t = p.t;

    update_palette(SCHEMES[mode], dt);
    let blink = eyes_update(p, dt);

    s_fb.fill(C_BG);

    let bob, breathe_rate = 2.0, lean = 0, hop = 0;
    switch (mode) {
    case MUSE_MODE_LISTENING:
        bob = Math.sin(t * 3.0) * 0.6;
        break;
    case MUSE_MODE_THINKING:
        bob = Math.sin(t * 2.4) * 0.8;
        lean = Math.sin(t * 1.3) * 1.2;
        break;
    case MUSE_MODE_SPEAKING:
        bob = Math.sin(t * 5.0) * 0.6 - level * 1.5;
        break;
    case MUSE_MODE_ERROR:
        bob = 1.0;
        lean = Math.sin(t * 18.0) * (p.mode_t < 0.6 ? 1.0 : 0.0);
        break;
    default:
        bob = Math.sin(t * 1.8) * 1.0;
        break;
    }
    if (happy > 0) {
        hop = Math.abs(Math.sin(t * 9.0)) * 3.0 * happy;
    }

    let boot = mode == MUSE_MODE_BOOT ? clampf(p.mode_t / 1.4, 0, 1) : 1.0;
    let pop = mode == MUSE_MODE_BOOT ? clampf(p.mode_t / 0.6, 0, 1) : 1.0;
    let squash = 1.0 - (1.0 - pop) * 0.35 + Math.sin(pop * 3.1416) * 0.06;

    let breathe = Math.sin(t * breathe_rate + 1.0) * 0.03;
    
    j.a = 16.0 * (1 + breathe) * (2.0 - squash) + level * 0.8;
    j.b = 23.0 * (1 - breathe) * squash;
    j.cx = 32.0 + lean;
    j.cy = 56.5 - j.b + bob * 0.5 - hop;   
    j.fa = j.a * 0.66;
    j.fb = 7.4 * squash;
    j.fx = j.cx + lean * 0.3;
    j.fy = j.cy - j.b * 0.30 + bob * 0.3;

    let aura_r = 29.0 + level * 4.0 + Math.sin(t * 1.5) * 1.0;
    let aura_s = (0.75 * boot + level * 0.4) * fade;
    draw_aura(j.cx, j.cy - 3, aura_r, aura_s);
    if (mode == MUSE_MODE_LISTENING) {
        draw_rings(j.cx, j.fy + 2, t, level, 0.9);
    } else if (mode == MUSE_MODE_SPEAKING) {
        draw_rings(j.cx, j.fy + 2, t, level, 0.6);
    }
    draw_shadow(j.cx, 58.5, 13.0 - hop * 0.8);

    let spk_speed = mode == MUSE_MODE_THINKING ? 2.8 : mode == MUSE_MODE_LISTENING ? 1.2
                    : mode == MUSE_MODE_SPEAKING ? 1.5 : 0.6;
    let spk_count = mode == MUSE_MODE_BOOT ? Math.trunc(boot * 6) : Math.trunc(6 * fade);
    draw_sparkles(p, j.cx, j.cy, false, spk_speed, spk_count);

    let base = j.cy + j.b;
    
    let step = mode == MUSE_MODE_SPEAKING ? Math.sin(t * 5.0) * 0.6 : 0.0;
    Object.assign(feet[0], {x: j.cx - 7.0, y: base - 0.5 + (happy > 0 ? hop * 0.3 : step), angle: -0.15});
    Object.assign(feet[1], {x: j.cx + 7.0, y: base - 0.5 + (happy > 0 ? hop * 0.3 : -step), angle: 0.15});

    let adx = j.a + 0.3;
    let ay = j.cy + 4.0;
    switch (mode) {
    case MUSE_MODE_LISTENING:
        
        Object.assign(arms[0], {x: j.cx - adx + 1.0, y: j.fy + 5.0, angle: 0.55});
        Object.assign(arms[1], {x: j.cx + adx - 1.0, y: j.fy + 5.0, angle: -0.55});
        break;
    case MUSE_MODE_THINKING:
        
        Object.assign(arms[0], {x: j.cx - adx, y: ay, angle: -0.35});
        Object.assign(arms[1], {x: j.cx + 7.5, y: j.fy + j.fb + 3.5, angle: -1.1});
        break;
    case MUSE_MODE_OFF: {
        let w = Math.sin(t * 12.0) * 0.35 * fade;
        Object.assign(arms[0], {x: j.cx - adx, y: ay, angle: -0.3});
        Object.assign(arms[1], {x: j.cx + adx + 1.0, y: j.cy - 4.0, angle: -2.3 - w});
        break;
    }
    case MUSE_MODE_SPEAKING: {
        let w = Math.sin(t * 7.0) * (0.25 + level * 0.45);
        Object.assign(arms[0], {x: j.cx - adx, y: ay - 1.0, angle: -0.4 - w});
        Object.assign(arms[1], {x: j.cx + adx, y: ay - 1.0, angle: 0.4 - w});
        break;
    }
    default: {
        let sway = Math.sin(t * 1.8 + 0.6) * 0.08;
        if (happy > 0) {
            
            let wig = Math.sin(t * 14.0) * 0.25;
            Object.assign(arms[0], {x: j.cx - adx - 1.0, y: j.cy - 4.0, angle: 2.4 + wig});
            Object.assign(arms[1], {x: j.cx + adx + 1.0, y: j.cy - 4.0, angle: -2.4 - wig});
        } else {
            Object.assign(arms[0], {x: j.cx - adx, y: ay, angle: -0.3 + sway});
            Object.assign(arms[1], {x: j.cx + adx, y: ay, angle: 0.3 - sway});
        }
        break;
    }
    }
    draw_avatar(j, arms, feet);

    let eye_y = j.fy - 0.5;
    let eye_dx = j.fa * 0.48;
    let style = EYES_NORMAL;
    let open = 1.0 - blink;
    let mouth = MOUTH_SMILE;
    let mouth_open = 0;

    switch (mode) {
    case MUSE_MODE_BOOT:
        open = p.mode_t < 0.9 ? 0.0 : clampf((p.mode_t - 0.9) / 0.3, 0, 1);
        break;
    case MUSE_MODE_LISTENING:
        style = EYES_WIDE;
        mouth = MOUTH_O;
        break;
    case MUSE_MODE_THINKING:
        open *= 0.85;
        mouth = MOUTH_HMM;
        break;
    case MUSE_MODE_SPEAKING:
        mouth = MOUTH_TALK;
        mouth_open = level * 1.3 + 0.1 * (0.5 + 0.5 * Math.sin(t * 22.0));
        break;
    case MUSE_MODE_ERROR:
        style = EYES_X;
        mouth = MOUTH_FLAT;
        break;
    case MUSE_MODE_OFF:
        open = clampf((1.0 - p.mode_t / 1.0) * 1.5, 0, 1);
        mouth = MOUTH_SMILE;
        break;
    default:
        break;
    }
    if (happy > 0.2 && mode != MUSE_MODE_ERROR) {
        style = EYES_HAPPY;
        mouth = MOUTH_GRIN;
    }

    draw_eye(j.fx - eye_dx, eye_y, open, style, s_eyes.gx, s_eyes.gy);
    draw_eye(j.fx + eye_dx, eye_y, open, style, s_eyes.gx, s_eyes.gy);

    let bl = iround(j.fx - eye_dx), br = iround(j.fx + eye_dx), by = iround(eye_y) - 4;
    if (mode == MUSE_MODE_THINKING) {
        px(bl - 1, by + 1, C_BROW); px(bl, by + 1, C_BROW);
        px(br - 1, by, C_BROW); px(br, by - 1, C_BROW);
    } else if (mode == MUSE_MODE_LISTENING) {
        px(bl - 1, by - 1, C_BROW); px(bl, by - 1, C_BROW);
        px(br - 1, by - 1, C_BROW); px(br, by - 1, C_BROW);
    }

    let blush = 0.55 + happy * 0.45 + (mode == MUSE_MODE_SPEAKING ? 0.15 : 0.0);
    draw_blush(iround(j.fx - j.fa * 0.72), iround(eye_y + 2), blush);
    draw_blush(iround(j.fx + j.fa * 0.72), iround(eye_y + 2), blush);

    draw_mouth(iround(j.fx), iround(eye_y + 3), mouth, mouth_open);

    draw_sparkles(p, j.cx, j.cy, true, spk_speed, spk_count);

    let top = j.cy - j.b;
    if (mode == MUSE_MODE_LISTENING || mode == MUSE_MODE_SPEAKING) {
        draw_waves(j.cx, j.fy + 2, j.a, level, t);
    }
    if (mode == MUSE_MODE_THINKING) {
        draw_thought_dots(j.cx + 14, top + 2, t);
    }
    if (happy > 0) {
        draw_hearts(j.cx, top + 1, t, happy);
    }
    if (mode == MUSE_MODE_ERROR) {
        draw_alert(iround(j.cx + 18), iround(top - 1));
    }

}

return {
 render(pose) {
  const mode=AVATAR_MODES.indexOf(pose.mode);
  muse_pixel_render({mode:mode<0?MUSE_MODE_IDLE:mode,t:pose.t,mode_t:pose.modeTime,
   level:clampf(pose.level||0,0,1),happy:clampf(pose.happy||0,0,1)});
  return s_fb;
 },
 // Caller owns and reuses ImageData. Integer scaling preserves sharp pixels.
 writeRGBA(data,size=64,green=true) {
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const c=s_fb[Math.floor(y*H/size)*W+Math.floor(x*W/size)];
   const edge=size>=192&&((Math.floor((x+1)*W/size)!==Math.floor(x*W/size))||
    (Math.floor((y+1)*H/size)!==Math.floor(y*H/size)));
   const rgb=(edge?s_pal_dim:s_pal)[c];
   const r=((rgb>>11)&31)*255/31,g=((rgb>>5)&63)*255/63,b=(rgb&31)*255/31;
   const offset=(y*size+x)*4;
   const luminance=(r*0.2126+g*0.7152+b*0.0722)/255;
   data[offset]=green?Math.round(64*luminance):Math.round(r);
   data[offset+1]=green?Math.round(255*luminance):Math.round(g);
   data[offset+2]=green?Math.round(94*luminance):Math.round(b);
   data[offset+3]=c===C_BG?0:255;
  }
  return data;
 }
};
}
