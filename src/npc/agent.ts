/** Agente base: movimento por waypoints (world.findPath) com suavização, separação e animação. */
import * as THREE from 'three';
import type { Vec2 } from '../core/services';
import { Bubble } from './bubbles';
import { Person, type Pose } from './model';
import { type AgentLike, type Env, dist2, lerpAngle } from './shared';

let nextId = 1;
export const newId = (): number => nextId++;

const SEP_R = 0.55;

export class Agent implements AgentLike {
  readonly id = newId();
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  heading = 0;
  readonly group = new THREE.Group();
  readonly bubble: Bubble;
  sepWeight = 1;
  maxSpeed = 1.3;
  speed = 0;
  /** Direção a encarar quando parado (rad) ou NaN. */
  faceYaw = NaN;
  private path: Vec2[] | null = null;
  private pi = 0;
  tx = 0;
  tz = 0;
  moving = false;
  private stuckT = 0;
  private lastX = 0;
  private lastZ = 0;
  private repathed = false;
  /** Metros andados desde o último sorteio de sujeira. */
  walked = 0;
  /** Quanto ao chegar (tolerância) */
  arriveR = 0.15;
  /** Straight-line only (rua / fila). */
  direct = false;
  /** LOD: dt acumulado e ticks pulados da animação do esqueleto. */
  private animDt = 0;
  private animSkip = 0;

  constructor(readonly env: Env, readonly person: Person) {
    this.group.add(person.root);
    this.bubble = new Bubble(person.eyeHeight + 0.32);
    this.group.add(this.bubble.sprite);
    env.ctx.scene.add(this.group);
    env.agents.push(this);
  }

  place(x: number, z: number, heading?: number): void {
    this.x = x; this.z = z; this.lastX = x; this.lastZ = z;
    this.vx = this.vz = 0;
    if (heading !== undefined) this.heading = heading;
    this.path = null; this.moving = false;
    this.sync();
  }

  /** Inicia deslocamento até (x,z). Retorna false se o caminho for inválido (cai em linha reta). */
  moveTo(x: number, z: number, direct = false): boolean {
    this.tx = x; this.tz = z;
    this.faceYaw = NaN;
    this.moving = true;
    this.stuckT = 0;
    this.repathed = false;
    this.path = null; this.pi = 0;
    let ok = true;
    if (!direct && !this.direct) {
      const p = this.env.world().findPath({ x: this.x, z: this.z }, { x, z });
      if (p && p.length > 0) this.path = p; else ok = false;
    }
    // descarta waypoints já alcançados no início
    if (this.path) while (this.pi < this.path.length - 1 && dist2(this.x, this.z, this.path[this.pi]!.x, this.path[this.pi]!.z) < 0.09) this.pi++;
    return ok;
  }

  stop(): void { this.moving = false; this.path = null; }

  get arrived(): boolean { return !this.moving; }

  /** Distância até o destino atual. */
  distTo(x: number, z: number): number { return Math.sqrt(dist2(this.x, this.z, x, z)); }

  faceTowards(x: number, z: number): void { this.faceYaw = Math.atan2(x - this.x, z - this.z); }

  step(dt: number): void {
    let dx = 0, dz = 0, want = 0;
    if (this.moving) {
      let wx = this.tx, wz = this.tz;
      const path = this.path;
      let last = true;
      if (path && this.pi < path.length) {
        const w = path[this.pi]!;
        wx = w.x; wz = w.z;
        last = this.pi >= path.length - 1;
        if (!last && dist2(this.x, this.z, wx, wz) < 0.1) { this.pi++; }
        else if (last) { wx = this.tx; wz = this.tz; }
      }
      dx = wx - this.x; dz = wz - this.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const toFinal = Math.sqrt(dist2(this.x, this.z, this.tx, this.tz));
      if (toFinal < this.arriveR || (path && last && d < this.arriveR)) {
        this.moving = false;
        this.path = null;
        dx = dz = 0;
      } else if (d > 1e-4) {
        want = this.maxSpeed * (last ? Math.min(1, 0.35 + toFinal / 0.8) : 1);
        dx /= d; dz /= d;
      }
    }
    // velocidade suavizada
    const a = Math.min(1, dt * 9);
    this.vx += (dx * want - this.vx) * a;
    this.vz += (dz * want - this.vz) * a;
    // separação
    let sx = 0, sz = 0;
    if (this.sepWeight > 0) {
      const ag = this.env.agents;
      for (let i = 0; i < ag.length; i++) {
        const o = ag[i]!;
        if (o === this) continue;
        const ox = this.x - o.x, oz = this.z - o.z;
        const dd = ox * ox + oz * oz;
        if (dd < SEP_R * SEP_R && dd > 1e-6) {
          const m = Math.sqrt(dd);
          const f = ((SEP_R - m) / SEP_R) * 1.4 * this.sepWeight;
          sx += (ox / m) * f; sz += (oz / m) * f;
        }
      }
    }
    let nx = this.x + (this.vx + sx) * dt, nz = this.z + (this.vz + sz) * dt;
    if ((sx !== 0 || sz !== 0) && !this.env.world().isWalkable(nx, nz)) { nx = this.x + this.vx * dt; nz = this.z + this.vz * dt; }
    const moved = Math.sqrt(dist2(nx, nz, this.x, this.z));
    this.walked += moved;
    this.x = nx; this.z = nz;
    this.speed = moved / Math.max(dt, 1e-4);
    // travamento
    if (this.moving) {
      this.stuckT += dt;
      if (this.stuckT > 1) {
        if (dist2(this.x, this.z, this.lastX, this.lastZ) > 0.2 * 0.2) { this.stuckT = 0; this.lastX = this.x; this.lastZ = this.z; }
        else if (this.stuckT > 3.5 && !this.repathed) { this.repathed = true; this.moveTo(this.tx, this.tz); this.repathed = true; }
        else if (this.stuckT > 7) { this.x = this.tx; this.z = this.tz; this.moving = false; this.path = null; }
      }
    }
    // orientação
    if (this.speed > 0.2) this.heading = lerpAngle(this.heading, Math.atan2(this.vx, this.vz), Math.min(1, dt * 10));
    else if (!Number.isNaN(this.faceYaw)) this.heading = lerpAngle(this.heading, this.faceYaw, Math.min(1, dt * 6));
    // LOD: fora da vista ou longe, o esqueleto anima a cada 4 ticks (com o dt acumulado)
    this.animDt += dt;
    if (++this.animSkip >= 4 || !this.env.lowDetail(this.x, this.z)) {
      this.person.animate(this.animDt, this.speed);
      this.animDt = 0; this.animSkip = 0;
    }
    this.bubble.update(dt);
    this.sync();
  }

  setPose(p: Pose, working = false): void { this.person.pose = p; this.person.working = working; }

  sync(): void {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }

  remove(): void {
    const i = this.env.agents.indexOf(this);
    if (i >= 0) this.env.agents.splice(i, 1);
    this.env.ctx.scene.remove(this.group);
    this.person.dispose();
  }
}
