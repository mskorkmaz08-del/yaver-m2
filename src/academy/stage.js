// The academy's 3D stage: a workbench scene with studio lighting, an orbit
// camera that glides between poses, floating labels with leader lines, and
// picking. Units are centimetres, so parts are modelled at their real size.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { tween, ease } from "./anim.js?v=17";

const tmp = new THREE.Vector3();

export class Stage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#06080d");
    this.scene.fog = new THREE.Fog("#06080d", 120, 320);
    // A soft studio room reflected in metal pins, chips and solder.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    // The pose the camera is at, and the one it glides toward.
    this.pose = { x: 0, y: 2, z: 0, theta: 0.5, phi: 1.0, radius: 30 };

    this.scene.add(new THREE.HemisphereLight("#cfe8ff", "#1a1f29", 0.55));
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(30, 60, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#7cc7ff", 0.8);
    rim.position.set(-40, 25, -50);
    this.scene.add(rim);

    this.bench = makeBench();
    this.scene.add(this.bench);

    this.root = new THREE.Group(); // everything a lesson or the simulator adds
    this.scene.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.labels = new Labels(container.parentElement.querySelector(".ac-labels"), this);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.applyPose();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyShift();
    this.labels.resize(w, h);
  }

  // Panels cover the left and right of the screen: `left` and `right` are
  // the pixels they take. The view's centre slides into the free space
  // between them, so what the camera looks at isn't hidden behind a panel.
  setInsets(left, right) {
    const target = (left - right) / 2;
    this.shiftGoal = target;
  }

  applyShift() {
    const w = this.width || window.innerWidth;
    const h = this.height || window.innerHeight;
    const d = Math.round((this.shift ?? 0) * 2);
    // The camera renders a wider picture and shows the part of it that puts
    // its centre in the free space.
    this.camera.aspect = (w + Math.abs(d)) / h;
    if (Math.abs(d) < 1) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w + Math.abs(d), h, d < 0 ? Math.abs(d) : 0, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  get width() { return this.renderer.domElement.clientWidth; }
  get height() { return this.renderer.domElement.clientHeight; }

  // ---- Camera ---------------------------------------------------------------

  applyPose() {
    const { x, y, z, theta, phi, radius } = this.pose;
    this.camera.position.set(
      x + radius * Math.sin(phi) * Math.sin(theta),
      y + radius * Math.cos(phi),
      z + radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(x, y, z);
  }

  // Glides to a pose: { target: [x, y, z], theta, phi, radius }. Any field
  // left out stays as it is.
  flyTo({ target, theta, phi, radius }, ms = 1400) {
    const to = {};
    if (target) Object.assign(to, { x: target[0], y: target[1], z: target[2] });
    if (theta !== undefined) {
      // Turn the short way round.
      let t = theta;
      while (t - this.pose.theta > Math.PI) t -= Math.PI * 2;
      while (t - this.pose.theta < -Math.PI) t += Math.PI * 2;
      to.theta = t;
    }
    if (phi !== undefined) to.phi = phi;
    if (radius !== undefined) to.radius = radius;
    return tween(this.pose, to, { ms, curve: ease.inOut });
  }

  orbitBy(dTheta, dPhi) {
    this.pose.theta += dTheta;
    this.pose.phi = THREE.MathUtils.clamp(this.pose.phi + dPhi, 0.08, Math.PI / 2 - 0.03);
  }

  zoomBy(f) {
    this.pose.radius = THREE.MathUtils.clamp(this.pose.radius * f, 4, 260);
  }

  // Slides the point the camera looks at across the bench.
  panBy(dx, dy) {
    const right = tmp.set(Math.cos(this.pose.theta), 0, -Math.sin(this.pose.theta));
    const k = this.pose.radius * 0.0016;
    this.pose.x -= right.x * dx * k;
    this.pose.z -= right.z * dx * k;
    this.pose.y = THREE.MathUtils.clamp(this.pose.y + dy * k, -5, 60);
  }

  // ---- Screen <-> world -------------------------------------------------------

  ndc(sx, sy) {
    return new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
  }

  project(v) {
    const p = tmp.copy(v).project(this.camera);
    return { x: (p.x + 1) / 2 * this.width, y: (1 - p.y) / 2 * this.height, front: p.z < 1 };
  }

  // The closest mesh under a screen point, among `objects` (and their
  // children). `test(mesh)` can skip meshes.
  pick(sx, sy, objects = [this.root], test = null) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    for (const hit of this.raycaster.intersectObjects(objects, true)) {
      if (!hit.object.visible || hit.object.userData.noPick) continue;
      if (!test || test(hit.object, hit)) return hit;
    }
    return null;
  }

  // Where a screen point meets the horizontal plane at height y.
  onPlane(sx, sy, y) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  render() {
    const goal = this.shiftGoal ?? 0;
    if (Math.abs(goal - (this.shift ?? 0)) > 0.5) {
      this.shift = (this.shift ?? 0) + (goal - (this.shift ?? 0)) * 0.12;
      this.applyShift();
    }
    this.applyPose();
    this.labels.update();
    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    this.labels.clear();
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      dispose(child);
    }
  }
}

export function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) {
      if (m.userData?.shared) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
}

// A dark self-healing cutting mat with a centimetre grid, the classic
// electronics bench.
function makeBench() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#0d2a24";
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i <= 64; i++) {
    const p = i * 16;
    g.strokeStyle = i % 10 === 0 ? "rgba(140,220,190,0.35)" : i % 5 === 0 ? "rgba(140,220,190,0.18)" : "rgba(140,220,190,0.08)";
    g.lineWidth = i % 10 === 0 ? 2 : 1;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(1024, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
  const mat3 = new THREE.Mesh(new THREE.BoxGeometry(64, 0.4, 64), mat);
  mat3.position.y = -0.2;
  mat3.receiveShadow = true;
  mat3.userData.noPick = true;
  const group = new THREE.Group();
  group.add(mat3);
  // A dim desk around the mat.
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: "#0b0d12", roughness: 0.8 }));
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.41;
  desk.receiveShadow = true;
  desk.userData.noPick = true;
  group.add(desk);
  return group;
}

// ---- Labels -------------------------------------------------------------------

// HTML labels pinned to 3D points, with a thin leader line from the point
// to the label. They hide when their point turns away from the camera.
class Labels {
  constructor(el, stage) {
    this.el = el;
    this.stage = stage;
    this.canvas = el.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.items = new Set();
  }

  resize(w, h) {
    const r = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = w * r;
    this.canvas.height = h * r;
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
  }

  // `anchor` is an Object3D (its origin, plus `offset` in its own space) or a
  // Vector3. `dx`, `dy` move the label away from the point, in pixels.
  add(anchor, html, { dx = 40, dy = -40, cls = "", offset = null } = {}) {
    const el = document.createElement("div");
    el.className = `ac-label ${cls}`;
    el.innerHTML = html;
    this.el.appendChild(el);
    const item = { anchor, offset, el, dx, dy, shown: 0 };
    this.items.add(item);
    requestAnimationFrame(() => el.classList.add("in"));
    return {
      el,
      set: (h) => { el.innerHTML = h; },
      remove: () => this.remove(item),
    };
  }

  remove(item) {
    if (!this.items.delete(item)) return;
    item.el.classList.remove("in");
    setTimeout(() => item.el.remove(), 250);
  }

  clear() {
    for (const item of [...this.items]) this.remove(item);
  }

  update() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.stage.width, this.stage.height);
    const world = new THREE.Vector3();
    for (const item of this.items) {
      if (item.anchor.isObject3D) {
        world.copy(item.offset ?? new THREE.Vector3());
        item.anchor.localToWorld(world);
      } else world.copy(item.anchor);
      const p = this.stage.project(world);
      const visible = p.front && (!item.anchor.isObject3D || isShown(item.anchor));
      item.el.style.visibility = visible ? "visible" : "hidden";
      if (!visible) continue;
      const lx = p.x + item.dx;
      const ly = p.y + item.dy;
      const w = item.el.offsetWidth;
      const h = item.el.offsetHeight;
      const left = item.dx >= 0 ? lx : lx - w;
      item.el.style.transform = `translate(${left}px, ${ly - h / 2}px)`;
      ctx.strokeStyle = "rgba(124, 214, 255, 0.75)";
      ctx.fillStyle = "#9fe3ff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function isShown(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}
