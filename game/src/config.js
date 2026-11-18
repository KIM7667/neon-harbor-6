// config.js - every constant that shapes NEON HARBOR's city and rules, in one place.
//
// The city is a grid of blocks. Streets run along the grid lines; the block pitch is
// BLOCK + ROAD, so a street centre sits at every multiple of PITCH, offset by half a road.
// The waterfront runs along the south edge (high z): a dock strip, then open water.

export const BLOCK = 56; // metres, one city block face
export const ROAD = 16; // metres, street width
export const PITCH = BLOCK + ROAD; // 72 metres between street centres
export const COLS = 6; // blocks east-west
export const ROWS = 5; // blocks north-south
export const CITY_W = COLS * PITCH + ROAD; // total street-grid width
export const CITY_D = ROWS * PITCH + ROAD; // total street-grid depth
export const DOCK_D = 26; // depth of the dock strip south of the last street
export const WATER_Z = CITY_D + DOCK_D; // water starts here
export const WORLD_D = WATER_Z + 90; // water extends this far south

// Street centre coordinates: xs[i] is the centre of the i-th north-south street.
export const xs = [];
for (let i = 0; i <= COLS; i += 1) xs.push(ROAD / 2 + i * PITCH);
export const zs = [];
for (let j = 0; j <= ROWS; j += 1) zs.push(ROAD / 2 + j * PITCH);

export const PLAYER = {
  radius: 0.55,
  walkSpeed: 6.2,
  sprintSpeed: 9.6,
  health: 100,
  reach: 2.6, // how close to a car door the E key works
  meleeRange: 2.1,
  meleeDamage: 34,
};

export const CAR = {
  length: 4.4,
  width: 1.9,
  radius: 1.7, // collision circle, roughly the car's middle
  maxSpeed: 34, // m/s, a fast street car
  maxReverse: 9,
  accel: 13,
  brake: 26,
  drag: 0.55,
  turnRate: 1.9, // rad/s at full lock, scaled down with speed
  health: 100,
};

export const TRAFFIC = {
  count: 11, // moving cars besides the parked ones
  speed: 10.5,
  parkedCount: 15,
};

export const PED = {
  count: 17,
  walkSpeed: 1.7,
  fleeSpeed: 4.4,
  health: 40,
};

export const POLICE = {
  maxCars: 4,
  speed: 15.5,
  spawnGap: 210, // metres from the player where cruisers appear
  bustRange: 7, // a cruiser this close to a slow player works the bust meter
  bustFill: 0.34, // per second at point blank
  bustDrain: 0.5,
  ramDamage: 7,
};

export const WANTED = {
  // crime -> heat added
  steal: 1,
  shot: 0.55,
  meleeHit: 0.7,
  pedDown: 1.2,
  carHit: 0.35,
  decayPerSecond: 0.055, // only while no cruiser can see the player
  sightRange: 65,
};

export const SAVE_KEY = 'neon-harbor-save-v1';

// The fixer Sal's chain of jobs. Each step names a kind, the place it happens (filled in
// by missions.js from the world), the HUD text and the cash it pays. The chain is the
// game's story: one night, six jobs, and the last boat out of Neon Harbor.
export const MISSION_DEFS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    brief: 'Sal: "You walk too much, kid. Lift the teal coupe by the plaza and the night is yours."',
    objective: 'Steal the marked coupe',
    kind: 'steal',
    reward: 150,
  },
  {
    id: 'hot-delivery',
    title: 'Hot Delivery',
    brief: 'Sal: "Trunk\'s loaded. Get it to the dock crane before the buyer\'s patience runs out."',
    objective: 'Deliver the car to the dock crane',
    kind: 'deliver',
    reward: 300,
    timeLimit: 95,
  },
  {
    id: 'turf-trouble',
    title: 'Turf Trouble',
    brief: 'Sal: "The Vultures are leaning on my corner crew. Three of them, at the park. Persuade them."',
    objective: 'Deal with the 3 Vultures at the park',
    kind: 'fight',
    reward: 450,
  },
  {
    id: 'harbor-pickup',
    title: 'Harbor Pickup',
    brief: 'Sal: "A crate fell off a boat into the container yard. Fetch it. Quietly, if you can."',
    objective: 'Grab the crate in the container yard',
    kind: 'pickup',
    reward: 550,
  },
  {
    id: 'lose-the-heat',
    title: 'Lose the Heat',
    brief: 'Sal: "Every cruiser in the Harbor knows your face now. Get hot, then get invisible."',
    objective: 'Raise your wanted level, then shake it off',
    kind: 'heat',
    reward: 650,
  },
  {
    id: 'the-getaway',
    title: 'The Getaway',
    brief: 'Sal: "Last boat out leaves from the far pier. Be on it. That\'s the whole job."',
    objective: 'Reach the boat at the far pier',
    kind: 'escape',
    reward: 900,
    timeLimit: 110,
  },
];

export const FACTION_NAMES = ['Vulture', 'longshoreman', 'cab driver', 'night clerk', 'angler', 'busker'];
