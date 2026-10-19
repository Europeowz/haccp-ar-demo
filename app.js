import { demoCase } from './case-data.js';

const byId = (id) => document.getElementById(id);
const viewer = byId('viewer');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(window.location.search);
const caseId = params.get('case') || 'water';
const defaultTarget = '0m 0.18m -0.20m';
const defaultOrbit = '28deg 44deg 5.1m';
const text = (value) => Array.isArray(value) ? value.join('；') : String(value ?? '待复核');
const setText = (id, value) => { byId(id).textContent = text(value); };
const create = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = text(value);
  if (className) node.className = className;
  return node;
};

if (caseId !== demoCase.id || !Array.isArray(demoCase.processes) || !demoCase.processes.length) {
  byId('case-error').hidden = false;
  document.querySelectorAll('.project-intro, #generation-panel, #workspace, .report-panel, .scope-note').forEach((section) => { section.hidden = true; });
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
} else {
  startDemo();
}

function startDemo() {
  const processes = demoCase.processes;
  const entryProcess = processes.find((process) => process.id === params.get('process'));
  let selectedId = entryProcess?.id || processes[0].id;
  let reportTab = 'hazards';
  let modelLoaded = false;
  let animationPlaying = false;
  let autoRotate = false;
  let annotationsVisible = true;
  let guideTimer = null;
  let generationTimer = null;
  let generationStartedAt = 0;
  let activeStage = -1;
  let currentGeneration = false;
  let downloadRevokeTimer = null;
  let lastDownloadUrl = null;
  const processButtons = new Map();
  const hotspots = new Map();
  const tableRows = new Map();
  const stages = [
    { title: '方案示例', note: '载入内置饮料方案，展示方案与模型的对应关系。' },
    { title: '工序识别', note: '按示例方案排列六道工序，并标出对应设备位置。' },
    { title: '危害分析', note: '逐工位展示预置的生物、化学与物理危害分析。' },
    { title: 'CCP 与限值', note: '呈现示例判定依据与需要企业确认的关键限值。' },
    { title: '监控与纠偏', note: '对应示例监控方法、异常处置与记录要求。' },
    { title: '计划与模型', note: '汇总示例计划草案，关联工艺、分析表与三维工位。' },
  ];
  const stageElements = [];

  setText('case-title', demoCase.title);
  setText('case-product', demoCase.product);
  setText('source-label', demoCase.sourceLabel);
  setText('case-version', demoCase.version);
  document.title = `${text(demoCase.title)} · HACCP 可视化演示`;

  stages.forEach((stage, index) => {
    const item = create('li', undefined, 'stage-item');
    item.dataset.state = 'pending';
    item.append(create('span', String(index + 1).padStart(2, '0'), 'stage-number'), create('span', stage.title, 'stage-title'), create('span', stage.note, 'stage-detail'));
    stageElements.push(item);
    byId('generation-steps').append(item);
  });

  processes.forEach((process) => {
    const button = create('button', undefined, 'flow-step');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(create('span', String(process.number).padStart(2, '0'), 'flow-number'), create('span', process.name, 'flow-name'));
    button.addEventListener('click', () => chooseProcess(process.id));
    byId('process-strip').append(button);
    processButtons.set(process.id, button);

    const hotspot = create('button', undefined, 'model-hotspot');
    hotspot.type = 'button';
    hotspot.slot = `hotspot-${process.id}`;
    hotspot.dataset.position = text(process.position);
    hotspot.dataset.normal = '0 1 0';
    hotspot.dataset.label = process.name;
    hotspot.setAttribute('aria-label', `${process.number} ${process.name}，查看工位分析`);
    hotspot.setAttribute('aria-pressed', 'false');
    hotspot.append(create('span', String(process.number).padStart(2, '0'), 'hotspot-number'), create('span', process.name, 'hotspot-name'));
    hotspot.addEventListener('click', () => chooseProcess(process.id));
    viewer.append(hotspot);
    hotspots.set(process.id, hotspot);
  });

  function chooseProcess(id) {
    if (currentGeneration) completeGeneration();
    stopGuide();
    selectProcess(id, true);
  }

  function selectProcess(id, focus = false) {
    const process = processes.find((item) => item.id === id);
    if (!process) return;
    selectedId = id;
    processButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
    hotspots.forEach((hotspot, key) => hotspot.setAttribute('aria-pressed', String(key === id)));
    tableRows.forEach((row, key) => { row.dataset.selected = String(key === id); });
    setText('inspector-title', process.name);
    setText('inspector-number', String(process.number).padStart(2, '0'));
    setText('inspector-action', process.action);
    byId('inspector-hazards').replaceChildren();
    [['生物', 'biological'], ['化学', 'chemical'], ['物理', 'physical']].forEach(([label, key]) => {
      const hazard = create('div', undefined, 'hazard-item');
      hazard.append(create('strong', label), create('span', process.hazards?.[key]));
      byId('inspector-hazards').append(hazard);
    });
    const fields = {
      controls: process.controls, ccp: process.ccpStatus, reason: process.ccpReason,
      limit: process.limit, monitoring: process.monitoring, corrective: process.corrective,
      record: process.record, source: `示例依据：${text(process.sourceRef)}`,
    };
    Object.entries(fields).forEach(([key, value]) => setText(`inspector-${key}`, value));
    if (focus && modelLoaded) {
      viewer.cameraTarget = text(process.cameraTarget || defaultTarget);
      viewer.cameraOrbit = text(process.cameraOrbit || defaultOrbit);
      if (reducedMotion.matches && typeof viewer.jumpCameraToGoal === 'function') viewer.jumpCameraToGoal();
    }
  }

  function renderReport() {
    tableRows.clear();
    const headRow = create('tr');
    const headings = reportTab === 'hazards'
      ? ['工序 / 模型定位', '生物危害', '化学危害', '物理危害', '控制措施', 'CCP 判定与依据']
      : ['工序 / 模型定位', '控制点判定', '关键限值 / 确认项', '监控方法', '异常纠偏', '记录'];
    headings.forEach((heading) => {
      const cell = create('th', heading);
      cell.scope = 'col';
      headRow.append(cell);
    });
    byId('report-head').replaceChildren(headRow);
    byId('report-body').replaceChildren();
    processes.forEach((process) => {
      const row = create('tr');
      row.dataset.selected = String(process.id === selectedId);
      const firstCell = create('th');
      firstCell.scope = 'row';
      const link = create('button', `${String(process.number).padStart(2, '0')} ${process.name}`, 'process-link');
      link.type = 'button';
      link.setAttribute('aria-label', `定位${process.name}并查看详情`);
      link.addEventListener('click', () => {
        chooseProcess(process.id);
        byId('workspace').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
      });
      firstCell.append(link);
      row.append(firstCell);
      const values = reportTab === 'hazards'
        ? [process.hazards?.biological, process.hazards?.chemical, process.hazards?.physical, process.controls, `${text(process.ccpStatus)}。${text(process.ccpReason)}`]
        : [process.ccpStatus, process.limit, process.monitoring, process.corrective, process.record];
      values.forEach((value) => row.append(create('td', value)));
      byId('report-body').append(row);
      tableRows.set(process.id, row);
    });
    setText('report-caption', `${reportTab === 'hazards' ? '危害分析' : '控制计划'} · 预置饮料案例草案，点击工序可定位模型。CCP 与限值需结合企业资料复核。`);
    byId('report-tabs').querySelectorAll('button[data-tab]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tab === reportTab));
    });
  }

  byId('report-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button || !['hazards', 'plan'].includes(button.dataset.tab)) return;
    reportTab = button.dataset.tab;
    renderReport();
  });

  function showStage(index) {
    if (index === activeStage) return;
    activeStage = index;
    stageElements.forEach((item, itemIndex) => {
      item.dataset.state = itemIndex < index ? 'complete' : itemIndex === index ? 'active' : 'pending';
      if (itemIndex === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    document.body.dataset.generationStep = String(index + 1);
    setText('phase-label', `演示步骤 ${index + 1}/6 · ${stages[index].title}`);
    setText('generation-note', stages[index].note);
    selectProcess(processes[Math.min(index, processes.length - 1)].id, true);
  }

  function completeGeneration() {
    clearInterval(generationTimer);
    generationTimer = null;
    currentGeneration = false;
    byId('generation-panel').classList.add('is-complete');
    byId('generation-progress').value = 100;
    byId('workspace').dataset.phase = 'ready';
    document.body.dataset.generationStep = 'complete';
    stageElements.forEach((item) => {
      item.dataset.state = 'complete';
      item.removeAttribute('aria-current');
    });
    setText('phase-label', '演示结果已就绪');
    setText('generation-note', `${text(demoCase.sourceLabel)}。选择工序，可联动查看模型、危害与控制计划。`);
    byId('skip').hidden = true;
  }

  function beginGeneration() {
    clearInterval(generationTimer);
    stopGuide();
    if (reducedMotion.matches) {
      completeGeneration();
      selectProcess(processes[0].id, false);
      return;
    }
    currentGeneration = true;
    byId('generation-panel').classList.remove('is-complete');
    activeStage = -1;
    byId('workspace').dataset.phase = 'generating';
    byId('skip').hidden = false;
    byId('generation-progress').value = 0;
    generationStartedAt = performance.now();
    showStage(0);
    generationTimer = setInterval(() => {
      const elapsed = performance.now() - generationStartedAt;
      byId('generation-progress').value = Math.min(100, elapsed / 7200 * 100);
      if (elapsed >= 7200) {
        completeGeneration();
        selectProcess(processes[0].id, false);
        viewer.cameraTarget = defaultTarget;
        viewer.cameraOrbit = defaultOrbit;
      } else {
        showStage(Math.min(5, Math.floor(elapsed / 1200)));
      }
    }, 100);
  }

  byId('replay').addEventListener('click', beginGeneration);
  byId('skip').addEventListener('click', () => {
    completeGeneration();
    selectProcess(processes[0].id, false);
    viewer.cameraTarget = defaultTarget;
    viewer.cameraOrbit = defaultOrbit;
  });

  function updatePlayback() {
    byId('play').textContent = animationPlaying ? '暂停产线' : '播放产线';
    byId('play').setAttribute('aria-pressed', String(animationPlaying));
  }

  function stopGuide() {
    clearInterval(guideTimer);
    guideTimer = null;
    byId('guide').textContent = '工序导览';
    byId('guide').setAttribute('aria-pressed', 'false');
  }

  function updateAR() {
    byId('ar').disabled = !modelLoaded;
    byId('ar').textContent = '等身参观';
    byId('ar').title = '进入本站地面空间参观';
  }

  viewer.addEventListener('progress', (event) => {
    if (modelLoaded) return;
    const value = Math.min(1, Math.max(0, Number(event.detail?.totalProgress) || 0));
    byId('load-progress').value = value;
    setText('load-label', value < 1 ? `正在加载产线模型 ${Math.round(value * 100)}%` : '正在准备模型画面');
  });

  viewer.addEventListener('load', () => {
    modelLoaded = true;
    document.querySelector('.loading-wrap').hidden = true;
    byId('model-error').hidden = true;
    byId('load-progress').value = 1;
    setText('load-label', '模型已加载');
    ['reset', 'rotate', 'guide'].forEach((id) => { byId(id).disabled = false; });
    const hasAnimation = Array.isArray(viewer.availableAnimations) && viewer.availableAnimations.length > 0;
    byId('play').disabled = !hasAnimation;
    if (hasAnimation) {
      viewer.animationName = viewer.availableAnimations.includes('LineCycle') ? 'LineCycle' : viewer.availableAnimations[0];
      if (!reducedMotion.matches) {
        viewer.play();
        animationPlaying = true;
      }
    }
    updatePlayback();
    updateAR();
    const selected = processes.find((process) => process.id === selectedId);
    if ((currentGeneration || entryProcess) && selected) selectProcess(selected.id, true);
    setText('viewer-status', '拖动旋转、双指缩放；点击工序查看分析，或点击等身参观进入地面 AR。');
  });

  viewer.addEventListener('error', () => {
    modelLoaded = false;
    document.querySelector('.loading-wrap').hidden = true;
    animationPlaying = false;
    stopGuide();
    ['play', 'reset', 'rotate', 'guide', 'ar'].forEach((id) => { byId(id).disabled = true; });
    byId('model-error').hidden = false;
    updatePlayback();
    setText('load-label', '模型加载失败');
    setText('viewer-status', '三维模型暂时无法加载。六道工序、危害分析与示例计划仍可查看和下载。');
  });

  byId('play').addEventListener('click', () => {
    if (!modelLoaded) return;
    if (animationPlaying) viewer.pause();
    else viewer.play();
    animationPlaying = !animationPlaying;
    updatePlayback();
  });
  byId('reset').addEventListener('click', () => {
    if (currentGeneration) completeGeneration();
    stopGuide();
    viewer.cameraTarget = defaultTarget;
    viewer.cameraOrbit = defaultOrbit;
    viewer.fieldOfView = '32deg';
    if (reducedMotion.matches && typeof viewer.jumpCameraToGoal === 'function') viewer.jumpCameraToGoal();
    setText('viewer-status', '已恢复整体视角。点击工序可查看对应设备与分析。');
  });
  byId('rotate').addEventListener('click', () => {
    autoRotate = !autoRotate;
    viewer.autoRotate = autoRotate;
    byId('rotate').setAttribute('aria-pressed', String(autoRotate));
    byId('rotate').textContent = autoRotate ? '停止旋转' : '自动旋转';
  });
  byId('guide').addEventListener('click', () => {
    if (guideTimer) {
      stopGuide();
      setText('viewer-status', '工序导览已暂停，可手动选择工序。');
      return;
    }
    if (currentGeneration) completeGeneration();
    autoRotate = false;
    viewer.autoRotate = false;
    byId('rotate').setAttribute('aria-pressed', 'false');
    byId('rotate').textContent = '自动旋转';
    let index = 0;
    selectProcess(processes[index].id, true);
    byId('guide').textContent = '停止导览';
    byId('guide').setAttribute('aria-pressed', 'true');
    setText('viewer-status', '工序导览中，每 4 秒展示一道工序；点击工序或停止导览即可退出。');
    guideTimer = setInterval(() => {
      index += 1;
      if (index >= processes.length) {
        stopGuide();
        setText('viewer-status', '六道工序导览已完成，可继续手动查看。');
        return;
      }
      selectProcess(processes[index].id, true);
    }, 4000);
  });
  byId('annotations').addEventListener('click', () => {
    annotationsVisible = !annotationsVisible;
    hotspots.forEach((hotspot) => { hotspot.hidden = !annotationsVisible; });
    byId('annotations').setAttribute('aria-pressed', String(annotationsVisible));
    byId('annotations').textContent = annotationsVisible ? '隐藏标注' : '显示标注';
  });
  byId('ar').addEventListener('click', () => {
    stopGuide();
    location.href = './?case=water&view=3d&tour=lifesize';
  });

  const markdownValue = (value) => text(value).replace(/\r?\n/g, ' ');
  byId('download-plan').addEventListener('click', () => {
    const lines = [
      `# ${markdownValue(demoCase.title)} — HACCP 示例计划`, '',
      `- 模式：演示模式，预置案例；尚未接入文件解析或实时 AI 分析。`,
      `- 产品：${markdownValue(demoCase.product)}`,
      `- 版本：${markdownValue(demoCase.version)}`,
      `- 来源：${markdownValue(demoCase.sourceLabel)}`,
      `- 范围：${markdownValue(demoCase.scope)}`, '',
      '本文件为展示草案。危害、CCP、关键限值、监控与纠偏要求须由企业结合实际工艺、设备及验证资料审核确认；不构成自动合规结论。', '',
    ];
    processes.forEach((process) => {
      lines.push(`## ${markdownValue(process.number)} ${markdownValue(process.name)}`, '',
        `工艺动作：${markdownValue(process.action)}`, '',
        `- 生物危害：${markdownValue(process.hazards?.biological)}`,
        `- 化学危害：${markdownValue(process.hazards?.chemical)}`,
        `- 物理危害：${markdownValue(process.hazards?.physical)}`,
        `- 控制措施：${markdownValue(process.controls)}`,
        `- CCP 判定：${markdownValue(process.ccpStatus)}`,
        `- 判定依据：${markdownValue(process.ccpReason)}`,
        `- 关键限值 / 确认项：${markdownValue(process.limit)}`,
        `- 监控方法：${markdownValue(process.monitoring)}`,
        `- 异常纠偏：${markdownValue(process.corrective)}`,
        `- 所需记录：${markdownValue(process.record)}`,
        `- 示例依据：${markdownValue(process.sourceRef)}`, '');
    });
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    clearTimeout(downloadRevokeTimer);
    lastDownloadUrl = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const anchor = create('a');
    anchor.href = lastDownloadUrl;
    anchor.download = '饮料灌装线-HACCP示例计划.md';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    downloadRevokeTimer = setTimeout(() => {
      URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = null;
    }, 30000);
  });
  const printReport = create('section', undefined, 'print-only');
  printReport.hidden = true;
  printReport.append(create('h1', `${demoCase.title} · HACCP 示例计划`));
  printReport.append(create('p', `${demoCase.product} / ${demoCase.version} / ${demoCase.sourceLabel}`));
  printReport.append(create('p', demoCase.scope));
  processes.forEach((process) => {
    const section = create('article');
    section.append(create('h2', `${process.number} ${process.name}`), create('p', process.action));
    const fields = [
      ['生物危害', process.hazards.biological], ['化学危害', process.hazards.chemical],
      ['物理危害', process.hazards.physical], ['控制措施', process.controls],
      ['CCP 判定', process.ccpStatus], ['判定依据', process.ccpReason],
      ['关键限值 / 确认项', process.limit], ['监控方法', process.monitoring],
      ['异常纠偏', process.corrective], ['记录', process.record], ['示例依据', process.sourceRef],
    ];
    const definitions = create('dl');
    fields.forEach(([label, value]) => definitions.append(create('dt', label), create('dd', value)));
    section.append(definitions);
    printReport.append(section);
  });
  document.body.append(printReport);

  byId('print-plan').addEventListener('click', () => {
    if (currentGeneration) completeGeneration();
    stopGuide();
    window.print();
  });

  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    if (currentGeneration) completeGeneration();
    stopGuide();
    if (modelLoaded) viewer.pause();
    animationPlaying = false;
    autoRotate = false;
    viewer.autoRotate = false;
    byId('rotate').setAttribute('aria-pressed', 'false');
    byId('rotate').textContent = '自动旋转';
    updatePlayback();
  });

  window.addEventListener('pagehide', () => {
    clearInterval(generationTimer);
    clearTimeout(downloadRevokeTimer);
    stopGuide();
    if (modelLoaded) viewer.pause();
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  });

  viewer.addEventListener('camera-change', (event) => {
    if (event.detail?.source === 'user-interaction') {
      stopGuide();
      if (currentGeneration) completeGeneration();
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && currentGeneration) completeGeneration();
  });

  renderReport();
  selectProcess(selectedId, false);
  if (params.get('view') === 'result' || reducedMotion.matches) completeGeneration();
  else beginGeneration();
  customElements.whenDefined('model-viewer').then(() => {
    // Keep unsupported cases free of model requests; only the configured case
    // reaches this initializer. The head preload uses this same shared URL.
    if (!viewer.src && viewer.dataset.src) viewer.src = viewer.dataset.src;
    if (viewer.loaded && !modelLoaded) viewer.dispatchEvent(new Event('load'));
    updateAR();
    if (viewer.updateComplete) viewer.updateComplete.then(updateAR);
  });
}
