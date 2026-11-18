// city.js - builds Neon Harbor itself: the street grid, the buildings with their neon,
// the park, the plaza, the dock with its crane and containers, and the water with the
// last boat out. Everything is placed from the seeded rng, so a seed always raises the
// same city. The function also reports the facts the rest of the game needs: building
// colliders, parked-car spots, sidewalk loops for pedestrians, and the named places
// the mission chain visits.

import {
  BLOCK, ROAD, PITCH, COLS, ROWS, xs, zs,
  CITY_W, CITY_D, DOCK_D, WATER_Z, WORLD_D,
} from './config.js';
import { makeRng, range, intRange, pick, chance } from './random.js';

const NEON = [0xff2e88, 0x00e5ff, 0xffaa00, 0x7cff00, 0xb967ff, 0xff5252, 0x00ffb3];
const FACADE = [0x2a2f3a, 0x333a45, 0x272b33, 0x3a3040, 0x2e3a38, 0x40332a];

export const PARK_BLOCK = { i: 3, j: 1 };
export const PLAZA_BLOCK = { i: 1, j: 3 };

/** A canvas texture of a tower facade: dark wall, a grid of windows, some lit warm. */
function facadeTexture(THREE, rng, baseColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 240; y += 18) {
    for (let x = 10; x < 118; x += 18) {
      const lit = rng();
      if (lit > 0.55) g.fillStyle = lit > 0.9 ? '#9be8ff' : '#ffd98a';
      else g.fillStyle = '#12151c';
      g.fillRect(x, y, 11, 12);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(THREE, w, h, d, color, x, y, z, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, ...opts });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export function buildWorld(THREE, seed) {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  const colliders = []; // {minX, maxX, minZ, maxZ} solid footprints
  const solid = (cx, cz, w, d) => {
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  };

  // ---- ground, streets, water -------------------------------------------------
  const ground = box(THREE, CITY_W + 60, 0.2, WORLD_D + 60, 0x14161c, CITY_W / 2, -0.11, WORLD_D / 2);
  group.add(ground);
  const roadMat = { color: 0x232830 };
  for (const x of xs) group.add(box(THREE, ROAD, 0.06, CITY_D, roadMat.color, x, 0.02, CITY_D / 2));
  for (const z of zs) group.add(box(THREE, CITY_W, 0.06, ROAD, roadMat.color, CITY_W / 2, 0.02, z));
  // centre dashes
  const dashMat = { color: 0x8a8f7a, emissive: 0x44442e };
  for (const x of xs) {
    for (let z = 8; z < CITY_D - 6; z += 10) group.add(box(THREE, 0.35, 0.02, 3.4, dashMat.color, x, 0.06, z, { emissive: dashMat.emissive }));
  }
  // dock strip and water
  group.add(box(THREE, CITY_W + 60, 0.5, DOCK_D, 0x2c2c30, CITY_W / 2, 0.05, CITY_D + DOCK_D / 2));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_W + 220, 120),
    new THREE.MeshLambertMaterial({ color: 0x07303e, emissive: 0x02181f }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(CITY_W / 2, -0.35, WATER_Z + 55);
  group.add(water);
  // the pier the last boat leaves from, reaching into the water at the west street
  group.add(box(THREE, 6, 0.5, 44, 0x3a332a, xs[0], 0.05, WATER_Z + 18));

  // ---- blocks: buildings, park, plaza ----------------------------------------
  const facades = [];
  for (let v = 0; v < 4; v += 1) facades.push(facadeTexture(THREE, rng, pick(rng, ['#232833', '#2b3038', '#26222e', '#2e2a24'])));

  const parkRect = {
    minX: xs[PARK_BLOCK.i] + ROAD / 2, maxX: xs[PARK_BLOCK.i] + ROAD / 2 + BLOCK,
    minZ: zs[PARK_BLOCK.j] + ROAD / 2, maxZ: zs[PARK_BLOCK.j] + ROAD / 2 + BLOCK,
  };
  const plazaRect = {
    minX: xs[PLAZA_BLOCK.i] + ROAD / 2, maxX: xs[PLAZA_BLOCK.i] + ROAD / 2 + BLOCK,
    minZ: zs[PLAZA_BLOCK.j] + ROAD / 2, maxZ: zs[PLAZA_BLOCK.j] + ROAD / 2 + BLOCK,
  };

  for (let i = 0; i < COLS; i += 1) {
    for (let j = 0; j < ROWS; j += 1) {
      const bx = xs[i] + ROAD / 2; // block west edge
      const bz = zs[j] + ROAD / 2;
      if (i === PARK_BLOCK.i && j === PARK_BLOCK.j) {
        group.add(box(THREE, BLOCK, 0.14, BLOCK, 0x1d4023, bx + BLOCK / 2, 0.05, bz + BLOCK / 2));
        for (let t = 0; t < 9; t += 1) {
          const tx = bx + range(rng, 6, BLOCK - 6);
          const tz = bz + range(rng, 6, BLOCK - 6);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0x4a3421 }));
          trunk.position.set(tx, 1.7, tz);
          const crown = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 2.6, 4), 8, 6), new THREE.MeshLambertMaterial({ color: 0x2c6e31 }));
          crown.position.set(tx, 5, tz);
          group.add(trunk, crown);
          solid(tx, tz, 1.1, 1.1);
        }
        continue;
      }
      if (i === PLAZA_BLOCK.i && j === PLAZA_BLOCK.j) {
        group.add(box(THREE, BLOCK, 0.14, BLOCK, 0x35322e, bx + BLOCK / 2, 0.05, bz + BLOCK / 2));
        const fountain = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 1, 14), new THREE.MeshLambertMaterial({ color: 0x3d6e7d, emissive: 0x0a2e3a }));
        fountain.position.set(bx + BLOCK / 2, 0.5, bz + BLOCK / 2);
        group.add(fountain);
        solid(bx + BLOCK / 2, bz + BLOCK / 2, 11, 11);
        continue;
      }
      // ordinary block: 2-4 towers standing in it with alleys between them
      const plots = intRange(rng, 2, 4);
      for (let p = 0; p < plots; p += 1) {
        const w = range(rng, 16, 24);
        const d = range(rng, 16, 24);
        const h = range(rng, 14, 52);
        const cx = bx + (p % 2 === 0 ? range(rng, w / 2 + 3, BLOCK / 2 - 2) : range(rng, BLOCK / 2 + 2, BLOCK - w / 2 - 3));
        const cz = bz + (p < 2 ? range(rng, d / 2 + 3, BLOCK / 2 - 2) : range(rng, BLOCK / 2 + 2, BLOCK - d / 2 - 3));
        const tower = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshLambertMaterial({ map: pick(rng, facades), color: 0xffffff }),
        );
        tower.position.set(cx, h / 2, cz);
        group.add(tower);
        solid(cx, cz, w, d);
        // a neon sign on a street face, most blocks get one
        if (chance(rng, 0.75)) {
          const color = pick(rng, NEON);
          const sign = box(THREE, range(rng, 6, 11), 1.6, 0.4, color, cx, range(rng, 6, Math.min(h - 2, 20)), cz - d / 2 - 0.25, { emissive: color });
          group.add(sign);
        }
        // rooftop block
        group.add(box(THREE, w * 0.4, 1.6, d * 0.4, 0x1c1f26, cx, h + 0.8, cz));
      }
    }
  }

  // ---- street lights ----------------------------------------------------------
  const lampHead = new THREE.SphereGeometry(0.42, 8, 6);
  for (const x of xs) {
    for (let j = 0; j < ROWS; j += 1) {
      const z = zs[j] + PITCH / 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.4, 5), new THREE.MeshLambertMaterial({ color: 0x3c414c }));
      pole.position.set(x + ROAD / 2 + 0.8, 3.2, z);
      const head = new THREE.Mesh(lampHead, new THREE.MeshLambertMaterial({ color: 0xffd9a0, emissive: 0xffb45e }));
      head.position.set(x + ROAD / 2 + 0.8, 6.5, z);
      group.add(pole, head);
    }
  }

  // ---- the dock: crane, container yard, the boat ------------------------------
  const cranePos = { x: xs[2], z: CITY_D + 12 };
  const craneMat = { color: 0xb8860b };
  for (const dx of [-7, 7]) {
    group.add(box(THREE, 1.4, 24, 1.4, craneMat.color, cranePos.x + dx, 12, cranePos.z));
    solid(cranePos.x + dx, cranePos.z, 1.6, 1.6);
  }
  group.add(box(THREE, 17, 1.6, 1.8, craneMat.color, cranePos.x, 24, cranePos.z));
  group.add(box(THREE, 1, 7, 1, craneMat.color, cranePos.x + 3, 20, cranePos.z));

  const containerColors = [0xa63d2a, 0x2a6ea6, 0x3f9e4d, 0xb8860b, 0x7d4fa6];
  const yard = { minX: CITY_W * 0.58, maxX: CITY_W - 24, minZ: CITY_D + 4, maxZ: CITY_D + DOCK_D - 3 };
  for (let c = 0; c < 14; c += 1) {
    const cx = range(rng, yard.minX + 7, yard.maxX - 7);
    const cz = range(rng, yard.minZ + 3, yard.maxZ - 3);
    const level = chance(rng, 0.4) ? 2 : 1;
    for (let l = 0; l < level; l += 1) {
      group.add(box(THREE, 12, 2.6, 2.6, pick(rng, containerColors), cx, 1.3 + l * 2.6, cz));
    }
    solid(cx, cz, 12.4, 3);
  }
  const cratePos = { x: yard.minX + 12, z: yard.minZ + 6 };

  const boatPos = { x: xs[0], z: WATER_Z + 34 };
  const boat = new THREE.Group();
  const hull = box(THREE, 7, 2.6, 20, 0xd8d3c8, 0, 0.6, 0);
  const cabin = box(THREE, 5, 3, 6, 0x2a6ea6, 0, 3.4, -3);
  const funnel = box(THREE, 1.6, 2.6, 1.6, 0xff2e88, 0, 4.4, 2.5, { emissive: 0x881544 });
  boat.add(hull, cabin, funnel);
  boat.position.set(boatPos.x, 0, boatPos.z);
  group.add(boat);

  // ---- gameplay facts -----------------------------------------------------------
  // Parked cars hug the kerbs: on a north-south street they sit at its east or west
  // edge pointing along it; on an east-west street the same, turned.
  const parkedSpots = [];
  for (let i = 0; i <= COLS; i += 1) {
    for (let j = 0; j < ROWS; j += 1) {
      if (!chance(rng, 0.62)) continue;
      const along = zs[j] + range(rng, 16, PITCH - 16);
      const side = chance(rng, 0.5) ? 1 : -1;
      parkedSpots.push({
        x: xs[i] + side * (ROAD / 2 - 1.7), z: along,
        heading: side > 0 ? Math.PI : 0, vertical: true,
      });
    }
  }
  for (let j = 0; j <= ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      if (!chance(rng, 0.5)) continue;
      const along = xs[i] + range(rng, 16, PITCH - 16);
      const side = chance(rng, 0.5) ? 1 : -1;
      parkedSpots.push({
        x: along, z: zs[j] + side * (ROAD / 2 - 1.7),
        heading: side > 0 ? -Math.PI / 2 : Math.PI / 2, vertical: false,
      });
    }
  }

  // Sidewalk loops: one rectangle per block, inset to the pavement, for pedestrians.
  const sidewalkLoops = [];
  for (let i = 0; i < COLS; i += 1) {
    for (let j = 0; j < ROWS; j += 1) {
      const bx = xs[i] + ROAD / 2;
      const bz = zs[j] + ROAD / 2;
      const inset = 2.2;
      sidewalkLoops.push([
        { x: bx + inset, z: bz + inset },
        { x: bx + BLOCK - inset, z: bz + inset },
        { x: bx + BLOCK - inset, z: bz + BLOCK - inset },
        { x: bx + inset, z: bz + BLOCK - inset },
      ]);
    }
  }

  return {
    group,
    colliders,
    parkedSpots,
    sidewalkLoops,
    parkRect,
    plazaRect,
    cranePos,
    cratePos,
    boatPos,
    hideoutPos: { x: xs[COLS] - 4, z: zs[ROWS - 1] + 4 },
    spawnPoint: { x: plazaRect.minX + 10, z: plazaRect.maxZ - 8 },
    stealSpotIndex: 0, // missions.js picks the parked spot nearest the plaza instead
  };
}

/** True when the circle at (x, z) with radius r overlaps any solid footprint. */
export function hitsCollider(world, x, z, r) {
  for (const c of world.colliders) {
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  }
  return false;
}

/** Push a position out of any collider it overlaps; returns the corrected [x, z]. */
export function slideOut(world, x, z, r) {
  for (const c of world.colliders) {
    if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) {
      const pushWest = x + r - c.minX;
      const pushEast = c.maxX - (x - r);
      const pushNorth = z + r - c.minZ;
      const pushSouth = c.maxZ - (z - r);
      const smallest = Math.min(pushWest, pushEast, pushNorth, pushSouth);
      if (smallest === pushWest) x = c.minX - r;
      else if (smallest === pushEast) x = c.maxX + r;
      else if (smallest === pushNorth) z = c.minZ - r;
      else z = c.maxZ + r;
    }
  }
  return [x, z];
}
