import {HACCP_PRINCIPLES, getHaccpProcess, getReleaseGate, getDeviationScenario} from './haccp-data.js?v=13';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};
let count = 0;

/** The same process ID links every model view to its requirements and missing evidence. */
export function setupHaccpLink({mount, mode = 'overlay', canSelectProcess = () => true, onProcess = () => {}, onScenario = () => {}}) {
  if (!mount) return null;
  const id = `haccp-link-${++count}`;
  let currentId = 'p01', context = '', opened = false, scenarioStep = -1, lastFocus = null;
  const inertSiblings = new Map();
  const peek = element('div', undefined, 'haccp-peek');
  const brief = element('div');
  const briefTitle = element('strong');
  const briefStatus = element('span', 'HACCP 控制要求 · 待企业确认');
  brief.append(briefTitle, briefStatus);
  const openButton = element('button', '查看控制链'); openButton.type = 'button';
  openButton.setAttribute('aria-expanded', 'false'); openButton.setAttribute('aria-controls', id);
  peek.append(brief, openButton);
  const panel = element('section', undefined, `haccp-panel haccp-${mode}`);
  panel.id = id; panel.hidden = true; panel.setAttribute('aria-label', '模型与 HACCP 控制链');
  if (mode === 'overlay') {panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');}
  mount.append(peek);
  if (mode === 'overlay') (mount.closest('.orientation-surface') || mount).append(panel);
  else mount.append(panel);

  function render() {
    const process = getHaccpProcess(currentId), gate = getReleaseGate(currentId);
    if (!process) return;
    briefTitle.textContent = `${process.number || currentId.slice(1)} ${process.name} · 食品安全控制`;
    peek.dataset.process = panel.dataset.process = currentId;
    panel.replaceChildren();
    const heading = element('header', undefined, 'haccp-heading');
    const title = element('div'); title.append(element('small', '模型 → 工序 → 控制 → 证据'), element('h2', '食品安全控制链'));
    const close = element('button', '关闭'); close.type = 'button'; close.setAttribute('aria-label', '关闭 HACCP 控制链'); close.addEventListener('click', closePanel);
    heading.append(title, close); panel.append(heading);
    const body = element('div', undefined, 'haccp-body');
    body.append(element('p', '模型展示控制要求和关联位置；真实有效性须由企业确认、实施并持续验证。当前未连接现场监测或审核记录。', 'haccp-intro'));
    const chips = element('nav', undefined, 'haccp-processes'); chips.setAttribute('aria-label', '选择 HACCP 工序');
    for (let index = 1; index <= 6; index++) {
      const processId = `p0${index}`, item = getHaccpProcess(processId);
      if (!item) continue;
      const button = element('button', `${String(index).padStart(2,'0')} ${item.name}`); button.type = 'button';
      button.dataset.process = processId; button.setAttribute('aria-pressed', String(currentId === processId));
      button.addEventListener('click', () => {
        if (!canSelectProcess(processId)) return;
        setProcess(processId); onProcess(processId);
        // The model callback may render again with its selected part context.
        queueMicrotask(() => {if (opened) panel.querySelector(`.haccp-processes [data-process="${currentId}"]`)?.focus({preventScroll:true});});
      }); chips.append(button);
    }
    body.append(chips);
    body.append(element('h3', `${process.number || currentId.slice(1)} ${process.name}`));
    if (context) body.append(element('p', `当前模型位置：${context}`, 'haccp-context'));
    const status = element('div', undefined, 'haccp-pending');
    status.append(element('strong', '实际放行：未确认'), element('span', '缺少企业现场证据，不能由模型或演示操作替代放行。'));
    body.append(status);
    const hazards = element('div', undefined, 'haccp-hazards');
    for (const [name, key] of [['生物危害','biological'],['化学危害','chemical'],['物理危害','physical']]) {
      const item = element('div'); item.append(element('strong',name), element('p',process.hazards?.[key] || '待企业危害分析确认')); hazards.append(item);
    }
    body.append(hazards);
    const summary = element('dl', undefined, 'haccp-controls');
    for (const [label, value] of [['控制措施',process.controls],['CCP 判定',process.ccpStatus],['判定依据',process.ccpReason],['岗位职责',process.ownerRole]]) {
      summary.append(element('dt',label), element('dd',value || '待企业确认'));
    }
    body.append(summary);
    body.append(element('h3', '七项原则如何落到本工序'));
    const principles = element('div', undefined, 'haccp-principles');
    for (const [index, principle] of (process.principles || HACCP_PRINCIPLES).entries()) {
      const item = element('details'); const name = principle.name || HACCP_PRINCIPLES[index]?.name || `原则 ${index+1}`;
      item.append(element('summary', `${index+1}. ${name} · 待确认`));
      item.append(element('p', principle.requirement || principle.meaning || '需企业现场资料与审核证据。'));
      const evidence = Array.isArray(principle.evidence) ? principle.evidence.join('；') : principle.evidence;
      if (evidence) item.append(element('p', `核查证据：${evidence}`, 'haccp-evidence-copy'));
      principles.append(item);
    }
    body.append(principles);
    const evidence = element('details', undefined, 'haccp-evidence');
    evidence.append(element('summary', '尚缺哪些放行与验证依据'));
    const missing = element('ul');
    for (const item of gate.missing || []) missing.append(element('li', typeof item === 'string' ? item : item.name || item.id));
    evidence.append(missing); body.append(evidence);
    const scenario = getDeviationScenario(currentId);
    const simulation = element('section', undefined, 'haccp-simulation');
    simulation.append(element('small', '异常处置演示 · 非现场数据'), element('h3', scenario.title));
    const step = scenario.steps?.[scenarioStep];
    const stepText = element('p', step ? `${scenarioStep+1}/${scenario.steps.length} ${step.title}：${step.description}` : '查看从发现偏差、暂停与隔离，到整改、验证复核和记录的处理顺序。');
    stepText.setAttribute('role','status'); stepText.setAttribute('aria-live','polite'); simulation.append(stepText);
    const actions = element('div', undefined, 'haccp-simulation-actions');
    const next = element('button', scenarioStep < 0 ? '演示异常处置' : scenarioStep < scenario.steps.length-1 ? '查看下一步' : '重新演示'); next.type='button';
    next.addEventListener('click', () => {
      scenarioStep = scenarioStep >= scenario.steps.length-1 ? 0 : scenarioStep+1;
      onScenario({processId:currentId, step:scenarioStep, demoOnly:true, actualReleaseAllowed:false});
      const currentStep=scenario.steps[scenarioStep];
      stepText.textContent=`${scenarioStep+1}/${scenario.steps.length} ${currentStep.title}：${currentStep.description}`;
      next.textContent=scenarioStep < scenario.steps.length-1 ? '查看下一步' : '重新演示';
    });
    actions.append(next); simulation.append(actions);
    simulation.append(element('p', '演示推进不会改变真实放行状态；任何缺项仍须企业确认。', 'haccp-evidence-copy'));
    body.append(simulation);
    const links=element('footer',undefined,'haccp-links');
    const analysis=element('a','查看本工序 HACCP 分析表'); analysis.href=`analysis.html?case=water&view=result&process=${encodeURIComponent(currentId)}&rev=14`; links.append(analysis);
    const basis=element('p','方法依据：');
    for(const [label,url] of [['GB/T 27341-2009','https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=FAC276BE3CC48070156D8BA81E554D5D'],['Codex / FAO HACCP','https://www.fao.org/good-hygiene-practices-haccp-toolbox/haccp/step-11-validation-and-verification/']]) {
      const link=element('a',label);link.href=url;link.target='_blank';link.rel='noopener';basis.append(link,document.createTextNode(' '));
    }
    links.append(basis); body.append(links); panel.append(body);
  }
  function setProcess(id, options = {}) {
    if (!/^p0[1-6]$/.test(id) || !getHaccpProcess(id)) return;
    const nextContext=options.context || '';
    if (id===currentId && context===nextContext && briefTitle.textContent) return;
    currentId=id;context=nextContext;scenarioStep=-1;render();
  }
  function openPanel() {
    if(opened)return;lastFocus=document.activeElement;opened=true;panel.hidden=false;openButton.setAttribute('aria-expanded','true');
    if(mode==='overlay') for(const sibling of panel.parentElement.children){
      if(sibling===panel)continue;
      inertSiblings.set(sibling,sibling.inert);sibling.inert=true;
    }
    panel.querySelector('button')?.focus({preventScroll:true});
  }
  function closePanel() {
    opened=false;panel.hidden=true;openButton.setAttribute('aria-expanded','false');
    for(const [sibling,inert] of inertSiblings)sibling.inert=inert;
    inertSiblings.clear();
    if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  }
  openButton.addEventListener('click',()=>opened?closePanel():openPanel());
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePanel();}
    if(event.key!=='Tab'||mode!=='overlay')return;
    const nodes=[...panel.querySelectorAll('button:not(:disabled),a[href],summary')].filter(node=>node.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  render();
  return {setProcess,open:openPanel,close:closePanel,isOpen:()=>opened,getState:()=>({processId:currentId,scenarioStep,demoOnly:true,actualReleaseAllowed:false})};
}
