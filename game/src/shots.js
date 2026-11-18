// shots.js - the four screenshot scenes behind ?shot=start|chase|mission|dock.
// Each scene takes the real, running game and poses it: the title view over the
// plaza, a police chase at three stars, the park fight mid-mission, and the run
// down the dock to the last boat. Nothing is faked - the scenes set state, step
// the simulation a little so traffic and crowds are mid-motion, and leave the
// normal renderer to draw the frame the screenshot is taken from.

function settle(game, seconds) {
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) game.step(step);
}

function nearestCar(game, x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const car of game.cars) {
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestDist) { bestDist = d; best = car; }
  }
  return best;
}

export function stageShot(name, game) {
  const { world } = game;
  if (name === 'chase') {
    game.beginPlay();
    const coupe = game.chain.stealCar;
    game.warpPlayer(coupe.x + 2, coupe.z + 2);
    game.enterCar(coupe);
    game.completeMissionIf((m) => m.kind === 'steal'); // the chase happens after the lift
    // on the southbound lane of the east-side street, three stars, one cruiser
    // pulling across ahead and one coming up behind
    coupe.x = 220.4; coupe.z = 190; coupe.heading = 0; coupe.speed = 15;
    coupe.syncMesh();
    game.setStars(3);
    game.policeAt(225, 208, Math.PI);
    game.policeAt(220.4, 158, 0);
    game.announceMission();
    settle(game, 0.45);
    return 'chase';
  }
  if (name === 'mission') {
    game.beginPlay();
    game.skipToMission(2); // Turf Trouble, at the park
    const park = world.parkRect;
    game.warpPlayer(park.minX + 8, park.minZ + 24);
    game.player.heading = Math.PI / 3;
    game.camYaw = game.player.heading + Math.PI;
    game.announceMission();
    settle(game, 0.8);
    return 'mission';
  }
  if (name === 'dock') {
    game.beginPlay();
    game.skipToMission(5); // The Getaway
    const car = nearestCar(game, world.cranePos.x, world.cranePos.z);
    game.warpPlayer(car.x + 2, car.z + 2);
    game.enterCar(car);
    // westbound on the dock, the pier and the boat ahead, a cruiser in the way
    car.x = 62; car.z = 390; car.heading = -Math.PI / 2; car.speed = 13;
    car.syncMesh();
    game.setStars(1);
    game.policeAt(28, 383, Math.PI / 2);
    game.announceMission();
    settle(game, 0.8);
    return 'dock';
  }
  // start: the title screen over a slow orbit of the plaza at night
  const plaza = world.plazaRect;
  game.freeCam = {
    x: plaza.minX + 6, y: 15, z: plaza.maxZ + 30,
    tx: plaza.minX + 30, ty: 6, tz: plaza.minZ + 10,
  };
  settle(game, 1.4);
  return 'start';
}
