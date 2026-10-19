import { demoCase } from './case-data.js';
import { TouchStructureController } from './touch-gestures.js';
import { setupOrientation } from './orientation.js?v=6';
import { setupWalkthrough } from './walkthrough.js?v=10';
import { fitCameraToBounds } from './camera-fit.js?v=7';

// Switch these paths only after the corresponding local assets exist.
const ASSETS = {
  line: 'assets/factory-mobile-v9.glb',
  poster: 'assets/factory-premium.webp',
  valveStructure: 'assets/filler-structure.glb',
  target: '0m 0.18m -0.20m',
  orbit: '28deg 60deg 4.5m',
  ...window.HACCP_AR_ASSETS,
};
const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const stage = $('stage');
const feed = $('camera-feed');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const caseId = new URLSearchParams(location.search).get('case') || 'water';
const state = { loaded: false, playing: false, xray: false, flow: false, detail: false, detailScope: 'picker', equipmentId: null, explosion: 0, selected: demoCase.processes[0]?.id };
const hotspots = new Map();
const processButtons = new Map();
const partHotspots = new Map();
const partButtons = new Map();
let partSpec = null;
const specs = new Map();
let equipmentCatalog = [];
let selectedPart = null;
let explosionFrame = 0;
let sourceVersion = 0;
let handController = null;
let handWanted = false;
let handGeneration = 0;
let dualAbort = null;
let dualTimer = 0;
let fittedRadius = 8;
let framingRevision = 0;
let tourFramingRevision = 0;
const PART_COPY = {
  base: '承托瓶体并调整瓶口高度，让瓶口与灌装阀对齐。',
  bottle: '剖面展示瓶体与液位，便于理解灌装位置与容器关系。',
  nozzle: '液体经过灌装阀进入瓶内；接液部位的清洁与密封值得重点关注。',
  seal: '密封与快装连接用于保持接液部位完整，便于理解清洁和检查位置。',
  actuator: '驱动阀杆打开与关闭，让机械动作与液体流入建立对应关系。',
  manifold: '将液体引入灌装单元；这是理解产品流路的起点。',
  p01: '空瓶由输送与导向机构进入主机，查看瓶体承托与交接关系。',
  p02: '冲洗转盘与喷头对应瓶体处理工序，展开后可观察转盘和供液空间。',
  p03: '灌装转盘、瓶托与阀组共同完成灌装；可进一步切换“灌装阀细节”。',
  p04: '供盖、理盖和旋盖机构将瓶盖送到瓶口并完成封装。',
  p05: '检测与贴标设备对应产品检查、剔除和标识环节。',
  p06: '完成包装的产品经输出输送机构进入后续转运。',
  s07: '围护上移后显示主机的工作空间，与下方转盘和传送机构对应。',
  s08: '外罩与检修面板向外展开，展示机架和内部驱动所在的位置。',
  s09: '供液管路与平衡罐作为独立系统展开，便于追踪液体进入灌装区的路径。',
  s10: '驱动、电机与机架支撑上方设备，拆分用于说明系统关系，不代表检修步骤。',
};
let toastTimer = null;
let flowFrame = 0;
let flowLastDraw = 0;
let materials = [];

function notify(message, duration = 6500) {
  clearTimeout(toastTimer);
  $('status').textContent = message;
  $('status').hidden = false;
  if (duration) toastTimer = setTimeout(() => { $('status').hidden = true; }, duration);
}
function stopCamera() { window.ExhibitCamera?.stop(); }
function isEquipmentView() { return state.detail && state.detailScope !== 'picker'; }
function isRotatedStage() { return stage.classList.contains('force-landscape') && innerHeight > innerWidth; }
function stagePoint(x, y) {
  const rect = stage.getBoundingClientRect();
  return isRotatedStage() ? { x: y - rect.top, y: rect.right - x } : { x: x - rect.left, y: y - rect.top };
}
function setPlaying(value) {
  state.playing = Boolean(value && state.loaded && !state.detail && viewer.availableAnimations?.length);
  if (state.playing) viewer.play?.(); else viewer.pause?.();
  $('play').setAttribute('aria-pressed', String(state.playing));
  $('play-label').textContent = state.playing ? '暂停动作' : '播放动作';
  $('play-symbol').setAttribute('d', state.playing ? 'M8 5v14M16 5v14' : 'm9 5 10 7-10 7V5Z');
}
function viewerBounds(component) {
  const size = component.getDimensions?.(), center = component.getBoundingBoxCenter?.();
  if (!size || !center) return null;
  const values = ['x', 'y', 'z'];
  return { min: values.map(k => center[k] - size[k] / 2), max: values.map(k => center[k] + size[k] / 2) };
}
function syncSceneLayout() {
  const wide = stage.clientWidth > stage.clientHeight;
  const header = stage.querySelector('.topbar');
  const dock = stage.querySelector('.bottom-dock');
  const tools = stage.querySelector('.toolrail');
  const detail = $('detail-panel');
  let top = header.offsetTop + header.offsetHeight + 8;
  let left = 8;
  if (state.detail && !detail.hidden) {
    if (wide) left = detail.offsetLeft + detail.offsetWidth + 12;
    else top = Math.max(top, detail.offsetTop + detail.offsetHeight + 8);
  }
  const right = Math.max(8, stage.clientWidth - tools.offsetLeft + 8);
  const bottom = dock.offsetHeight + 8;
  const values = { top, left, right, bottom };
  for (const [key, value] of Object.entries(values)) {
    const next = `${Math.round(value)}px`;
    if (stage.style.getPropertyValue(`--scene-${key}`) !== next) stage.style.setProperty(`--scene-${key}`, next);
  }
}
async function frameModel(preserveAngles = false) {
  syncSceneLayout();
  if (!state.loaded) return;
  const token = ++framingRevision;
  let bounds = viewerBounds(viewer);
  if (isEquipmentView() && partSpec?.bounds) {
    const { assembled, exploded } = partSpec.bounds;
    bounds = Object.fromEntries(['min', 'max'].map(key => [key, assembled[key].map((value, axis) => value + (exploded[key][axis] - value) * state.explosion)]));
  }
  if (!bounds) return;
  const orbit = preserveAngles === true ? viewer.getCameraOrbit() : null;
  const angles = (isEquipmentView() ? partSpec?.cameraOrbit : ASSETS.orbit)?.match(/-?[\d.]+deg/g)?.map(parseFloat) || [28, 60];
  viewer.fieldOfView = isEquipmentView() ? (partSpec?.fieldOfView || '32deg') : '32deg';
  await viewer.updateComplete;
  if (token !== framingRevision || !state.loaded) return;
  viewer.jumpCameraToGoal?.();
  // getFieldOfView is the effective vertical FOV; model-viewer adjusts it for
  // narrow viewports. Using the attribute's nominal value would over-zoom out.
  const fit = fitCameraToBounds({ bounds, aspect: viewer.clientWidth / Math.max(1, viewer.clientHeight),
    theta: orbit?.theta ?? angles[0] * Math.PI / 180, phi: orbit?.phi ?? angles[1] * Math.PI / 180,
    fieldOfView: viewer.getFieldOfView?.() || 32, padding: 1.10 });
  fittedRadius = fit.radius;
  viewer.setAttribute('max-camera-orbit', `auto 88deg ${Math.max(8, fit.radius * 5)}m`);
  viewer.cameraTarget = `${fit.target.x}m ${fit.target.y}m ${fit.target.z}m`;
  viewer.cameraOrbit = `${fit.theta}rad ${fit.phi}rad ${fit.radius}m`;
  await viewer.updateComplete;
  if (token !== framingRevision || !state.loaded) return;
  viewer.jumpCameraToGoal?.();
  viewer.dataset.fittedRadius = String(fit.radius);
}

function inspectMaterials() {
  materials = [];
  for (const material of viewer.model?.materials || []) {
    // PET bottles retain their material. Only deliberately named enclosure parts are altered.
    if (!/(enclosure[ _-]*(glass|shell)|guard[ _-]*(glass|cover)|围护|防护玻璃)/i.test(material.name || '')) continue;
    const pbr = material.pbrMetallicRoughness;
    if (!pbr?.setBaseColorFactor || !material.setAlphaMode) continue;
    materials.push({ material, color: [...pbr.baseColorFactor], alpha: material.getAlphaMode?.() || 'OPAQUE' });
  }
  $('xray').disabled = !state.loaded || state.detail || !materials.length;
  $('xray').title = materials.length ? '透视围护结构，查看内部机构' : '当前模型未提供可透视的围护材质';
}
function setXray(value) {
  if (value && !materials.length) { notify('当前模型没有可独立透视的围护结构。'); return; }
  try {
    for (const item of materials) {
      item.material.setAlphaMode(value ? 'BLEND' : item.alpha);
      const color = [...item.color];
      if (value) color[3] = /glass/i.test(item.material.name) ? 0.006 : 0.045;
      item.material.pbrMetallicRoughness.setBaseColorFactor(color);
    }
    state.xray = Boolean(value);
    $('xray').setAttribute('aria-pressed', String(state.xray));
    if (value) {
      const filling = demoCase.processes.find((process) => process.id === 'filling') || demoCase.processes[2];
      if (filling) selectProcess(filling.id);
      notify('已透视灌装区围护。点击“设备解构”，进一步展开接液与密封部件。', 2800);
    } else frameModel();
  } catch (error) {
    state.xray = false;
    $('xray').setAttribute('aria-pressed', 'false');
    notify('此设备暂不支持材质透视，请使用设备解构查看机构。');
  }
}
function selectProcess(id, focus = true) {
  const process = demoCase.processes.find((item) => item.id === id);
  if (!process) return;
  state.selected = id;
  updateAnalysisLink();
  processButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
  hotspots.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
  $('process-number').textContent = process.number;
  $('process-name').textContent = process.name;
  $('process-copy').textContent = process.controls;
  if (focus && state.loaded && !state.detail) {
    viewer.cameraTarget = process.cameraTarget;
    viewer.cameraOrbit = process.cameraOrbit;
    if (reducedMotion.matches) viewer.jumpCameraToGoal?.();
  }
}
function updateAnalysisLink() {
  const part = partSpec?.parts.find((item) => item.id === selectedPart);
  const processId = isEquipmentView() ? (state.detailScope === 'valve' ? 'p03' : part?.process || state.equipmentId) : state.selected;
  const process = demoCase.processes.find((item) => item.id === processId) || demoCase.processes[2];
  const params = new URLSearchParams({ case: caseId, view: 'result', process: process.id });
  $('analysis-link').href = `analysis.html?${params}`;
  $('analysis-link').firstElementChild.textContent = state.detail && state.detailScope === 'valve' ? '查看灌装 HACCP' : '查看 HACCP 方案';
}
function stopFlowDrawing() { cancelAnimationFrame(flowFrame); flowFrame = 0; }
function drawFlow(now) {
  if (!state.flow || state.detail || !state.loaded || document.hidden || stage.inert) { flowFrame = 0; return; }
  flowFrame = requestAnimationFrame(drawFlow);
  if (now - flowLastDraw < 80) return;
  flowLastDraw = now;
  const points = [...hotspots.values()].map((node) => {
    const box = node.getBoundingClientRect();
    return stagePoint(box.left + box.width / 2, box.top + box.height / 2);
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const overlay = $('flow-overlay');
  overlay.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
  const path = $('flow-track');
  path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
  const dot = $('flow-dot');
  dot.hidden = reducedMotion.matches;
  dot.style.display = reducedMotion.matches ? 'none' : '';
  if (!reducedMotion.matches && points.length > 1) {
    try {
      const length = path.getTotalLength();
      const point = path.getPointAtLength((now % 6500) / 6500 * length);
      dot.setAttribute('cx', point.x);
      dot.setAttribute('cy', point.y);
    } catch (error) { dot.style.display = 'none'; }
  }
}
function setFlow(value) {
  state.flow = Boolean(value && !state.detail);
  $('flow').setAttribute('aria-pressed', String(state.flow));
  $('process-panel').hidden = !state.flow;
  $('flow-overlay').hidden = !state.flow;
  stage.classList.toggle('flow-open', state.flow);
  hotspots.forEach((node) => { node.hidden = !state.flow; });
  stopFlowDrawing();
  if (state.flow) {
    selectProcess(state.selected, false);
    flowFrame = requestAnimationFrame(drawFlow);
    notify('点击工序编号，聚焦设备并查看控制要求。', 2300);
  }
}
function selectPart(id) {
  const part = partSpec?.parts.find((item) => item.id === id);
  if (!part) return;
  selectedPart = id;
  partButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
  partHotspots.forEach((button, key) => {
    button.setAttribute('aria-pressed', String(key === id));
    button.hidden = !isEquipmentView() || (state.explosion < 0.35 && key !== id);
  });
  $('part-name').textContent = part.name;
  $('part-copy').textContent = part.description || PART_COPY[id] || '';
  updateAnalysisLink();
}
function updateParts() {
  $('parts-panel').hidden = !isEquipmentView();
  $('structure-controls').hidden = !isEquipmentView();
  $('device-picker').hidden = !state.detail || state.detailScope !== 'picker';
  stage.classList.toggle('detail-open', state.detail);
  stage.classList.toggle('equipment-picker', state.detail && state.detailScope === 'picker');
  hotspots.forEach((button) => { button.hidden = !(state.flow || (state.detail && state.detailScope === 'picker')); });
  partSpec?.parts.forEach((part) => {
    const position = part.assembled.map((value, index) => value + (part.exploded[index] - value) * state.explosion);
    const hotspot = partHotspots.get(part.id);
    if (hotspot) {
      hotspot.dataset.position = position.map((value) => `${value}m`).join(' ');
      viewer.updateHotspot?.({ name: hotspot.slot, position: hotspot.dataset.position, normal: '0 0 1' });
    }
  });
  selectPart(selectedPart);
}
function buildPartControls() {
  partHotspots.forEach((node) => node.remove());
  partHotspots.clear();
  partButtons.clear();
  $('parts-strip').replaceChildren();
  if (!partSpec) return;
  selectedPart = partSpec.parts[0]?.id;
  partSpec.parts.forEach((part, index) => {
    const hotspot = document.createElement('button');
    hotspot.type = 'button';
    hotspot.className = 'hotspot part-hotspot';
    hotspot.slot = `hotspot-part-${part.id}`;
    hotspot.dataset.normal = '0 0 1';
    hotspot.textContent = String(index + 1).padStart(2, '0');
    hotspot.setAttribute('aria-label', part.name);
    hotspot.hidden = true;
    hotspot.addEventListener('click', () => selectPart(part.id));
    viewer.append(hotspot);
    partHotspots.set(part.id, hotspot);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${String(index + 1).padStart(2, '0')} ${part.name}`;
    button.addEventListener('click', () => selectPart(part.id));
    $('parts-strip').append(button);
    partButtons.set(part.id, button);
  });
  updateParts();
}
async function prepareParts() {
  try {
    const responses = await Promise.all(['assets/equipment/equipment-catalog.json', 'assets/filler-structure-parts.json'].map((url) => fetch(url)));
    if (responses.some((response) => !response.ok)) throw new Error('Part metadata unavailable');
    const [catalog, valve] = await Promise.all(responses.map((response) => response.json()));
    equipmentCatalog = catalog.equipment;
    if (!Array.isArray(equipmentCatalog) || equipmentCatalog.length !== 6) throw new Error('Equipment catalog invalid');
    equipmentCatalog.forEach((equipment) => {
      specs.set(equipment.id, equipment);
      const option = document.createElement('option'); option.value = equipment.id; option.textContent = equipment.name;
      $('equipment-select').append(option);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = equipment.name;
      button.dataset.equipment = equipment.id;
      button.addEventListener('click', () => setEquipment(equipment.id));
      $('device-strip').append(button);
    });
    valve.src = ASSETS.valveStructure;
    specs.set('valve', valve);
    $('detail').disabled = !state.loaded;
  } catch (error) {
    $('parts-panel').hidden = true;
    $('detail').disabled = true;
    notify('结构资料暂时不可用，可以继续查看产线；刷新后可重试。');
  }
}
function applyZoom(factor) {
  if (!state.loaded || !Number.isFinite(factor) || factor <= 0) return;
  const orbit = viewer.getCameraOrbit();
  const radius = Math.max(state.detailScope === 'valve' && state.detail ? 0.65 : 0.3, Math.min(Math.max(8, fittedRadius * 5), orbit.radius / Math.max(0.7, Math.min(1.4, factor))));
  viewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${radius}m`;
  viewer.jumpCameraToGoal?.();
}
function applyRotate({ azimuthDelta, polarDelta }) {
  if (!state.loaded) return;
  const orbit = viewer.getCameraOrbit();
  const polar = Math.max(Math.PI / 12, Math.min(Math.PI * 0.489, orbit.phi + polarDelta));
  viewer.cameraOrbit = `${orbit.theta + azimuthDelta}rad ${polar}rad ${orbit.radius}m`;
  viewer.jumpCameraToGoal?.();
}
function applyExplosion(value, syncHands = true) {
  if (!isEquipmentView() || !Number.isFinite(value)) return;
  const changed = Math.abs(state.explosion - value) > 0.00001;
  state.explosion = Math.max(0, Math.min(1, value));
  const percent = Math.round(state.explosion * 100);
  $('explode-range').value = String(percent);
  $('explode-value').value = `${percent}%`;
  $('assembled').setAttribute('aria-pressed', String(state.explosion < 0.01));
  $('exploded').setAttribute('aria-pressed', String(state.explosion > 0.99));
  if (state.loaded) {
    viewer.pause();
    const duration = Math.min(partSpec?.explosionDuration || 2, viewer.duration || 2);
    // model-viewer wraps an exact clip-end time to zero; retain the last pose.
    viewer.currentTime = Math.min(state.explosion * duration, Math.max(0, duration - 0.0001));
  }
  if (syncHands) handController?.setExplode(state.explosion);
  updateParts();
  if (changed && state.loaded) void frameModel(true);
}
function setExplosion(value, syncHands = true) {
  cancelAnimationFrame(explosionFrame);
  explosionFrame = 0;
  applyExplosion(value, syncHands);
}
function animateExplosion(value) {
  cancelAnimationFrame(explosionFrame);
  if (!state.loaded || !isEquipmentView()) return;
  if (reducedMotion.matches) { setExplosion(value); return; }
  const from = state.explosion;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 650);
    applyExplosion(from + (value - from) * (p * p * (3 - 2 * p)));
    explosionFrame = p < 1 ? requestAnimationFrame(step) : 0;
  };
  explosionFrame = requestAnimationFrame(step);
}
const touchController = new TouchStructureController({ element: viewer, onZoom: applyZoom, onRotate: applyRotate, onExplode: setExplosion, getExplode: () => state.explosion, mapPoint: (event) => {
  if (!isRotatedStage()) return { x: event.clientX, y: event.clientY };
  const rect = viewer.getBoundingClientRect();
  return { x: event.clientY - rect.top, y: rect.right - event.clientX };
} });
function updateViewControls() {
  if (!state.loaded) return;
  if (stage.inert) { touchController.disable(); return; }
  if (isEquipmentView() || isRotatedStage()) {
    viewer.removeAttribute('camera-controls');
    touchController.enable();
  } else {
    touchController.disable();
    viewer.setAttribute('camera-controls', '');
  }
}
setupOrientation({ stage, button: $('orientation-toggle'), fullscreenTarget: document.documentElement, onChange: () => {
  touchController.disable();
  requestAnimationFrame(() => { frameModel(); updateViewControls(); });
} });
function switchSource(src) {
  sourceVersion += 1;
  const version = sourceVersion;
  const sameSource = viewer.loaded && new URL(viewer.src, document.baseURI).href === new URL(src, document.baseURI).href;
  touchController.disable();
  state.loaded = false;
  state.playing = false;
  stage.classList.remove('loaded');
  $('model-error').hidden = true;
  $('play').disabled = true;
  $('reset').disabled = true;
  $('xray').disabled = true;
  $('flow').disabled = true;
  $('native-ar').disabled = true;
  ['assembled', 'exploded', 'explode-range', 'zoom-in', 'zoom-out'].forEach((id) => { $(id).disabled = true; });
  $('load-label').textContent = state.detail ? '正在呈现设备结构' : '正在呈现产线模型';
  $('load-progress').value = 0;
  if (sameSource) queueMicrotask(() => { if (version === sourceVersion) viewer.dispatchEvent(new Event('load')); });
  else viewer.src = src;
}
function setDetail(value) {
  if (value && !equipmentCatalog.length) { notify('设备结构正在加载，稍后再试。'); return; }
  if (state.xray) setXray(false);
  stopHands();
  cancelAnimationFrame(explosionFrame);
  setFlow(false);
  setPlaying(false);
  state.detail = Boolean(value);
  state.detailScope = 'picker';
  state.equipmentId = null;
  state.explosion = 0;
  partSpec = null;
  buildPartControls();
  updateAnalysisLink();
  $('detail').setAttribute('aria-pressed', String(state.detail));
  $('detail-panel').hidden = !state.detail;
  $('scope-line').hidden = true;
  $('scope-valve').hidden = true;
  $('equipment-select').value = '';
  $('detail-level').textContent = '产线 → 选择设备';
  $('detail-title').textContent = '选择一台设备';
  $('detail-copy').textContent = '点击模型中的设备编号，查看这台设备的部件拆分。';
  updateParts();
  touchController.disable();
  viewer.setAttribute('camera-controls', '');
  switchSource(ASSETS.line);
}
function setEquipment(id, innerValve = false) {
  if (!specs.has(id)) return;
  const scope = innerValve ? 'valve' : id;
  if (isEquipmentView() && scope === state.detailScope) return;
  cancelAnimationFrame(explosionFrame);
  if (state.xray) setXray(false);
  setFlow(false);
  setPlaying(false);
  state.detail = true;
  state.detailScope = scope;
  state.equipmentId = id;
  state.selected = id;
  state.explosion = 0;
  partSpec = specs.get(scope);
  buildPartControls();
  $('detail-panel').hidden = false;
  $('detail').setAttribute('aria-pressed', 'true');
  $('equipment-select').value = id;
  $('scope-line').hidden = false;
  $('scope-valve').hidden = id !== 'p03';
  $('scope-valve').textContent = innerValve ? '← 灌装机' : '灌装阀内件';
  $('detail-level').textContent = `产线 → ${specs.get(id).name} → ${innerValve ? '阀内件' : '部件'}`;
  $('detail-title').textContent = innerValve ? '灌装阀内件' : specs.get(id).name;
  $('detail-copy').textContent = '当前只展开这台设备的部件。点击部件编号查看作用。';
  viewer.removeAttribute('ios-src');
  viewer.removeAttribute('camera-controls');
  setExplosion(0);
  updateParts();
  switchSource(partSpec.src);
}
function stopHands(resumeAR = true) {
  const wasActive = handWanted;
  dualAbort?.abort(); dualAbort = null; clearTimeout(dualTimer);
  handWanted = false;
  handGeneration += 1;
  handController?.stop();
  handController = null;
  $('hand-label').textContent = '隔空手势';
  $('hand-control').setAttribute('aria-pressed', 'false');
  $('gesture-panel').hidden = true;
  $('hand-preview').replaceChildren();
  stage.classList.remove('hands-active');
  if (wasActive && state.detail && state.loaded) requestAnimationFrame(frameModel);
  if (wasActive && resumeAR) void window.ExhibitCamera?.resume();
}
async function startHands() {
  if (handWanted) { stopHands(); return; }
  if (!state.loaded || !equipmentCatalog.length) { notify('请等待设备结构加载后再开启手势。'); return; }
  if (!isEquipmentView()) { setDetail(true); notify('请先选择一台设备，再开启隔空手势控制它的部件。'); return; }
  const rear = window.ExhibitCamera?.getState();
  if (rear?.mode === 'ar' && rear.phase !== 'active') { notify('请先允许 AR 实景权限，再开启前置手势。'); return; }
  handWanted = true;
  const token = ++handGeneration;
  const failedHands = async (message) => {
    if (token !== handGeneration || !handWanted) return;
    stopHands(false);
    const camera = window.ExhibitCamera;
    if (rear?.phase === 'active' && !document.hidden && !stage.inert && camera?.getState().mode === 'ar') {
      camera.stop();
      const restored = await camera.resume();
      notify(`${message}${restored ? ' 后置实景已恢复。' : ' 请重试 AR 恢复实景。'}`, 9500);
    } else notify(message);
  };
  $('hand-control').setAttribute('aria-pressed', 'true');
  $('hand-label').textContent = '取消手势';
  $('gesture-panel').hidden = false;
  $('hand-state').textContent = '正在加载本地手势识别';
  stage.classList.add('hands-active');
  requestAnimationFrame(frameModel);
  try {
    const [{ HandGestureController }, { verifyConcurrentCamera }] = await Promise.all([import('./hand-gestures.js?v=7'), import('./dual-camera.js?v=6')]);
    if (token !== handGeneration || !handWanted) return;
    let latestMessage = '', frontVideo = null, dualVerified = false;
    const controller = new HandGestureController({
      onZoom: (factor) => { if (token === handGeneration && handWanted) applyZoom(factor); },
      onExplode: (value) => { if (token === handGeneration && handWanted) setExplosion(value, false); },
      onStatus: ({ state: status, message, hands }) => {
        if (token !== handGeneration || !handWanted) return;
        latestMessage = message;
        $('hand-state').textContent = message;
        $('hand-help').textContent = `${dualVerified ? '前摄手势 · 后摄实景 · ' : '前摄手势 · '}${hands === 2 ? '双手拉开拆分 · 合拢复原' : '单手捏合缩放 · 双手拉开拆分'}`;
        if (status === 'ready' || status === 'tracking' || status === 'searching') $('hand-label').textContent = '关闭手势';
        if (status === 'error' || status === 'stopped') queueMicrotask(() => {
          if (token !== handGeneration || !handWanted) return;
          void failedHands(latestMessage || '隔空手势已停止，可以继续使用触屏和滑杆。');
        });
      },
      onPreview: (video) => {
        if (token !== handGeneration || !handWanted) return;
        frontVideo = video;
        $('hand-preview').replaceChildren(...(video ? [video] : []));
      },
    });
    handController = controller;
    controller.setExplode(state.explosion);
    const started = await controller.start({ facingMode: 'user' });
    if (token !== handGeneration || !handWanted) { controller.stop(); return; }
    if (!started) {
      const message = $('hand-state').textContent;
      await failedHands(message || '手势识别暂未启动，可继续使用触屏或拆分滑杆。');
      return;
    }
    if (rear?.phase === 'active' && rear.stream) {
      dualAbort = new AbortController();
      const signal = dualAbort.signal;
      const check = async () => {
        const result = await verifyConcurrentCamera({ rearStream: rear.stream, rearVideo: feed, frontVideo, timeoutMs: 1600, signal });
        if (signal.aborted || token !== handGeneration || !handWanted) return;
        if (!result.supported) {
          stopHands(false);
          const camera = window.ExhibitCamera;
          if (!document.hidden && !stage.inert && camera?.getState().mode === 'ar') {
            camera.stop();
            const restored = await camera.resume();
            notify(restored ? '本次浏览器未能同时保持前后双摄。已关闭前置手势并恢复实景，请使用触屏拆分。' : '本次双摄未能同时工作。前置手势已关闭，请重试 AR 恢复实景。', 9500);
          }
          return;
        }
        dualVerified = true;
        $('hand-help').textContent = '前摄手势 · 后摄实景 · 单手捏合缩放，双手拉开拆分';
        dualTimer = setTimeout(() => void check(), 1500);
      };
      $('hand-state').textContent = '正在确认前后双摄同时出画';
      void check();
    }
  } catch (error) {
    if (token !== handGeneration) return;
    await failedHands('手势资源暂不可用，可继续使用触屏与拆分滑杆，稍后再试。');
  }
}
function refreshAR() {
  $('native-ar').disabled = caseId !== demoCase.id;
  $('native-ar').title = '通过本站空间定位将示意产线放在桌面，无需 Google 服务';
}

let mainPrepared = false;
async function ensureMainModel() {
  if (mainPrepared || caseId !== demoCase.id) return;
  mainPrepared = true;
  await customElements.whenDefined('model-viewer');
  if (ASSETS.poster) viewer.poster = ASSETS.poster;
  viewer.src = ASSETS.line;
  if (viewer.loaded) viewer.dispatchEvent(new Event('load'));
}

const walkthrough = setupWalkthrough({
  panel: $('walkthrough-panel'), viewer: $('walkthrough-viewer'), openButton: $('walkthrough-open'),
  closeButton: $('walkthrough-close'), startButton: $('walkthrough-start'), retryButton: $('walkthrough-retry'),
  status: $('walkthrough-status'), dimensions: $('walkthrough-dimensions'), progress: $('walkthrough-progress'),
  canvas: $('spatial-canvas'), session: $('spatial-session'), placeButton: $('spatial-place'),
  resetButton: $('spatial-reset'), exitButton: $('spatial-exit'), hudStatus: $('spatial-status'), title: $('walkthrough-title'),
  onOpen: () => {
    stopHands(false); stopCamera(); setPlaying(false); touchController.disable(); stopFlowDrawing();
    stage.inert = true; stage.setAttribute('aria-hidden', 'true');
  },
  onClose: () => {
    tourTouch.disable();
    void ensureMainModel();
    stage.inert = false; stage.removeAttribute('aria-hidden');
    if (!document.hidden) void window.ExhibitCamera?.resume();
    setPlaying(!reducedMotion.matches && !document.hidden && !state.detail);
    updateViewControls();
    if (state.flow && !stage.inert) { stopFlowDrawing(); flowFrame = requestAnimationFrame(drawFlow); }
  },
});
const tourViewer = $('walkthrough-viewer');
const tourPanel = $('walkthrough-panel');
const tourTouch = new TouchStructureController({
  element: tourViewer, getExplode: () => 0, onExplode: () => {},
  mapPoint: (event) => {
    const rect = tourViewer.getBoundingClientRect();
    return { x: event.clientY - rect.top, y: rect.right - event.clientX };
  },
  onZoom: (factor) => {
    if (!tourViewer.loaded) return;
    const orbit = tourViewer.getCameraOrbit();
    tourViewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${Math.max(0.15, Math.min(100, orbit.radius / factor))}m`;
    tourViewer.jumpCameraToGoal?.();
  },
  onRotate: ({ azimuthDelta, polarDelta }) => {
    if (!tourViewer.loaded) return;
    const orbit = tourViewer.getCameraOrbit();
    tourViewer.cameraOrbit = `${orbit.theta + azimuthDelta}rad ${Math.max(0.05, Math.min(Math.PI / 2, orbit.phi + polarDelta))}rad ${orbit.radius}m`;
    tourViewer.jumpCameraToGoal?.();
  },
});
async function updateTourView() {
  if (tourPanel.hidden || !tourViewer.loaded || walkthrough.getState().active) { tourTouch.disable(); walkthrough.resize(); return; }
  const token = ++tourFramingRevision;
  const rotated = tourPanel.classList.contains('force-landscape') && innerHeight > innerWidth;
  if (rotated) { tourViewer.removeAttribute('camera-controls'); tourTouch.enable(); }
  else { tourTouch.disable(); tourViewer.setAttribute('camera-controls', ''); }
  const bounds = walkthrough.getState().metadata?.bounds || viewerBounds(tourViewer);
  if (!bounds) return;
  tourViewer.fieldOfView = '38deg';
  await tourViewer.updateComplete;
  if (token !== tourFramingRevision || tourPanel.hidden || walkthrough.getState().active) return;
  tourViewer.jumpCameraToGoal?.();
  const fit = fitCameraToBounds({ bounds, aspect: tourViewer.clientWidth / Math.max(1, tourViewer.clientHeight),
    theta: 28 * Math.PI / 180, phi: 65 * Math.PI / 180,
    fieldOfView: tourViewer.getFieldOfView?.() || 38, padding: 1.10 });
  tourViewer.setAttribute('max-camera-orbit', `auto 90deg ${fit.radius * 5}m`);
  tourViewer.cameraTarget = `${fit.target.x}m ${fit.target.y}m ${fit.target.z}m`;
  tourViewer.cameraOrbit = `${fit.theta}rad ${fit.phi}rad ${fit.radius}m`;
  await tourViewer.updateComplete;
  if (token !== tourFramingRevision || tourPanel.hidden || walkthrough.getState().active) return;
  tourViewer.jumpCameraToGoal?.();
}

setupOrientation({ stage: tourPanel, button: $('tour-orientation'), fullscreenTarget: document.documentElement,
  onChange: () => requestAnimationFrame(updateTourView) });
tourViewer.addEventListener('load', updateTourView);
setupOrientation({ stage: tourPanel, button: $('spatial-orientation'), fullscreenTarget: document.documentElement,
  onChange: () => requestAnimationFrame(updateTourView) });
window.addEventListener('resize', () => requestAnimationFrame(updateTourView));
$('walkthrough-open').disabled = caseId !== demoCase.id;

$('about-toggle').addEventListener('click', () => {
  const expanded = $('about-toggle').getAttribute('aria-expanded') !== 'true';
  $('about-toggle').setAttribute('aria-expanded', String(expanded));
  $('about-panel').hidden = !expanded;
});
$('about-close').addEventListener('click', () => { $('about-panel').hidden = true; $('about-toggle').setAttribute('aria-expanded', 'false'); });
window.ExhibitCamera?.subscribe(({ phase, mode }) => { if (phase === 'opening' || mode === '3d') stopHands(false); });
$('hand-control').addEventListener('click', () => void startHands());
$('hand-stop').addEventListener('click', () => stopHands());
$('play').addEventListener('click', () => setPlaying(!state.playing));
$('reset').addEventListener('click', frameModel);
$('xray').addEventListener('click', () => setXray(!state.xray));
$('flow').addEventListener('click', () => setFlow(!state.flow));
$('detail').addEventListener('click', () => setDetail(!state.detail));
$('detail-exit').addEventListener('click', () => setDetail(false));
$('assembled').addEventListener('click', () => animateExplosion(0));
$('exploded').addEventListener('click', () => animateExplosion(1));
$('scope-line').addEventListener('click', () => setDetail(true));
$('scope-valve').addEventListener('click', () => setEquipment('p03', state.detailScope !== 'valve'));
$('equipment-select').addEventListener('change', (event) => { if (event.target.value) setEquipment(event.target.value); else setDetail(true); });
$('explode-range').addEventListener('input', (event) => setExplosion(Number(event.target.value) / 100));
$('zoom-in').addEventListener('click', () => applyZoom(1.18));
$('zoom-out').addEventListener('click', () => applyZoom(1 / 1.18));
$('native-ar').addEventListener('click', () => void walkthrough.open('tabletop'));
$('retry-model').addEventListener('click', () => {
  const src = isEquipmentView() ? partSpec.src : ASSETS.line;
  switchSource(`${src}${src.includes('?') ? '&' : '?'}retry=${Date.now()}`);
});
viewer.addEventListener('progress', (event) => { $('load-progress').value = event.detail?.totalProgress || 0; });
viewer.addEventListener('load', async () => {
  const version = sourceVersion;
  state.loaded = true;
  stage.classList.add('loaded');
  $('model-error').hidden = true;
  $('play').disabled = state.detail || !viewer.availableAnimations?.length;
  $('reset').disabled = false;
  $('flow').disabled = state.detail;
  $('detail').disabled = !equipmentCatalog.length;
  ['assembled', 'exploded', 'explode-range', 'zoom-in', 'zoom-out'].forEach((id) => { $(id).disabled = false; });
  const clips = viewer.availableAnimations || [];
  if (clips.length) viewer.animationName = isEquipmentView() ? (partSpec?.animation || clips[0]) : (clips.includes('LineCycle') ? 'LineCycle' : clips[0]);
  await viewer.updateComplete;
  if (version !== sourceVersion) return;
  frameModel();
  inspectMaterials();
  updateParts();
  refreshAR();
  setPlaying(!reducedMotion.matches && !document.hidden && !state.detail);
  if (isEquipmentView()) applyExplosion(state.explosion);
  updateViewControls();
  if (state.flow) { stopFlowDrawing(); flowFrame = requestAnimationFrame(drawFlow); }
});
viewer.addEventListener('error', () => {
  state.loaded = false;
  state.playing = false;
  stopHands();
  cancelAnimationFrame(explosionFrame);
  touchController.disable();
  stopFlowDrawing();
  ['play', 'reset', 'xray', 'flow', 'native-ar', 'assembled', 'exploded', 'explode-range', 'zoom-in', 'zoom-out'].forEach((id) => { $(id).disabled = true; });
  $('model-error').hidden = false;
  stage.classList.add('loaded');
});

reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) setPlaying(false); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopHands(); setPlaying(false); stopFlowDrawing(); cancelAnimationFrame(explosionFrame); touchController.disable(); }
  else {
    if (state.loaded) updateViewControls();
    if (state.flow && !stage.inert) { stopFlowDrawing(); flowFrame = requestAnimationFrame(drawFlow); }
  }
});
window.addEventListener('pagehide', () => { stopHands(); setPlaying(false); stopFlowDrawing(); cancelAnimationFrame(explosionFrame); touchController.disable(); clearTimeout(toastTimer); });
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { frameModel(); updateViewControls(); }, 120);
});

if (caseId !== demoCase.id) {
  stage.classList.add('case-invalid');
  $('case-error').hidden = false;
  viewer.removeAttribute('src');
  viewer.removeAttribute('ios-src');
} else {
  $('analysis-link').href = `analysis.html?case=${encodeURIComponent(caseId)}&view=result`;
  demoCase.processes.forEach((process) => {
    const hotspot = document.createElement('button');
    hotspot.type = 'button';
    hotspot.className = 'hotspot';
    hotspot.slot = `hotspot-${process.id}`;
    hotspot.dataset.position = process.position;
    hotspot.dataset.normal = '0 1 0';
    hotspot.dataset.visibilityAttribute = 'visible';
    hotspot.textContent = process.number;
    hotspot.setAttribute('aria-label', `${process.number} ${process.name}`);
    hotspot.setAttribute('aria-pressed', 'false');
    hotspot.hidden = true;
    hotspot.addEventListener('click', () => { if (state.detail && state.detailScope === 'picker') setEquipment(process.id); else selectProcess(process.id); });
    viewer.append(hotspot);
    hotspots.set(process.id, hotspot);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'process-step';
    button.setAttribute('aria-pressed', 'false');
    const number = document.createElement('span');
    number.textContent = process.number;
    const name = document.createElement('span');
    name.textContent = process.name;
    button.append(number, name);
    button.addEventListener('click', () => selectProcess(process.id));
    $('process-strip').append(button);
    processButtons.set(process.id, button);
  });
  selectProcess(state.selected, false);
  void prepareParts();
  if (new URLSearchParams(location.search).get('tour') === 'lifesize') void walkthrough.open();
  else void ensureMainModel();
}
// Observe the real drawing area, including permission/fullscreen transitions
// and appearance of a tool panel, instead of assuming a phone's screen ratio.
if (globalThis.ResizeObserver) {
  let layoutFrame = 0;
  const scheduleLayout = () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      syncSceneLayout();
      if (state.loaded && !stage.inert) void frameModel();
      void updateTourView();
    });
  };
  const layoutObserver = new ResizeObserver(scheduleLayout);
  layoutObserver.observe(viewer);
  layoutObserver.observe(tourViewer);
  for (const element of [stage, stage.querySelector('.bottom-dock'), $('detail-panel')]) layoutObserver.observe(element);
}
