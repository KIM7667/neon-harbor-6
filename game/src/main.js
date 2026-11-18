// main.js - NEON HARBOR's game loop and glue. It builds the scene, owns the player,
// the wanted level and the bust meter, steps traffic, crowds, thugs and cruisers,
// runs combat and the mission chain, works the camera, and exposes window.NEON -
// the scripted API the ?test=1 self-test and the ?shot= screenshot scenes drive.
//
// Modes: 'title' (start screen, the city idles), 'play', 'over' (wasted or busted),
// 'win' (the boat caught). The simulation advances in fixed steps from step(dt), so
// the self-test can run the whole night headlessly, deterministically, at any speed.

import { PLAYER, CAR, POLICE, WANTED, SAVE_KEY, CITY_W, CITY_D, WATER_Z } from './config.js';
import { makeRng } from './random.js';
import { buildWorld, hitsCollider, slideOut } from './city.js';
import { Car, spawnFleet, stepTraffic, stepDriven, stepPolice } from './vehicles.js';
import { spawnCrowd, spawnThugs, stepPed, stepThug } from './people.js';
import { MissionChain } from './missions.js';
import { SoundBank } from './audio.js';
import { Hud } from './hud.js';
import { stageShot } from './shots.js';

const THREE = window.THREE;
const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') || 7) >>> 0;

// ---------------------------------------------------------------- save / load
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.cash !== 'number' || typeof data.index !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: G.cash, index: G.chain.index }));
  } catch { /* storage unavailable: the night just goes unsaved */ }
}

function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

// ---------------------------------------------------------------- scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);
scene.fog = new THREE.FogExp2(0x070b16, 0.0026);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 20, -30);

scene.add(new THREE.HemisphereLight(0x8fb7ff, 0x1a1410, 0.85));
const moon = new THREE.DirectionalLight(0xaac4ff, 0.9);
moon.position.set(120, 180, 60);
scene.add(moon);
const neonGlow = new THREE.PointLight(0xff2e88, 0.7, 260);
neonGlow.position.set(CITY_W / 2, 26, CITY_D / 2);
scene.add(neonGlow);

const hud = new Hud(document);
const sounds = new SoundBank();

// ---------------------------------------------------------------- game state
const G = {
  mode: 'title',
  time: 0,
  world: null,
  worldGroup: null,
  cars: [],
  police: [],
  people: [],
  thugs: [],
  chain: null,
  rng: makeRng(SEED ^ 0x9e3779b9),
  player: null,
  playerCar: null,
  cash: 0,
  stars: 0,
  bust: 0,
  camYaw: Math.PI,
  camPitch: 0.32,
  freeCam: null,
  shotCooldown: 0,
  meleeCooldown: 0,
  lastHurtAt: -99,
  policeSpawnCheck: 0,
  autoInput: null,
  events: [],
};

function makePlayer() {
  const mesh = (() => {
    const group = new THREE.Group();
    const legs = new THREE.MeshLambertMaterial({ color: 0x1d2129 });
    for (const side of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), legs);
      leg.position.set(side, 0.4, 0);
      group.add(leg);
    }
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.72, 0.34),
      new THREE.MeshLambertMaterial({ color: 0xffd23f }),
    );
    torso.position.y = 1.16;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xe8b98d }),
    );
    head.position.y = 1.78;
    group.add(torso, head);
    return group;
  })();
  return {
    x: 0, z: 0, heading: 0, health: PLAYER.health, mesh,
    vx: 0, vz: 0, phase: 0,
  };
}

/** (Re)build the whole world and every actor in it, at the saved progress if any. */
function setupWorld(continueSave) {
  if (G.worldGroup) scene.remove(G.worldGroup);
  G.worldGroup = new THREE.Group();
  scene.add(G.worldGroup);
  const world = buildWorld(THREE, SEED);
  G.world = world;
  G.worldGroup.add(world.group);

  G.cars = spawnFleet(THREE, world, makeRng(SEED ^ 0x51ab));
  for (const car of G.cars) G.worldGroup.add(car.mesh);
  G.police = [];
  G.people = spawnCrowd(THREE, world, makeRng(SEED ^ 0x77cd));
  for (const person of G.people) G.worldGroup.add(person.mesh);
  G.thugs = spawnThugs(THREE, world, makeRng(SEED ^ 0x33ef));
  for (const thug of G.thugs) G.worldGroup.add(thug.mesh);

  const stealCar = G.cars.find((car) => car.isStealTarget);
  G.chain = new MissionChain(world, stealCar);
  G.cash = 0;
  if (continueSave) {
    const save = loadSave();
    if (save) {
      G.cash = save.cash;
      const index = Math.min(save.index, 6);
      G.chain.index = index;
      G.chain.finished = index >= 6;
      G.chain.timer = G.chain.timeLimitFor(index);
    }
  }

  if (!G.player) G.player = makePlayer();
  G.player.x = world.spawnPoint.x;
  G.player.z = world.spawnPoint.z;
  G.player.heading = Math.PI;
  G.player.health = PLAYER.health;
  G.worldGroup.add(G.player.mesh); // re-parents it out of any previous world
  G.playerCar = null;
  G.stars = 0;
  G.bust = 0;
  G.camYaw = Math.PI;
  syncPlayerMesh();

  // the gold beacon that marks the current objective
  if (G.beacon) G.worldGroup.remove(G.beacon);
  G.beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  );
  G.worldGroup.add(G.beacon);
}

function syncPlayerMesh() {
  G.player.mesh.position.set(G.player.x, 0, G.player.z);
  G.player.mesh.rotation.y = G.player.heading;
  G.player.mesh.visible = !G.playerCar;
}

// ---------------------------------------------------------------- crime & harm
function addWanted(amount) {
  G.stars = Math.min(5, Math.max(0, G.stars + amount));
}

function hurtPlayer(amount) {
  if (G.mode !== 'play') return;
  G.player.health -= amount;
  G.lastHurtAt = G.time;
  if (G.player.health <= 0) {
    G.player.health = 0;
    gameOver('wasted');
  }
}

function gameOver(kind) {
  if (G.mode !== 'play') return;
  G.mode = 'over';
  sounds.engineStop();
  sounds.sirenStop();
  sounds.failSting();
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById('over-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  document.getElementById('over-text').textContent = kind === 'busted'
    ? 'The Harbor PD finally got hands on you. Sal will say he never knew your name.'
    : 'The Harbor keeps what it catches. The boat leaves without you.';
  hud.showScreen('screen-over');
}

function victory() {
  G.mode = 'win';
  sounds.engineStop();
  sounds.sirenStop();
  sounds.winJingle();
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById('win-text').textContent =
    `You ran all six of Sal's jobs, ended the night with $${G.cash.toLocaleString('en-US')}, and caught the last boat out. Neon Harbor shrinks behind you.`;
  clearSave();
  hud.showScreen('screen-win');
}

// ---------------------------------------------------------------- entering cars
function nearestEnterableCar() {
  let best = null;
  let bestDist = PLAYER.reach + 0.6;
  for (const car of [...G.cars, ...G.police]) {
    if (car.wrecked || car.occupied) continue;
    if (car.kind === 'police') continue;
    const d = Math.hypot(car.x - G.player.x, car.z - G.player.z);
    if (d < bestDist) { bestDist = d; best = car; }
  }
  return best;
}

function enterCar(car) {
  if (!car || car.wrecked) return false;
  const firstLift = !car.everStolen;
  G.playerCar = car;
  car.occupied = true;
  car.everStolen = true;
  G.camYaw = car.heading;
  if (firstLift) {
    addWanted(WANTED.steal);
    hud.toast('Car lifted. The Harbor PD takes notice.');
  }
  sounds.engineStart();
  syncPlayerMesh();
  return true;
}

function exitCar() {
  const car = G.playerCar;
  if (!car) return;
  car.occupied = false;
  G.playerCar = null;
  // step out beside the driver's door, clear of the car and of walls
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  let px = car.x + sideX * 2.4;
  let pz = car.z + sideZ * 2.4;
  [px, pz] = slideOut(G.world, px, pz, PLAYER.radius);
  G.player.x = px;
  G.player.z = pz;
  G.player.heading = car.heading;
  sounds.engineStop();
  syncPlayerMesh();
}

// ---------------------------------------------------------------- combat
const tracerGeo = () => new THREE.BoxGeometry(0.05, 0.05, 1);
let tracer = null;
let tracerUntil = 0;

function fire() {
  if (G.mode !== 'play' || G.playerCar || G.shotCooldown > 0) return null;
  G.shotCooldown = 0.24;
  sounds.gunshot();
  addWanted(WANTED.shot);
  const fx = Math.sin(G.player.heading);
  const fz = Math.cos(G.player.heading);
  // find the nearest person or car in a cone ahead, within 55 m
  let hit = null;
  let hitDist = 55;
  const candidates = [...G.thugs, ...G.people];
  for (const person of candidates) {
    if (person.down) continue;
    const dx = person.x - G.player.x;
    const dz = person.z - G.player.z;
    const along = dx * fx + dz * fz;
    if (along < 0.5 || along > hitDist) continue;
    const across = Math.abs(dx * fz - dz * fx);
    if (across < 0.9) { hit = { person }; hitDist = along; }
  }
  for (const car of [...G.cars, ...G.police]) {
    if (car === G.playerCar) continue;
    const dx = car.x - G.player.x;
    const dz = car.z - G.player.z;
    const along = dx * fx + dz * fz;
    if (along < 0.5 || along > hitDist) continue;
    const across = Math.abs(dx * fz - dz * fx);
    if (across < 1.6) { hit = { car }; hitDist = along; }
  }
  // the tracer: a short bright bolt from the muzzle to the hit point
  if (tracer) G.worldGroup.remove(tracer);
  tracer = new THREE.Mesh(tracerGeo(), new THREE.MeshBasicMaterial({ color: 0xffe28a }));
  const len = hit ? hitDist : 30;
  tracer.scale.z = len;
  tracer.position.set(G.player.x + fx * (len / 2), 1.35, G.player.z + fz * (len / 2));
  tracer.rotation.y = G.player.heading;
  G.worldGroup.add(tracer);
  tracerUntil = G.time + 0.06;
  // startle everyone nearby
  for (const person of G.people) {
    if (Math.hypot(person.x - G.player.x, person.z - G.player.z) < 16) person.scare(G.player, 4);
  }
  if (hit && hit.person) {
    const wentDown = hit.person.hurt(40);
    if (wentDown) {
      addWanted(WANTED.pedDown);
      if (!hit.person.hostile) hud.toast('That was a civilian. The Harbor noticed.');
    }
  } else if (hit && hit.car) {
    hit.car.health -= 18;
    addWanted(WANTED.carHit);
    if (hit.car.health <= 0 && !hit.car.wrecked) wreckCar(hit.car);
  }
  return hit;
}

function melee() {
  if (G.mode !== 'play' || G.playerCar || G.meleeCooldown > 0) return null;
  G.meleeCooldown = 0.38;
  sounds.punch();
  const fx = Math.sin(G.player.heading);
  const fz = Math.cos(G.player.heading);
  let best = null;
  let bestDist = PLAYER.meleeRange;
  for (const person of [...G.thugs, ...G.people]) {
    if (person.down) continue;
    const dx = person.x - G.player.x;
    const dz = person.z - G.player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist && dx * fx + dz * fz > 0) { best = person; bestDist = dist; }
  }
  if (best) {
    addWanted(WANTED.meleeHit);
    const wentDown = best.hurt(PLAYER.meleeDamage);
    if (wentDown) addWanted(WANTED.pedDown * 0.7);
  }
  return best;
}

function wreckCar(car) {
  car.wrecked = true;
  car.speed = 0;
  car.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x17181c });
  if (G.playerCar === car) {
    hud.toast('Wrecked! Get out and find other wheels.');
    sounds.crash(1);
  }
}

// ---------------------------------------------------------------- input
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  sounds.unlock();
  if (G.mode !== 'play') return;
  if (e.code === 'KeyE') {
    if (G.playerCar) exitCar();
    else {
      const car = nearestEnterableCar();
      if (car) enterCar(car);
    }
  }
  if (e.code === 'KeyF') melee();
  if (e.code === 'KeyM') {
    sounds.setMuted(!sounds.muted);
    hud.toast(sounds.muted ? 'Sound off' : 'Sound on');
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  sounds.unlock();
  if (G.mode === 'play' && !params.has('shot')) {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    else if (e.button === 0) fire();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || G.mode !== 'play') return;
  G.camYaw += e.movementX * 0.0026;
  G.camPitch = Math.max(-0.15, Math.min(1.1, G.camPitch + e.movementY * 0.0022));
});

function readInput() {
  if (G.autoInput) return G.autoInput;
  const input = { throttle: 0, steer: 0, handbrake: false, moveX: 0, moveZ: 0, sprint: false };
  if (keys.has('KeyW') || keys.has('ArrowUp')) { input.throttle += 1; input.moveZ += 1; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { input.throttle -= 1; input.moveZ -= 1; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { input.steer += 1; input.moveX -= 1; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { input.steer -= 1; input.moveX += 1; }
  input.handbrake = keys.has('Space');
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  return input;
}

// ---------------------------------------------------------------- police
function desiredPolice() {
  if (G.stars < 1) return 0;
  return Math.min(POLICE.maxCars, 1 + Math.floor(G.stars));
}

function spawnPoliceNear(count, distance = 130) {
  for (let n = 0; n < count; n += 1) {
    const angle = G.rng() * Math.PI * 2;
    let x = G.player.x + Math.sin(angle) * distance;
    let z = G.player.z + Math.cos(angle) * distance;
    // snap to the nearest street crossing so cruisers arrive on roads
    const sx = xsSnap(x);
    const sz = zsSnap(z);
    x = sx + n * 7;
    z = sz;
    const car = new Car(THREE, x, z, Math.atan2(G.player.x - x, G.player.z - z), 0xe8e8ec, 'police');
    G.police.push(car);
    G.worldGroup.add(car.mesh);
  }
}

function xsSnap(x) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= 6; i += 1) {
    const cx = 8 + i * 72;
    if (Math.abs(cx - x) < bestDist) { bestDist = Math.abs(cx - x); best = cx; }
  }
  return best;
}

function zsSnap(z) {
  let best = 0;
  let bestDist = Infinity;
  for (let j = 0; j <= 5; j += 1) {
    const cz = 8 + j * 72;
    if (Math.abs(cz - z) < bestDist) { bestDist = Math.abs(cz - z); best = cz; }
  }
  return best;
}

function managePolice(dt) {
  G.policeSpawnCheck -= dt;
  const want = desiredPolice();
  if (G.policeSpawnCheck <= 0) {
    G.policeSpawnCheck = 0.5;
    if (G.police.length < want) spawnPoliceNear(want - G.police.length);
  }
  // cruisers are called off once the trail is cold: far ones leave at once when the
  // wanted level is gone, and the rest once they fall far behind a wanted player
  for (let i = G.police.length - 1; i >= 0; i -= 1) {
    const cop = G.police[i];
    const dist = Math.hypot(cop.x - G.player.x, cop.z - G.player.z);
    if ((G.stars < 1 && dist > 50) || dist > 340) {
      G.worldGroup.remove(cop.mesh);
      G.police.splice(i, 1);
    }
  }
  if (G.police.length > 0 && G.stars >= 1) sounds.sirenStart();
  else sounds.sirenStop();
}

// ---------------------------------------------------------------- the step
function step(dt) {
  G.time += dt;
  const input = readInput();
  const playerPos = G.playerCar ? G.playerCar.pos : G.player;

  // traffic and crowds always drift, even behind the title screen
  for (const car of G.cars) {
    if (car.kind !== 'traffic') continue;
    let blocked = false;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    for (const other of [...G.cars, ...G.police]) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      if (dx * fx + dz * fz > 0 && dx * fx + dz * fz < 8 && Math.abs(dx * fz - dz * fx) < 2.4) blocked = true;
    }
    const pdx = playerPos.x - car.x;
    const pdz = playerPos.z - car.z;
    if (pdx * fx + pdz * fz > 0 && pdx * fx + pdz * fz < 8 && Math.abs(pdx * fz - pdz * fx) < 2.4) blocked = true;
    stepTraffic(car, dt, G.rng, G.world, blocked);
  }
  for (const person of G.people) stepPed(person, dt, G.world);

  if (G.mode !== 'play') return;

  G.shotCooldown = Math.max(0, G.shotCooldown - dt);
  G.meleeCooldown = Math.max(0, G.meleeCooldown - dt);
  if (tracer && G.time > tracerUntil) {
    G.worldGroup.remove(tracer);
    tracer = null;
  }

  // ---- the player, on foot or driving
  let playerSpeed = 0;
  if (G.playerCar) {
    const car = G.playerCar;
    stepDriven(car, dt, input, G.world);
    if (car.hitIntensity > 0) {
      sounds.crash(car.hitIntensity);
      car.health -= car.hitIntensity * 16;
      addWanted(WANTED.carHit * car.hitIntensity);
      if (car.health <= 0) wreckCar(car);
      car.hitIntensity = 0;
    }
    if (car.wrecked) car.speed *= Math.max(0, 1 - dt * 2);
    sounds.engineUpdate(Math.abs(car.speed) / CAR.maxSpeed);
    playerSpeed = Math.abs(car.speed);
    G.player.x = car.x;
    G.player.z = car.z;
    G.player.heading = car.heading;
  } else {
    const speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const fx = Math.sin(G.camYaw);
    const fz = Math.cos(G.camYaw);
    const rx = Math.cos(G.camYaw);
    const rz = -Math.sin(G.camYaw);
    let mx = fx * input.moveZ + rx * input.moveX;
    let mz = fz * input.moveZ + rz * input.moveX;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      G.player.heading = Math.atan2(mx, mz);
      const nx = G.player.x + mx * speed * dt;
      const nz = G.player.z + mz * speed * dt;
      const [sx, sz] = slideOut(G.world, nx, nz, PLAYER.radius);
      G.player.x = Math.max(2, Math.min(CITY_W - 2, sx));
      G.player.z = Math.max(2, Math.min(WATER_Z + 40, sz));
      G.player.phase += dt * (input.sprint ? 11 : 8);
      playerSpeed = speed;
    }
    G.player.heading = G.camYaw;
    syncPlayerMesh();
  }

  // ---- thugs
  let thugsDown = 0;
  for (const thug of G.thugs) {
    if (thug.down) { thugsDown += 1; continue; }
    const result = stepThug(thug, dt, G.world, G.player);
    if (result === 'hit') {
      hurtPlayer(8);
      sounds.punch();
    }
  }

  // ---- traffic can hurt a pedestrian player, and the player can hurt traffic
  for (const car of G.cars) {
    if (G.playerCar) {
      if (car === G.playerCar || car.wrecked) continue;
      const d = Math.hypot(car.x - G.playerCar.x, car.z - G.playerCar.z);
      if (d < 3.1 && Math.abs(G.playerCar.speed) > 3) {
        car.speed = G.playerCar.speed * 0.4;
        car.health -= Math.abs(G.playerCar.speed) * 0.7;
        G.playerCar.speed *= 0.55;
        sounds.crash(0.7);
        addWanted(WANTED.carHit);
        if (car.health <= 0) wreckCar(car);
      }
    } else if (car.kind === 'traffic' && Math.abs(car.speed) > 4) {
      if (Math.hypot(car.x - G.player.x, car.z - G.player.z) < 1.9) {
        hurtPlayer(9);
        car.speed = 0;
      }
    }
  }

  // ---- police
  managePolice(dt);
  let anySight = false;
  let nearestCop = Infinity;
  const target = {
    x: playerPos.x, z: playerPos.z,
    vx: G.playerCar ? Math.sin(G.playerCar.heading) * G.playerCar.speed : 0,
    vz: G.playerCar ? Math.cos(G.playerCar.heading) * G.playerCar.speed : 0,
  };
  for (const cop of G.police) {
    // with no wanted level the hunt is over: cruisers idle where they stand
    const dist = G.stars >= 1 ? stepPolice(cop, dt, target, G.world) : Math.hypot(cop.x - target.x, cop.z - target.z);
    nearestCop = Math.min(nearestCop, dist);
    if (dist < WANTED.sightRange) anySight = true;
    if (G.stars >= 1 && !G.playerCar && dist < 2.3 && cop.speed > 4) {
      hurtPlayer(10);
      cop.speed *= 0.4;
    }
    if (G.playerCar && dist < 3.1) {
      cop.hitCooldown = Math.max(0, (cop.hitCooldown || 0) - dt);
      if (cop.hitCooldown <= 0 && Math.abs(cop.speed - G.playerCar.speed) > 2) {
        cop.hitCooldown = 0.8;
        hurtPlayer(3);
        G.playerCar.health -= 5;
        sounds.crash(0.6);
        if (G.playerCar.health <= 0) wreckCar(G.playerCar);
      }
    }
  }
  // heat cools while no cruiser can see the player; getting far and staying unseen works
  if (!anySight && G.stars > 0) addWanted(-WANTED.decayPerSecond * dt * (G.stars > 2 ? 0.6 : 1));

  // ---- the bust meter
  if (nearestCop < POLICE.bustRange && playerSpeed < 3.2 && G.stars >= 1) {
    G.bust = Math.min(1, G.bust + POLICE.bustFill * dt * (1.3 - nearestCop / POLICE.bustRange));
  } else {
    G.bust = Math.max(0, G.bust - POLICE.bustDrain * dt);
  }
  if (G.bust >= 1) gameOver('busted');

  // ---- gentle recovery when nobody has hurt you lately
  if (G.time - G.lastHurtAt > 7 && G.player.health > 0) {
    G.player.health = Math.min(PLAYER.health, G.player.health + 2.2 * dt);
  }

  // ---- missions
  G.chain.update(dt, {
    playerPos,
    playerCar: G.playerCar,
    stars: G.stars,
    thugsDown,
    onPickupCrate: () => {
      addWanted(1.5);
      sounds.pickup();
      hud.toast('Crate grabbed. Every cruiser in the Harbor just woke up.');
    },
  });
  drainMissionEvents();

  // ---- beacon + HUD
  const target2 = G.chain.target();
  if (target2) {
    G.beacon.visible = true;
    G.beacon.position.set(target2.x, 13, target2.z);
  } else G.beacon.visible = false;
  const def = G.chain.current();
  let meta = '';
  if (target2) meta = `${Math.round(Math.hypot(target2.x - playerPos.x, target2.z - playerPos.z))} m`;
  if (G.chain.timer !== null) meta += `${meta ? ' · ' : ''}${Math.max(0, Math.ceil(G.chain.timer))}s left`;
  hud.update({
    health: G.player.health,
    cash: G.cash,
    stars: G.stars,
    objective: G.chain.objectiveText(),
    objectiveMeta: meta,
    bust: G.bust,
    speedKmh: G.playerCar ? Math.abs(G.playerCar.speed) * 3.6 : null,
  });
  hud.drawMap({
    player: G.player, playerHeading: G.player.heading,
    cars: G.cars, police: G.police, people: G.people,
    target: target2, boat: G.world.boatPos,
  });
  if (def) document.getElementById('status').textContent = `${def.title}: ${G.chain.objectiveText()}`;
}

function drainMissionEvents() {
  for (const event of G.chain.events.splice(0)) {
    if (event.type === 'complete') {
      G.cash += event.def.reward;
      sounds.cash();
      hud.showBanner(event.def.title.toUpperCase(), `Job done · +$${event.def.reward}`);
      const next = G.chain.current();
      if (next) hud.toast(next.brief, 6);
      writeSave();
    } else if (event.type === 'fail') {
      sounds.failSting();
      hud.toast(`Out of time - ${event.def.title} starts over.`, 5);
    } else if (event.type === 'victory') {
      victory();
    }
  }
}

// ---------------------------------------------------------------- camera
const camPos = { x: 0, y: 10, z: -20 };
function updateCamera(dt) {
  if (G.freeCam) {
    camera.position.set(G.freeCam.x, G.freeCam.y, G.freeCam.z);
    camera.lookAt(G.freeCam.tx, G.freeCam.ty, G.freeCam.tz);
    return;
  }
  if (G.mode === 'title') {
    const plaza = G.world.plazaRect;
    const cx = plaza.minX + 28;
    const cz = plaza.minZ + 28;
    const a = G.time * 0.07;
    camera.position.set(cx + Math.sin(a) * 44, 17, cz + Math.cos(a) * 44);
    camera.lookAt(cx, 5, cz);
    return;
  }
  const focus = G.playerCar || G.player;
  const back = G.playerCar ? 10.5 : 7.2;
  const up = G.playerCar ? 3.6 : 2.6 + G.camPitch * 2.2;
  const fx = Math.sin(G.camYaw);
  const fz = Math.cos(G.camYaw);
  const wantX = focus.x - fx * back;
  const wantZ = focus.z - fz * back;
  const wantY = up + (G.playerCar ? 0 : G.camPitch * 3);
  const blend = Math.min(1, dt * 7);
  camPos.x += (wantX - camPos.x) * blend;
  camPos.z += (wantZ - camPos.z) * blend;
  camPos.y += (wantY - camPos.y) * blend;
  if (hitsCollider(G.world, camPos.x, camPos.z, 0.4)) camPos.y = Math.max(camPos.y, 9);
  camera.position.set(camPos.x, Math.max(1.1, camPos.y), camPos.z);
  camera.lookAt(focus.x + fx * 6, 1.6, focus.z + fz * 6);
  if (G.playerCar) {
    // while driving, the camera settles in behind the car unless the player is
    // actively swinging it with the mouse
    let diff = G.playerCar.heading - G.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    G.camYaw += diff * Math.min(1, dt * 2.2);
  }
}

// ---------------------------------------------------------------- screens
function beginPlay(fromSave = false) {
  setupWorld(fromSave);
  G.mode = 'play';
  hud.hideScreens();
  const def = G.chain.current();
  if (def) {
    hud.showBanner(def.title.toUpperCase(), 'NEON HARBOR');
    hud.toast(def.brief, 6.5);
  } else {
    hud.toast('The night is yours. Free roam.');
  }
}

document.getElementById('btn-start').addEventListener('click', () => { sounds.unlock(); sounds.click(); beginPlay(false); });
document.getElementById('btn-continue').addEventListener('click', () => { sounds.unlock(); sounds.click(); beginPlay(true); });
document.getElementById('btn-retry').addEventListener('click', () => { sounds.unlock(); beginPlay(false); });
document.getElementById('btn-again').addEventListener('click', () => { sounds.unlock(); beginPlay(false); });

// ---------------------------------------------------------------- NEON API
function driveTo(x, z, timeoutSeconds = 40) {
  const car = G.playerCar;
  if (!car) return false;
  let spent = 0;
  const stepSize = 1 / 30;
  while (spent < timeoutSeconds) {
    const dx = x - car.x;
    const dz = z - car.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 9) { G.autoInput = { throttle: 0, steer: 0, handbrake: true }; step(stepSize); G.autoInput = null; return true; }
    const wanted = Math.atan2(dx, dz);
    let diff = wanted - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    G.autoInput = {
      throttle: Math.abs(diff) > 2.2 ? -0.4 : 1,
      steer: Math.max(-1, Math.min(1, diff * 1.6)),
      handbrake: false,
    };
    step(stepSize);
    spent += stepSize;
    if (G.mode !== 'play') break;
  }
  G.autoInput = null;
  return Math.hypot(x - car.x, z - car.z) < 12;
}

const NEON = {
  version: 'neon-harbor-1',
  game: G,
  start: () => beginPlay(false),
  step: (dt) => step(dt),
  state: () => ({
    mode: G.mode,
    missionIndex: G.chain.index,
    mission: G.chain.current() ? G.chain.current().id : null,
    finished: G.chain.finished,
    cash: G.cash,
    stars: G.stars,
    bust: G.bust,
    health: G.player.health,
    player: { x: G.player.x, z: G.player.z },
    driving: G.playerCar ? G.playerCar.id : null,
    police: G.police.length,
    thugsDown: G.thugs.filter((t) => t.down).length,
  }),
  warp: (x, z) => {
    if (G.playerCar) { G.playerCar.x = x; G.playerCar.z = z; G.playerCar.syncMesh(); }
    G.player.x = x;
    G.player.z = z;
    syncPlayerMesh();
  },
  face: (x, z) => {
    G.camYaw = Math.atan2(x - G.player.x, z - G.player.z);
    G.player.heading = G.camYaw;
  },
  enterNearest: () => {
    const car = nearestEnterableCar();
    return car ? enterCar(car) : false;
  },
  enterStealCar: () => enterCar(G.chain.stealCar),
  exit: () => exitCar(),
  driveTo,
  fire: () => fire(),
  melee: () => melee(),
  setStars: (n) => { G.stars = Math.max(0, Math.min(5, n)); },
  setHealth: (n) => { G.player.health = n; },
  stealCarPos: () => ({ x: G.chain.stealCar.x, z: G.chain.stealCar.z }),
  target: () => G.chain.target(),
  thugs: () => G.thugs.map((t) => ({ x: t.x, z: t.z, down: t.down, health: t.health })),
  cratePos: () => G.world.cratePos,
  cranePos: () => G.world.cranePos,
  boatPos: () => G.world.boatPos,
  saveRaw: () => window.localStorage.getItem(SAVE_KEY),
};
window.NEON = NEON;

// helpers the screenshot scenes use
NEON.beginPlay = beginPlay;
NEON.warpPlayer = (x, z) => NEON.warp(x, z);
NEON.enterCar = (car) => enterCar(car);
NEON.setStars = NEON.setStars;
NEON.spawnPoliceNear = (count, distance) => spawnPoliceNear(count, distance);
NEON.policeAt = (x, z, heading = 0) => {
  const car = new Car(THREE, x, z, heading, 0xe8e8ec, 'police');
  G.police.push(car);
  G.worldGroup.add(car.mesh);
  return car;
};
NEON.announceMission = () => {
  const def = G.chain.current();
  if (!def) return;
  hud.showBanner(def.title.toUpperCase(), 'NEON HARBOR');
  hud.toast(def.brief, 6.5);
};
NEON.skipToMission = (index) => {
  G.chain.index = index;
  G.chain.finished = false;
  G.chain.heatPeak = 0;
  G.chain.timer = G.chain.timeLimitFor(index);
};
NEON.completeMissionIf = (pred) => {
  const def = G.chain.current();
  if (def && pred(def)) {
    G.chain.complete();
    drainMissionEvents();
  }
};

// ---------------------------------------------------------------- self-test
function runSelfTest() {
  const results = [];
  const check = (name, ok) => results.push({ name, ok: !!ok });
  beginPlay(false);
  const S = () => NEON.state();

  check('player spawns in the city', G.player.x > 0 && G.player.z > 0 && S().mode === 'play');
  check('city has parked and traffic cars', G.cars.length >= 20);
  check('first mission is First Wheels', S().mission === 'first-wheels');

  const coupe = NEON.stealCarPos();
  NEON.warp(coupe.x + 1.5, coupe.z + 1.5);
  check('steal the marked coupe', NEON.enterStealCar() && S().driving !== null);
  step(1 / 30);
  check('mission 1 completes on entry', S().mission === 'hot-delivery');
  check('wanted level rose for the theft', S().stars >= 0.9);
  const save = NEON.saveRaw();
  check('progress saved to localStorage', !!save && JSON.parse(save).index >= 1);

  const crane = NEON.cranePos();
  NEON.warp(crane.x - 30, crane.z - 2);
  G.chain.stealCar.heading = Math.PI / 2;
  check('drive the delivery to the dock crane', NEON.driveTo(crane.x, crane.z, 30));
  step(1 / 30);
  check('mission 2 completes at the crane', S().mission === 'turf-trouble');

  NEON.exit();
  check('exit car works', S().driving === null);
  let allDown = true;
  const thugCount = NEON.thugs().length;
  for (let i = 0; i < thugCount; i += 1) {
    for (let s = 0; s < 8; s += 1) {
      const thug = NEON.thugs()[i];
      if (thug.down) break;
      NEON.warp(thug.x + 4.5, thug.z + 4.5);
      NEON.face(thug.x, thug.z);
      NEON.fire();
      step(0.3);
    }
    if (!NEON.thugs()[i].down) allDown = false;
  }
  step(1 / 30);
  check('all 3 Vultures go down', allDown && S().thugsDown === 3);
  check('mission 3 completes', S().mission === 'harbor-pickup');
  NEON.setStars(0); // the fight drew a crowd of cruisers; the script walks away clean

  const crate = NEON.cratePos();
  NEON.warp(crate.x + 1, crate.z + 1);
  step(1 / 30);
  check('mission 4 completes at the crate', S().mission === 'lose-the-heat');

  NEON.setStars(2.6);
  for (let i = 0; i < 6; i += 1) step(0.2); // let the spawn checks tick over
  check('police respond at 2+ stars', S().police >= 2);
  NEON.setStars(0);
  step(0.4);
  check('mission 5 completes when the heat fades', S().mission === 'the-getaway');

  const boat = NEON.boatPos();
  NEON.warp(boat.x, boat.z - 7);
  step(1 / 30);
  check('mission 6 completes at the boat', S().finished === true);
  check('victory screen reached', S().mode === 'win');
  check('cash paid across the chain', S().cash >= 3000 - 900);

  const passed = results.filter((r) => r.ok).length;
  const summary = `NEON TEST ${passed}/${results.length} ${passed === results.length ? 'PASS' : 'FAIL'}`;
  document.title = summary;
  console.log(summary, results.filter((r) => !r.ok).map((r) => r.name).join('; '));
  window.__neonTest = { passed, total: results.length, results };
}

// ---------------------------------------------------------------- boot
setupWorld(false);
{
  const save = loadSave();
  if (save && save.index > 0) document.getElementById('btn-continue').style.display = '';
  hud.showScreen('screen-start');
  if (params.has('shot')) hud.hideScreens();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.mode === 'play' || G.mode === 'title') step(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

if (params.has('test')) {
  runSelfTest();
} else if (params.has('shot')) {
  const name = stageShot(params.get('shot'), {
    // getters, not snapshots: beginPlay() rebuilds the world, so the scenes must
    // read the live state at the moment they run, not the boot-time objects
    get world() { return G.world; },
    get cars() { return G.cars; },
    get chain() { return G.chain; },
    get player() { return G.player; },
    beginPlay: () => beginPlay(false),
    warpPlayer: (x, z) => NEON.warp(x, z),
    enterCar: (car) => enterCar(car),
    completeMissionIf: NEON.completeMissionIf,
    skipToMission: NEON.skipToMission,
    setStars: NEON.setStars,
    spawnPoliceNear: (c, d) => spawnPoliceNear(c, d),
    policeAt: (x, z, h) => NEON.policeAt(x, z, h),
    announceMission: () => NEON.announceMission(),
    step: (dt) => step(dt),
    set freeCam(v) { G.freeCam = v; },
    get freeCam() { return G.freeCam; },
    set camYaw(v) { G.camYaw = v; },
    get camYaw() { return G.camYaw; },
  });
  if (name !== 'start') hud.hideScreens();
  else hud.showScreen('screen-start');
  updateCamera(0.5);
  renderer.render(scene, camera);
  window.__shotReady = true;
  document.title = `SHOT ${name} READY`;
}
requestAnimationFrame(frame);
