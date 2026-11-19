import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ARENA_SIZE = 72;
const PLAYER_HEIGHT = 1.7;
const ENEMY_COUNT = 5;
const ASSET_BASE = "./assets/kenney_blaster-kit_2.1/Models/GLB format/";
const ROADS_ASSET_BASE = "./assets/kenney_city-kit-roads/Models/GLB format/";
const SUBURBAN_ASSET_BASE = "./assets/kenney_city-kit-suburban_20/Models/GLB format/";
const CAR_ASSET_BASE = "./assets/kenney_car-kit/Models/GLB format/";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87939a);
scene.fog = new THREE.Fog(0x87939a, 25, 70);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, PLAYER_HEIGHT, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.querySelector("#game").appendChild(renderer.domElement);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const gltfLoader = new GLTFLoader();
const keys = new Set();
const enemies = [];
const obstacles = [];
const ammoPickups = [];
const weaponRig = new THREE.Group();
const weaponModels = {};
const weaponTypes = {
  pistol: { label: "手槍", magazine: 12, damage: 50, cooldown: 0.32 },
  rifle: { label: "步槍", magazine: 30, damage: 25, cooldown: 0.1 },
};

const state = {
  playing: false,
  health: 100,
  weapon: "pistol",
  ammo: weaponTypes.pistol.magazine,
  lastShot: -Infinity,
  yaw: 0,
  pitch: 0,
};

const ui = {
  message: document.querySelector("#message"),
  startButton: document.querySelector("#start-button"),
  health: document.querySelector("#health"),
  weapon: document.querySelector("#weapon"),
  ammo: document.querySelector("#ammo"),
  enemies: document.querySelector("#enemies"),
  hitMarker: document.querySelector("#hit-marker"),
  damageFlash: document.querySelector("#damage-flash"),
};

function createArena() {
  const hemisphere = new THREE.HemisphereLight(0xdce9ed, 0x394047, 2.2);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffe6c2, 2.5);
  sun.position.set(-12, 24, 10);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x7a7a70, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addWall(0, 2, -ARENA_SIZE / 2, ARENA_SIZE, 4, 1);
  addWall(0, 2, ARENA_SIZE / 2, ARENA_SIZE, 4, 1);
  addWall(-ARENA_SIZE / 2, 2, 0, 1, 4, ARENA_SIZE);
  addWall(ARENA_SIZE / 2, 2, 0, 1, 4, ARENA_SIZE);

  buildCity();

  addAmmoPickup(-10, 0.75, 3);
  addAmmoPickup(10, 0.75, -8);
  loadWeaponModels();
}

function addWall(x, y, z, width, height, depth) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: 0x424b4d, roughness: 0.8 }),
  );
  wall.position.set(x, y, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
  obstacles.push(wall);
}

function addObstacle(x, y, z, width, height, depth) {
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.position.set(x, y, z);
  obstacles.push(hitbox);

  const crateNames = ["crate-medium.glb", "crate-wide.glb", "crate-small.glb"];
  const crateName = crateNames[obstacles.length % crateNames.length];
  gltfLoader.load(`${ASSET_BASE}${crateName}`, (gltf) => {
    const crate = gltf.scene;
    crate.position.set(x, 0, z);
    crate.scale.set(width / 2, height / 1.8, depth / 2);
    crate.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    scene.add(crate);
  });
}

async function loadGlb(name) {
  const gltf = await gltfLoader.loadAsync(`${ASSET_BASE}${name}`);
  const model = gltf.scene;
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return model;
}

async function loadCityGlb(base, name) {
  const gltf = await gltfLoader.loadAsync(`${base}${name}`);
  const model = gltf.scene;
  model.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return model;
}

function fitCityModel(model, targetWidth, targetHeight, targetDepth) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(
    targetWidth / Math.max(size.x, 0.001),
    targetHeight / Math.max(size.y, 0.001),
    targetDepth / Math.max(size.z, 0.001),
  );
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const fittedBox = new THREE.Box3().setFromObject(model);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  model.position.x -= fittedCenter.x;
  model.position.z -= fittedCenter.z;
  model.position.y -= fittedBox.min.y;
  return model;
}

async function addCityRoad(x, z, name = "road-straight.glb", rotation = 0) {
  const model = await loadCityGlb(ROADS_ASSET_BASE, name);
  fitCityModel(model, 6, 0.35, 6);
  model.position.set(x, 0.015, z);
  model.rotation.y = rotation;
  scene.add(model);
}

async function addCityBuilding(x, z, name, width, depth, rotation = 0) {
  const model = await loadCityGlb(SUBURBAN_ASSET_BASE, name);
  fitCityModel(model, width * 1.35, 10.5, depth * 1.35);
  model.position.set(x, 0, z);
  model.rotation.y = rotation;
  scene.add(model);

  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.35, 10.5, depth * 1.35),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.position.set(x, 5.25, z);
  hitbox.updateMatrixWorld(true);
  obstacles.push(hitbox);
}

async function addCityProp(x, z, name, scale = 1, rotation = 0) {
  const model = await loadCityGlb(ROADS_ASSET_BASE, name);
  model.position.set(x, 0, z);
  model.rotation.y = rotation;
  model.scale.setScalar(scale);
  scene.add(model);
}

async function addCityCar(x, z, name, rotation = 0) {
  const model = await loadCityGlb(CAR_ASSET_BASE, name);
  fitCityModel(model, 7.2, 3.3, 3.6);
  model.position.set(x, 0, z);
  model.rotation.y = rotation;
  scene.add(model);

  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 3.3, 3.6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.position.set(x, 1.65, z);
  hitbox.rotation.y = rotation;
  hitbox.updateMatrixWorld(true);
  obstacles.push(hitbox);
}

async function buildCity() {
  for (let z = -30; z <= 30; z += 6) {
    await addCityRoad(0, z, "road-straight.glb", Math.PI / 2);
    await addCityRoad(-18, z, "road-straight.glb", Math.PI / 2);
    await addCityRoad(18, z, "road-straight.glb", Math.PI / 2);
  }
  await addCityRoad(-18, 0, "road-crossroad.glb");
  await addCityRoad(0, 0, "road-crossroad.glb");
  await addCityRoad(18, 0, "road-crossroad.glb");

  await addCityBuilding(-9, -24, "building-type-a.glb", 12, 10);
  await addCityBuilding(-9, -12, "building-type-c.glb", 12, 10);
  await addCityBuilding(9, -24, "building-type-f.glb", 12, 10);
  await addCityBuilding(9, -12, "building-type-h.glb", 12, 10);
  await addCityBuilding(-27, -24, "building-type-k.glb", 12, 10);
  await addCityBuilding(-27, 12, "building-type-m.glb", 12, 10);
  await addCityBuilding(27, 24, "building-type-r.glb", 12, 10);
  await addCityBuilding(27, 12, "building-type-u.glb", 12, 10);
  await addCityBuilding(-9, 24, "building-type-d.glb", 12, 10);
  await addCityBuilding(9, 24, "building-type-i.glb", 12, 10);

  const trees = [
    [-14, -5], [-14, 5], [14, -5], [14, 5],
    [-30, -5], [30, 5], [-30, 18], [30, -18],
    [-5, 29], [5, -29], [-5, 14], [5, -14],
  ];
  for (const [x, z] of trees) {
    const model = await loadCityGlb(SUBURBAN_ASSET_BASE, "tree-large.glb");
    fitCityModel(model, 2.4, 5.5, 2.4);
    model.position.set(x, 0, z);
    scene.add(model);
  }

  await addCityProp(-5, -7, "light-square.glb", 1);
  await addCityProp(5, 7, "light-square.glb", 1);
  await addCityProp(-5, 7, "construction-barrier.glb", 1);
  await addCityProp(5, -7, "construction-barrier.glb", 1);

  await addCityCar(-18, -5, "police.glb", Math.PI / 2);
  await addCityCar(-18, 7, "taxi.glb", Math.PI / 2);
  await addCityCar(18, -8, "sedan.glb", -Math.PI / 2);
  await addCityCar(18, 11, "van.glb", -Math.PI / 2);
  await addCityCar(0, 18, "suv.glb", 0);
  await addCityCar(0, -18, "sedan-sports.glb", Math.PI);
}

async function loadWeaponModels() {
  weaponRig.position.set(0.38, -0.35, -0.72);
  camera.add(weaponRig);
  scene.add(camera);

  const [pistol, rifle] = await Promise.all([
    loadGlb("blaster-a.glb"),
    loadGlb("blaster-r.glb"),
  ]);
  pistol.scale.setScalar(0.75);
  pistol.rotation.set(0, Math.PI, 0);
  rifle.scale.setScalar(0.75);
  rifle.rotation.set(0, Math.PI, 0);
  weaponModels.pistol = pistol;
  weaponModels.rifle = rifle;
  setWeapon("pistol");
}

async function addAmmoPickup(x, y, z) {
  const pickup = new THREE.Group();
  const model = await loadGlb("clip-large.glb");
  model.scale.setScalar(1.25);
  pickup.add(model);
  pickup.position.set(x, y, z);
  pickup.userData = { baseY: y, active: true };
  scene.add(pickup);
  ammoPickups.push(pickup);
}

function createEnemy(index) {
  const enemy = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.5, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x8c332b, roughness: 0.8 }),
  );
  body.position.y = 1.05;
  body.castShadow = true;
  enemy.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xb17455, roughness: 0.8 }),
  );
  head.position.y = 2.05;
  head.castShadow = true;
  enemy.add(head);

  const angle = (index / ENEMY_COUNT) * Math.PI * 2;
  enemy.position.set(Math.cos(angle) * 24, 0, Math.sin(angle) * 24);
  enemy.userData = { health: 100, phase: index * 1.7, speed: 0.8 + index * 0.08 };
  scene.add(enemy);
  enemies.push(enemy);
}

function updateHud() {
  const weapon = weaponTypes[state.weapon];
  ui.health.textContent = Math.max(0, Math.ceil(state.health));
  ui.weapon.textContent = weapon.label;
  ui.ammo.textContent = `${state.ammo} / ${weapon.magazine}`;
  ui.enemies.textContent = enemies.length;
}

function setWeapon(name) {
  state.weapon = name;
  state.ammo = weaponTypes[name].magazine;
  weaponRig.clear();
  if (weaponModels[name]) {
    weaponRig.add(weaponModels[name]);
  }
  updateHud();
}

function shoot() {
  if (!state.playing || document.pointerLockElement !== renderer.domElement) {
    return;
  }

  const weapon = weaponTypes[state.weapon];
  const now = clock.getElapsedTime();
  if (now - state.lastShot < weapon.cooldown) {
    return;
  }
  if (state.ammo === 0) {
    reload();
    return;
  }

  state.lastShot = now;
  state.ammo -= 1;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = enemies.flatMap((enemy) => enemy.children);
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    const enemy = hits[0].object.parent;
    enemy.userData.health -= weapon.damage;
    showHitMarker();
    if (enemy.userData.health <= 0) {
      scene.remove(enemy);
      enemies.splice(enemies.indexOf(enemy), 1);
      if (enemies.length === 0) {
        endGame("MISSION COMPLETE", "所有敵人已被擊倒。");
      }
    }
  }
  updateHud();
}

function reload() {
  state.ammo = weaponTypes[state.weapon].magazine;
  updateHud();
}

function showHitMarker() {
  ui.hitMarker.classList.remove("visible");
  void ui.hitMarker.offsetWidth;
  ui.hitMarker.classList.add("visible");
}

function damagePlayer(amount) {
  state.health -= amount;
  ui.damageFlash.classList.remove("visible");
  void ui.damageFlash.offsetWidth;
  ui.damageFlash.classList.add("visible");
  updateHud();
  if (state.health <= 0) {
    endGame("MISSION FAILED", "你已被敵人擊倒。");
  }
}

function updatePlayer(delta) {
  const direction = new THREE.Vector3(
    Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
    0,
    Number(keys.has("KeyS")) - Number(keys.has("KeyW")),
  );
  if (direction.lengthSq() === 0) {
    return;
  }

  direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
  const movement = direction.multiplyScalar(delta * 8);
  const playerRadius = 0.65;

  function isBlocked(x, z) {
    for (const obstacle of obstacles) {
      obstacle.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obstacle);
      if (
        x + playerRadius > box.min.x &&
        x - playerRadius < box.max.x &&
        z + playerRadius > box.min.z &&
        z - playerRadius < box.max.z
      ) {
        return true;
      }
    }
    return false;
  }

  const nextX = THREE.MathUtils.clamp(
    camera.position.x + movement.x,
    -ARENA_SIZE / 2 + 1.5,
    ARENA_SIZE / 2 - 1.5,
  );
  if (!isBlocked(nextX, camera.position.z)) {
    camera.position.x = nextX;
  }

  const nextZ = THREE.MathUtils.clamp(
    camera.position.z + movement.z,
    -ARENA_SIZE / 2 + 1.5,
    ARENA_SIZE / 2 - 1.5,
  );
  if (!isBlocked(camera.position.x, nextZ)) {
    camera.position.z = nextZ;
  }
  camera.position.y = PLAYER_HEIGHT;

  for (const pickup of ammoPickups) {
    if (!pickup.userData.active) {
      continue;
    }
    const distance = pickup.position.distanceTo(camera.position);
    if (distance < 1.8) {
      pickup.userData.active = false;
      pickup.visible = false;
      state.ammo = weaponTypes[state.weapon].magazine;
      updateHud();
    }
  }
}

function updateAmmoPickups(time) {
  for (const pickup of ammoPickups) {
    if (!pickup.userData.active) {
      continue;
    }
    pickup.position.y = pickup.userData.baseY + Math.sin(time * 2.4) * 0.12;
    pickup.rotation.y = time * 0.8;
  }
}

function updateEnemies(delta, time) {
  for (const enemy of enemies) {
    const toPlayer = camera.position.clone().sub(enemy.position);
    const distance = toPlayer.length();
    if (distance > 2.4) {
      enemy.position.addScaledVector(toPlayer.normalize(), delta * enemy.userData.speed);
    } else if (Math.floor(time * 2) !== Math.floor((time - delta) * 2)) {
      damagePlayer(4);
    }
    enemy.lookAt(camera.position.x, 1.2, camera.position.z);
    enemy.position.y = Math.sin(time * 2 + enemy.userData.phase) * 0.04;
  }
}

function endGame(title, description) {
  state.playing = false;
  document.exitPointerLock();
  ui.message.querySelector("h1").textContent = title;
  ui.message.querySelector("p").textContent = description;
  ui.startButton.textContent = "重新開始";
  ui.message.classList.remove("hidden");
}

function startGame() {
  for (const enemy of enemies) {
    scene.remove(enemy);
  }
  enemies.length = 0;
  for (let index = 0; index < ENEMY_COUNT; index += 1) {
    createEnemy(index);
  }
  for (const pickup of ammoPickups) {
    pickup.userData.active = true;
    pickup.visible = true;
  }
  state.playing = true;
  state.health = 100;
  state.yaw = 0;
  state.pitch = 0;
  state.lastShot = -Infinity;
  camera.position.set(0, PLAYER_HEIGHT, 12);
  camera.rotation.set(0, 0, 0);
  setWeapon("pistol");
  updateHud();
  ui.message.classList.add("hidden");
  renderer.domElement.requestPointerLock();
}

function handleMouseMove(event) {
  if (!state.playing || document.pointerLockElement !== renderer.domElement) {
    return;
  }
  state.yaw -= event.movementX * 0.002;
  state.pitch -= event.movementY * 0.002;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -Math.PI / 2.1, Math.PI / 2.1);
  camera.rotation.set(state.pitch, state.yaw, 0, "YXZ");
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  if (state.playing) {
    updatePlayer(delta);
    updateEnemies(delta, time);
  }
  updateAmmoPickups(time);
  renderer.render(scene, camera);
}

createArena();
updateHud();
ui.startButton.addEventListener("click", startGame);
renderer.domElement.addEventListener("click", () => {
  if (state.playing) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener("mousemove", handleMouseMove);
document.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    shoot();
  }
});
document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Digit1") {
    setWeapon("pistol");
  }
  if (event.code === "Digit2") {
    setWeapon("rifle");
  }
  if (event.code === "KeyR") {
    reload();
  }
});
document.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
