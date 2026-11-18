// people.js - the Harbor's pedestrians and the Vulture thugs of the turf mission.
// A person is a low-poly walker (legs, torso, head) with a plain-data state: which
// sidewalk loop they pace, where they are headed, whether they are fleeing, and -
// for Vultures - whether they are coming for the player.

import { PED } from './config.js';
import { range, pick } from './random.js';
import { slideOut } from './city.js';

const SHIRTS = [0xd95f43, 0x4378d9, 0xe3c04f, 0x9b59b6, 0x4fb286, 0xd9d9d9, 0x51606e, 0xff7f9e];
const SKIN = [0xe8b98d, 0xc68863, 0x8d5524, 0xf1c27d];

export function makePersonMesh(THREE, shirtColor, hostile = false) {
  const group = new THREE.Group();
  const legMat = new THREE.MeshLambertMaterial({ color: 0x22242c });
  for (const side of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), legMat);
    leg.position.set(side, 0.4, 0);
    group.add(leg);
  }
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.72, 0.34),
    new THREE.MeshLambertMaterial({ color: shirtColor }),
  );
  torso.position.y = 1.16;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 8, 6),
    new THREE.MeshLambertMaterial({ color: pick(Math.random, SKIN) }),
  );
  head.position.y = 1.78;
  group.add(torso, head);
  if (hostile) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.24, 0.12, 8),
      new THREE.MeshLambertMaterial({ color: 0x14161c }),
    );
    cap.position.y = 1.94;
    group.add(cap);
  }
  return group;
}

let nextPersonId = 1;

export class Person {
  constructor(THREE, x, z, loop, rng, hostile = false) {
    this.id = nextPersonId;
    nextPersonId += 1;
    this.x = x;
    this.z = z;
    this.heading = range(rng, 0, Math.PI * 2);
    this.loop = loop; // array of waypoints, or null for a posted thug
    this.waypoint = 0;
    this.hostile = hostile;
    this.health = hostile ? 70 : PED.health;
    this.down = false;
    this.fleeFrom = null;
    this.fleeTime = 0;
    this.attackCooldown = 0;
    this.post = { x, z };
    this.phase = range(rng, 0, Math.PI * 2); // leg-swing phase
    this.mesh = makePersonMesh(THREE, hostile ? 0x8e2323 : pick(rng, SHIRTS), hostile);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, this.down ? -0.55 : 0, this.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = this.down ? Math.PI / 2.2 : 0;
  }

  hurt(amount) {
    if (this.down) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.down = true;
      this.syncMesh();
      return true; // went down with this hit
    }
    return false;
  }

  scare(from, seconds = 4) {
    if (this.down || this.hostile) return;
    this.fleeFrom = { x: from.x, z: from.z };
    this.fleeTime = seconds;
  }
}

/** Step a peaceful pedestrian: pace the loop, or run from trouble. */
export function stepPed(person, dt, world) {
  if (person.down) return;
  person.phase += dt * (person.fleeTime > 0 ? 11 : 6);
  let speed = PED.walkSpeed;
  let tx;
  let tz;
  if (person.fleeTime > 0) {
    person.fleeTime -= dt;
    speed = PED.fleeSpeed;
    tx = person.x + (person.x - person.fleeFrom.x);
    tz = person.z + (person.z - person.fleeFrom.z);
  } else if (person.loop) {
    const wp = person.loop[person.waypoint];
    tx = wp.x;
    tz = wp.z;
    if (Math.hypot(tx - person.x, tz - person.z) < 1.2) {
      person.waypoint = (person.waypoint + 1) % person.loop.length;
      return;
    }
  } else {
    return;
  }
  const dx = tx - person.x;
  const dz = tz - person.z;
  const dist = Math.hypot(dx, dz) || 1;
  person.heading = Math.atan2(dx, dz);
  const nx = person.x + (dx / dist) * speed * dt;
  const nz = person.z + (dz / dist) * speed * dt;
  const [sx, sz] = slideOut(world, nx, nz, 0.5);
  person.x = sx;
  person.z = sz;
  person.mesh.children[0].position.y = 0.4 + Math.abs(Math.sin(person.phase)) * 0.07;
  person.mesh.children[1].position.y = 0.4 + Math.abs(Math.cos(person.phase)) * 0.07;
  person.syncMesh();
}

/**
 * Step a Vulture thug. Chases the player inside aggro range and swings on a cooldown.
 * Returns 'hit' on the step where a swing lands, so main.js can apply damage.
 */
export function stepThug(person, dt, world, playerPos) {
  if (person.down) return null;
  person.attackCooldown = Math.max(0, person.attackCooldown - dt);
  const dx = playerPos.x - person.x;
  const dz = playerPos.z - person.z;
  const dist = Math.hypot(dx, dz);
  let result = null;
  if (dist < 26) {
    person.heading = Math.atan2(dx, dz);
    if (dist > 1.7) {
      const speed = 3.9;
      const nx = person.x + (dx / dist) * speed * dt;
      const nz = person.z + (dz / dist) * speed * dt;
      const [sx, sz] = slideOut(world, nx, nz, 0.5);
      person.x = sx;
      person.z = sz;
      person.phase += dt * 10;
    } else if (person.attackCooldown <= 0) {
      person.attackCooldown = 0.9;
      result = 'hit';
    }
  } else {
    // drift back to the corner they were leaning on
    const px = person.post.x - person.x;
    const pz = person.post.z - person.z;
    const pd = Math.hypot(px, pz);
    if (pd > 0.6) {
      person.x += (px / pd) * 1.4 * dt;
      person.z += (pz / pd) * 1.4 * dt;
      person.heading = Math.atan2(px, pz);
    }
  }
  person.syncMesh();
  return result;
}

/** Spawn the crowd: one or two walkers per sidewalk loop, spread by the rng. */
export function spawnCrowd(THREE, world, rng) {
  const people = [];
  const loops = world.sidewalkLoops;
  for (let n = 0; n < PED.count; n += 1) {
    const loop = loops[Math.floor(range(rng, 0, loops.length))];
    const start = loop[Math.floor(range(rng, 0, loop.length))];
    const person = new Person(THREE, start.x, start.z, loop, rng);
    person.waypoint = Math.floor(range(rng, 0, loop.length));
    people.push(person);
  }
  return people;
}

/** The three Vultures waiting at the park for the turf mission. */
export function spawnThugs(THREE, world, rng) {
  const thugs = [];
  const { parkRect } = world;
  const spots = [
    { x: parkRect.minX + 16, z: parkRect.minZ + 18 },
    { x: parkRect.minX + 30, z: parkRect.minZ + 26 },
    { x: parkRect.minX + 22, z: parkRect.minZ + 38 },
  ];
  for (const spot of spots) thugs.push(new Person(THREE, spot.x, spot.z, null, rng, true));
  return thugs;
}
