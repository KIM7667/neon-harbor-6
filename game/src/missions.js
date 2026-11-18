// missions.js - Sal the fixer's chain of six jobs, and the state machine that walks
// the player through them. The chain knows the defs (config.js), the named places
// (city.js) and the steal-target car; main.js feeds it the live game state each frame
// and acts on the events it queues: 'complete' (payday), 'fail' (a timer ran out; the
// job restarts), 'victory' (the boat, the night, the game).

import { MISSION_DEFS } from './config.js';

export class MissionChain {
  constructor(world, stealCar) {
    this.world = world;
    this.stealCar = stealCar;
    this.index = 0;
    this.finished = false; // the whole chain is done (victory)
    this.events = [];
    this.heatPeak = 0; // lose-the-heat: highest wanted level reached this job
    this.timer = this.timeLimitFor(0);
  }

  timeLimitFor(index) {
    const def = MISSION_DEFS[index];
    return def && def.timeLimit ? def.timeLimit : null;
  }

  current() {
    return this.finished ? null : MISSION_DEFS[this.index];
  }

  /** Where the HUD marker and the beacon stand for the current job. */
  target() {
    const def = this.current();
    if (!def) return null;
    switch (def.kind) {
      case 'steal': return { x: this.stealCar.x, z: this.stealCar.z };
      case 'deliver': return { x: this.world.cranePos.x, z: this.world.cranePos.z };
      case 'fight': return { x: (this.world.parkRect.minX + this.world.parkRect.maxX) / 2, z: (this.world.parkRect.minZ + this.world.parkRect.maxZ) / 2 };
      case 'pickup': return { x: this.world.cratePos.x, z: this.world.cratePos.z };
      case 'heat': return this.heatPeak >= 2 ? { x: this.world.hideoutPos.x, z: this.world.hideoutPos.z } : null;
      case 'escape': return { x: this.world.boatPos.x, z: this.world.boatPos.z };
      default: return null;
    }
  }

  /** The objective line for the HUD; lose-the-heat changes its mind halfway. */
  objectiveText() {
    const def = this.current();
    if (!def) return 'The night is yours. Free roam.';
    if (def.kind === 'heat') {
      return this.heatPeak >= 2
        ? 'Now lose them: break sight and let your stars fade'
        : 'Get the Harbor PD\'s attention: reach 2 wanted stars';
    }
    return def.objective;
  }

  complete() {
    const def = this.current();
    this.events.push({ type: 'complete', def });
    this.index += 1;
    this.heatPeak = 0;
    if (this.index >= MISSION_DEFS.length) {
      this.finished = true;
      this.timer = null;
      this.events.push({ type: 'victory', def });
    } else {
      this.timer = this.timeLimitFor(this.index);
    }
  }

  fail() {
    const def = this.current();
    this.events.push({ type: 'fail', def });
    this.timer = this.timeLimitFor(this.index);
    this.heatPeak = 0;
  }

  /**
   * Advance the chain. ctx carries the live facts:
   * { playerPos, playerCar, stars, thugsDown }
   */
  update(dt, ctx) {
    const def = this.current();
    if (!def) return;
    if (this.timer !== null) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail();
        return;
      }
    }
    const distTo = (p) => Math.hypot(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z);
    switch (def.kind) {
      case 'steal':
        if (ctx.playerCar === this.stealCar) this.complete();
        break;
      case 'deliver':
        if (ctx.playerCar === this.stealCar && distTo(this.world.cranePos) < 10) this.complete();
        break;
      case 'fight':
        if (ctx.thugsDown >= 3) this.complete();
        break;
      case 'pickup':
        if (!ctx.playerCar && distTo(this.world.cratePos) < 3.4) {
          ctx.onPickupCrate();
          this.complete();
        }
        break;
      case 'heat':
        this.heatPeak = Math.max(this.heatPeak, ctx.stars);
        if (this.heatPeak >= 2 && ctx.stars <= 0.05) this.complete();
        break;
      case 'escape':
        if (distTo(this.world.boatPos) < 9) this.complete();
        break;
      default:
        break;
    }
  }
}
