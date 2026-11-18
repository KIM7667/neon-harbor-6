// hud.js - everything the player reads: the HUD (health, cash, wanted stars, the
// objective line, the bust meter, the speedo), the toast line, the mission banner,
// the end screens, and the 2D canvas minimap that draws the whole harbor top-down
// every frame - streets, water, traffic, cruisers, the player and the gold marker.

import { CITY_W, WORLD_D, WATER_Z, xs, zs } from './config.js';

const MAP_W = 184;
const MAP_H = 200;
const SCALE = Math.min(MAP_W / (CITY_W + 30), MAP_H / (WORLD_D + 30));

function toMap(x, z) {
  return [ (x + 15) * SCALE, (z + 15) * SCALE ];
}

export class Hud {
  constructor(doc) {
    this.doc = doc;
    this.el = (id) => doc.getElementById(id);
    this.healthFill = this.el('health-fill');
    this.healthText = this.el('health-text');
    this.cash = this.el('cash');
    this.stars = this.el('stars');
    this.objective = this.el('objective');
    this.objectiveMeta = this.el('objective-meta');
    this.bustWrap = this.el('bust-wrap');
    this.bustFill = this.el('bust-fill');
    this.speed = this.el('speed');
    this.toastBox = this.el('toast');
    this.banner = this.el('banner');
    this.bannerTitle = this.el('banner-title');
    this.bannerSub = this.el('banner-sub');
    this.map = this.el('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.bannerTimer = 0;
    this.lastStars = -1;
  }

  update(state) {
    const health = Math.max(0, Math.round(state.health));
    this.healthFill.style.width = `${health}%`;
    this.healthFill.style.background = health > 35 ? '#59d95e' : '#e33f2f';
    this.healthText.textContent = `${health}`;
    this.cash.textContent = `$${state.cash.toLocaleString('en-US')}`;
    const stars = Math.floor(state.stars);
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      this.stars.textContent = '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars);
      this.stars.style.color = stars > 0 ? '#ffd23f' : '#5a5f6b';
    }
    this.objective.textContent = state.objective;
    this.objectiveMeta.textContent = state.objectiveMeta || '';
    if (state.bust > 0.01) {
      this.bustWrap.style.display = 'block';
      this.bustFill.style.width = `${Math.round(state.bust * 100)}%`;
    } else {
      this.bustWrap.style.display = 'none';
    }
    if (state.speedKmh !== null) {
      this.speed.style.display = 'block';
      this.speed.textContent = `${Math.round(state.speedKmh)} km/h`;
    } else {
      this.speed.style.display = 'none';
    }
  }

  toast(text, seconds = 4.5) {
    this.toastBox.textContent = text;
    this.toastBox.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toastBox.style.opacity = '0'; }, seconds * 1000);
  }

  showBanner(title, sub = '') {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.style.opacity = '1';
    this.banner.style.transform = 'translate(-50%, 0)';
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.style.opacity = '0';
      this.banner.style.transform = 'translate(-50%, -12px)';
    }, 3400);
  }

  showScreen(id) {
    for (const name of ['screen-start', 'screen-over', 'screen-win']) {
      this.el(name).style.display = name === id ? 'flex' : 'none';
    }
    this.el('hud').style.display = id === null ? 'block' : 'none';
  }

  hideScreens() {
    for (const name of ['screen-start', 'screen-over', 'screen-win']) this.el(name).style.display = 'none';
    this.el('hud').style.display = 'block';
  }

  /** Draw the minimap. view: {player, cars, police, people, target, boat} */
  drawMap(view) {
    const g = this.mapCtx;
    g.fillStyle = '#101319';
    g.fillRect(0, 0, MAP_W, MAP_H);
    // water
    const [, waterY] = toMap(0, WATER_Z);
    g.fillStyle = '#0a3542';
    g.fillRect(0, waterY, MAP_W, MAP_H - waterY);
    // blocks
    g.fillStyle = '#1b202a';
    for (let i = 0; i < xs.length - 1; i += 1) {
      for (let j = 0; j < zs.length - 1; j += 1) {
        const [bx, bz] = toMap(xs[i] + 8, zs[j] + 8);
        const [ex, ez] = toMap(xs[i + 1] - 8, zs[j + 1] - 8);
        g.fillRect(bx, bz, ex - bx, ez - bz);
      }
    }
    // streets
    g.strokeStyle = '#2c333f';
    g.lineWidth = 3;
    for (const x of xs) {
      const [mx] = toMap(x, 0);
      g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, waterY); g.stroke();
    }
    for (const z of zs) {
      const [, mz] = toMap(0, z);
      g.beginPath(); g.moveTo(0, mz); g.lineTo(MAP_W, mz); g.stroke();
    }
    const dot = (x, z, color, r) => {
      const [mx, mz] = toMap(x, z);
      g.fillStyle = color;
      g.beginPath(); g.arc(mx, mz, r, 0, Math.PI * 2); g.fill();
    };
    for (const person of view.people) if (!person.down) dot(person.x, person.z, '#7d8590', 1.1);
    for (const car of view.cars) if (car.kind === 'traffic') dot(car.x, car.z, '#a8b0ba', 1.8);
    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    for (const cop of view.police) dot(cop.x, cop.z, flash ? '#3f7dff' : '#ff3b30', 2.4);
    dot(view.boat.x, view.boat.z, '#d8d3c8', 2.6);
    if (view.target) {
      const pulse = 3 + Math.sin(performance.now() / 220) * 1.1;
      dot(view.target.x, view.target.z, '#ffd23f', pulse);
    }
    // the player, an arrow pointing the way they face
    const [px, pz] = toMap(view.player.x, view.player.z);
    g.save();
    g.translate(px, pz);
    g.rotate(Math.PI - view.playerHeading);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -4.6);
    g.lineTo(3.2, 3.6);
    g.lineTo(-3.2, 3.6);
    g.closePath();
    g.fill();
    g.restore();
  }
}
