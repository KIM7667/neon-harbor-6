// vehicles.js - the cars of Neon Harbor: how one looks, how one drives, how the
// traffic fleet follows the street grid on its own, and how a police cruiser hunts.
// A Car is plain data plus a three.js group; the game steps them all from main.js.

import { CAR, POLICE, TRAFFIC, xs, zs, COLS, ROWS } from './config.js';
import { range, pick, chance } from './random.js';
import { slideOut } from './city.js';

export const CAR_COLORS = [0xc23b2e, 0x2e6ec2, 0xd8d3c8, 0x3f9e4d, 0xe0a51f, 0x7d4fa6, 0x30343c, 0x2ec4b6];
export const STEAL_COUPE_COLOR = 0x12b5a5; // the teal coupe Sal points you at

const LANE = 3.6; // lane offset from a street centre, right-hand traffic

/** Build the three.js group for a car. Heading 0 faces +z (south). */
export function makeCarMesh(THREE, color, isPolice = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.72, CAR.length), paint);
  body.position.y = 0.58;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(CAR.width * 0.82, 0.6, CAR.length * 0.48),
    new THREE.MeshLambertMaterial({ color: 0x141a22 }),
  );
  cabin.position.set(0, 1.2, -0.2);
  group.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0d10 });
  for (const [wx, wz] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
  }
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xccaa44 });
  for (const side of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), lampMat);
    lamp.position.set(side, 0.62, CAR.length / 2 + 0.02);
    group.add(lamp);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.16, 0.08),
      new THREE.MeshLambertMaterial({ color: 0xaa1622, emissive: 0x55060c }),
    );
    tail.position.set(side, 0.66, -CAR.length / 2 - 0.02);
    group.add(tail);
  }
  if (isPolice) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xff2233, emissive: 0xff2233 }),
    );
    red.position.x = -0.3;
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2255ff, emissive: 0x2255ff }),
    );
    blue.position.x = 0.3;
    bar.add(red, blue);
    bar.position.set(0, 1.62, -0.2);
    bar.name = 'lightbar';
    group.add(bar);
  }
  return group;
}

let nextCarId = 1;

export class Car {
  constructor(THREE, x, z, heading, color, kind) {
    this.id = nextCarId;
    nextCarId += 1;
    this.kind = kind; // 'parked' | 'traffic' | 'police'
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.health = CAR.health;
    this.color = color;
    this.occupied = false; // the player is driving it
    this.wrecked = false;
    this.hitCooldown = 0;
    this.mesh = makeCarMesh(THREE, color, kind === 'police');
    this.syncMesh();
    // traffic route state
    this.axis = null;
    this.street = 0;
    this.dir = 1;
    this.target = null;
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  get pos() {
    return { x: this.x, z: this.z };
  }
}

/** Lane centre coordinate for a car travelling on `street` in direction `dir`. */
function laneCoord(axis, street, dir) {
  if (axis === 'v') return xs[street] + (dir > 0 ? -LANE : LANE); // southbound west lane, northbound east
  return zs[street] + (dir > 0 ? LANE : -LANE); // eastbound south lane, westbound north
}

/** Put a traffic car on a random street leg with a first target intersection. */
export function routeTraffic(car, rng) {
  car.axis = chance(rng, 0.5) ? 'v' : 'h';
  car.street = Math.floor(range(rng, 0, (car.axis === 'v' ? COLS : ROWS) + 1));
  car.dir = chance(rng, 0.5) ? 1 : -1;
  const crossMax = car.axis === 'v' ? ROWS : COLS;
  car.cross = Math.floor(range(rng, 0, crossMax + 1));
  if (car.axis === 'v') {
    car.x = laneCoord('v', car.street, car.dir);
    car.z = (car.axis === 'v' ? zs : xs)[car.cross];
  } else {
    car.z = laneCoord('h', car.street, car.dir);
    car.x = xs[car.cross];
  }
  car.heading = car.axis === 'v' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  pickNextTarget(car, rng, true);
}

/** Choose the point the car steers for: the next intersection along its leg. */
function pickNextTarget(car, rng, first = false) {
  const crossMax = car.axis === 'v' ? ROWS : COLS;
  if (!first) {
    // arriving at an intersection: maybe turn onto the crossing street
    const atEdge = car.cross <= 0 || car.cross >= crossMax;
    const mustTurn = (car.cross <= 0 && car.dir < 0) || (car.cross >= crossMax && car.dir > 0);
    if ((atEdge && chance(rng, 0.5)) || mustTurn || chance(rng, 0.3)) {
      const oldAxis = car.axis;
      const oldStreet = car.street;
      car.axis = oldAxis === 'v' ? 'h' : 'v';
      car.street = car.cross; // the crossing street becomes the street we drive on
      car.cross = oldStreet; // and the street we were on becomes the crossing index
      car.dir = chance(rng, 0.5) ? 1 : -1;
      // at the map edge, never aim out of the world
      const newCrossMax = car.axis === 'v' ? ROWS : COLS;
      if (car.cross <= 0) car.dir = 1;
      if (car.cross >= newCrossMax) car.dir = -1;
    }
  }
  const nextCross = car.cross + car.dir;
  const clamped = Math.max(0, Math.min(car.axis === 'v' ? ROWS : COLS, nextCross));
  if (car.axis === 'v') car.target = { x: laneCoord('v', car.street, car.dir), z: zs[clamped] };
  else car.target = { x: xs[clamped], z: laneCoord('h', car.street, car.dir) };
  car.targetCross = clamped;
}

/** Step one traffic car: steer for its target intersection, roll, repeat. */
export function stepTraffic(car, dt, rng, world, blocked) {
  if (car.wrecked || car.occupied) return;
  const dx = car.target.x - car.x;
  const dz = car.target.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 3) {
    car.cross = car.targetCross;
    pickNextTarget(car, rng);
  }
  const wanted = Math.atan2(dx, dz);
  car.heading = turnToward(car.heading, wanted, 2.4 * dt);
  const speed = blocked ? 0 : TRAFFIC.speed;
  car.speed += (speed - car.speed) * Math.min(1, dt * 2.5);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const [sx, sz] = slideOut(world, car.x, car.z, CAR.radius);
  car.x = sx;
  car.z = sz;
  car.syncMesh();
}

/** Step the player-driven car from input: {throttle -1..1, steer -1..1, handbrake}. */
export function stepDriven(car, dt, input, world) {
  const handbrake = input.handbrake ? 1 : 0;
  if (input.throttle > 0) car.speed += CAR.accel * input.throttle * dt * (car.speed < 0 ? 2.2 : 1);
  if (input.throttle < 0) {
    if (car.speed > 0.5) car.speed -= CAR.brake * dt; // braking
    else car.speed += CAR.accel * 0.55 * input.throttle * dt; // reverse
  }
  car.speed -= car.speed * CAR.drag * dt * (handbrake ? 3.2 : 1);
  car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));
  if (Math.abs(car.speed) < 0.04 && input.throttle === 0) car.speed = 0;
  const grip = Math.min(1, Math.abs(car.speed) / 7);
  car.heading += input.steer * CAR.turnRate * grip * dt * (car.speed < 0 ? -1 : 1) * (handbrake ? 1.5 : 1);
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const [sx, sz] = slideOut(world, nx, nz, CAR.radius);
  if ((sx !== nx || sz !== nz) && Math.abs(car.speed) > 6) {
    car.hitIntensity = Math.min(1, Math.abs(car.speed) / CAR.maxSpeed);
    car.speed *= -0.22;
  } else {
    car.hitIntensity = 0;
  }
  car.x = sx;
  car.z = sz;
  car.syncMesh();
}

/** Step a police cruiser hunting the target point. Returns distance to target. */
export function stepPolice(car, dt, target, world) {
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  // aim a little ahead of a moving target so cruisers cut corners like they mean it
  const lead = Math.min(1.2, dist / 40);
  const wanted = Math.atan2(dx + (target.vx || 0) * lead, dz + (target.vz || 0) * lead);
  car.heading = turnToward(car.heading, wanted, 2.1 * dt);
  const top = POLICE.speed * (dist > 60 ? 1.5 : 1);
  car.speed += (top - car.speed) * Math.min(1, dt * 1.4);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const [sx, sz] = slideOut(world, car.x, car.z, CAR.radius);
  if (sx !== car.x || sz !== car.z) car.speed *= 0.55;
  car.x = sx;
  car.z = sz;
  car.syncMesh();
  // lightbar strobes
  const bar = car.mesh.getObjectByName('lightbar');
  if (bar) {
    const phase = Math.floor(performance.now() / 180) % 2;
    bar.children[0].visible = phase === 0;
    bar.children[1].visible = phase === 1;
  }
  return dist;
}

/** Shortest-arc turn of `angle` toward `target`, at most `maxStep` radians. */
export function turnToward(angle, target, maxStep) {
  let diff = target - angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return angle + Math.sign(diff) * maxStep;
}

/** Spawn the parked fleet and the traffic fleet for a fresh world. */
export function spawnFleet(THREE, world, rng) {
  const cars = [];
  const spots = [...world.parkedSpots];
  // the steal target: the parked spot nearest the plaza, painted teal
  let stealIndex = 0;
  let best = Infinity;
  spots.forEach((spot, i) => {
    const d = Math.hypot(spot.x - (world.plazaRect.minX + 28), spot.z - (world.plazaRect.minZ + 28));
    if (d < best) { best = d; stealIndex = i; }
  });
  spots.forEach((spot, i) => {
    if (cars.length >= TRAFFIC.parkedCount && i !== stealIndex) return;
    const isSteal = i === stealIndex;
    const car = new Car(THREE, spot.x, spot.z, spot.heading, isSteal ? STEAL_COUPE_COLOR : pick(rng, CAR_COLORS), 'parked');
    car.isStealTarget = isSteal;
    cars.push(car);
  });
  for (let i = 0; i < TRAFFIC.count; i += 1) {
    const car = new Car(THREE, 0, 0, 0, pick(rng, CAR_COLORS), 'traffic');
    routeTraffic(car, rng);
    car.syncMesh();
    cars.push(car);
  }
  return cars;
}
