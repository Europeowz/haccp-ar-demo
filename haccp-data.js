import { demoCase } from './case-data.js';

// Exhibit contract only: these requirements do not attest to a plant's compliance.
const DEMO_FLAGS = Object.freeze({ demoOnly: true, actualReleaseAllowed: false });

export const HACCP_PRINCIPLES = Object.freeze([
  { id: 'hazard-analysis', name: '危害分析与控制措施', meaning: '识别并评价生物、化学和物理危害，确定显著危害及适当控制措施。', evidence: '产品用途、完整流程、现场核实、危害评价与控制依据' },
  { id: 'ccp-determination', name: '确定关键控制点', meaning: '结合危害显著性、控制措施与后续控制能力判定 CCP，不按设备名称直接指定。', evidence: '经 HACCP 小组审核的 CCP 判定及理由' },
  { id: 'validated-limits', name: '建立经确认的关键限值', meaning: '对已确定的 CCP 建立具有科学依据并经有效性确认的关键限值。', evidence: '适用依据、生产条件下有效性确认、批准版本' },
  { id: 'monitoring', name: '建立监控系统', meaning: '明确监控对象、方法、频次与责任，及时发现偏离。', evidence: '批准的监控方案、适用设备校准和实际批次记录' },
  { id: 'corrective-action', name: '建立纠偏措施', meaning: '失控时控制受影响产品、纠正原因，并明确恢复条件。', evidence: '批准的纠偏程序、受影响范围及处置复核记录' },
  { id: 'validation-verification', name: '有效性确认与持续验证', meaning: '实施前确认计划能够控制危害，实施后持续验证执行与效果。', evidence: '有效性确认报告、验证计划、复核与适用检测结果' },
  { id: 'documentation', name: '建立文件与记录', meaning: '保存受控计划、执行记录和变更历史，使批次与责任可追溯。', evidence: '受控文件、签署责任、批次追溯与记录保存规则' }
].map(principle => Object.freeze({ ...principle, ...DEMO_FLAGS })));

const PROFILES = {
  p01: {
    primaryRisk: '空瓶或瓶口受污染、包材不合格及瓶体碎屑。',
    ownerRole: '包材验收岗位 / 上料岗位 / 质量复核岗位',
    prps: ['合格供应商与包材验收', '包材防护存放与批次追溯', '人员和上料区域卫生'],
    verification: '质量岗位复核包材验收与上料记录；按风险评价核实供应商、包材适用性和后续控制效果。',
    specificEvidence: '包材规格与食品接触适用性资料、供应商评价、来料验收及上料批次记录',
    validationEvidence: '包材控制依据与后续处理能力评价，适用时的检测或验证资料',
    scenario: '空瓶批次验收状态不明',
    containment: '演示暂停该批空瓶投入，隔离状态不明的包材并标识批次。',
    correction: '演示核实来源和验收资料；对污染、破损或不合格包材按程序处置。',
    review: '演示由质量岗位复核验收状态及可用条件；此界面不执行实际批准。'
  },
  p02: {
    primaryRisk: '冲洗不足、介质污染；适用时的消毒剂残留及喷嘴碎屑。',
    ownerRole: '冲洗岗位 / 卫生管理岗位 / 质量复核岗位',
    prps: ['冲洗介质与供液管理', '适用的清洗消毒与化学品管理', '喷嘴维护和异物防护'],
    verification: '复核冲洗记录与喷嘴维护；核实实际处理覆盖、排残及适用的消毒和残留控制效果。',
    specificEvidence: '实际冲洗或消毒工艺说明、介质适用性、喷嘴检查和排残记录',
    validationEvidence: '目标危害与实际处理效果资料；适用时的消毒参数及残留控制有效性确认',
    scenario: '冲洗喷嘴状态异常',
    containment: '演示暂停受影响工位，隔离自上次有效检查后可能受影响的瓶。',
    correction: '演示排查喷嘴与供液，完成维修、清洗或适用的重新处理。',
    review: '演示复核处理覆盖和排残，适用时验证消毒或残留控制；恢复由授权岗位审核。'
  },
  p03: {
    primaryRisk: '灌装再污染、清洗剂残留或清洗液误入产品，以及阀组碎屑。',
    ownerRole: '灌装岗位 / 清洗消毒岗位 / 质量复核岗位',
    prps: ['上游供水处理与放行衔接', '清洗消毒和清洗生产切换', '阀组卫生、灌装防护及人员卫生'],
    verification: '实施前确认清洗与防护能够控制目标危害；实施后复核清洗放行和切换记录，按批准方案核查水质及环境结果。',
    specificEvidence: '供水放行、清洗程序与放行、清洗生产切换、阀组卫生及生产批次记录',
    validationEvidence: '实际灌装条件下清洗消毒和防护的有效性确认、适用水质与环境验证资料',
    scenario: '清洗放行未完成',
    containment: '演示暂停相关灌装并隔离可能受影响时段的产品，标明批次范围。',
    correction: '演示查明未放行原因，按批准程序完成清洗、排残或其他整改。',
    review: '演示核查适用的清洗效果与残留结果，完成质量复核；本演示不把点击视为真实放行。'
  },
  p04: {
    primaryRisk: '瓶盖污染、封口失效，以及盖材或设备碎屑。',
    ownerRole: '供盖旋盖岗位 / 设备维护岗位 / 质量复核岗位',
    prps: ['瓶盖验收、储存与防护供盖', '瓶盖瓶口匹配和设备维护', '维护介质与异物管理'],
    verification: '复核盖材批次和封口检查；在实际瓶盖瓶口组合下确认密封控制有效，核查适用扭矩与完整性结果。',
    specificEvidence: '盖材验收、批次、瓶盖瓶口规格及封口完整性检查记录',
    validationEvidence: '实际瓶盖瓶口组合的密封验证；适用时的扭矩依据及设备调整确认',
    scenario: '封口完整性检查异常',
    containment: '演示隔离异常产品，并界定自上次合格检查以来的受影响范围。',
    correction: '演示检查供盖与旋盖头，排除盖材或设备原因并完成调整。',
    review: '演示按验证后的规范复核封口完整性；质量岗位评估受影响产品及恢复条件。'
  },
  p05: {
    primaryRisk: '设定检测范围内的包装缺陷漏检、剔除失效或批次标识错误。',
    ownerRole: '检测贴标岗位 / 设备维护岗位 / 质量复核岗位',
    prps: ['检测设备功能与维护', '标签版本与批号核对', '不合格品隔离及追溯'],
    verification: '核实检测技术的实际适用范围，按批准方案以适用挑战样本验证检出与剔除；复核标签及批次追溯。外观相机不证明微生物或化学危害受控。',
    specificEvidence: '检测范围、功能检查、适用挑战样本和剔除结果，以及标签批号核对记录',
    validationEvidence: '目标缺陷、检出与剔除能力的有效性确认，及设备无法覆盖的危害控制依据',
    scenario: '剔除装置功能检查未通过',
    containment: '演示暂停相关流转，隔离自上次有效检查后可能受影响的产品。',
    correction: '演示检修检测和剔除装置，并按已批准的复检方案处理隔离产品。',
    review: '演示用适用挑战样本复核检出与剔除，质量岗位复核范围与产品处置。'
  },
  p06: {
    primaryRisk: '转运破损、存放污染，或待检和隔离产品发生状态混淆。',
    ownerRole: '下料转运岗位 / 仓储岗位 / 授权质量放行岗位',
    prps: ['包装防护与适用储运条件', '批次及待检合格隔离状态管理', '成品追溯与授权放行'],
    verification: '复核包装、批次流转和适用储运条件；由授权质量岗位审核检验、偏差和放行资料。模型到达末端不代表产品已合格。',
    specificEvidence: '包装完整性、成品批次流转、状态标识、适用储运条件及检验放行记录',
    validationEvidence: '包装与储运防护依据、批次追溯核实和实际放行程序的验证资料',
    scenario: '成品批次放行状态不明',
    containment: '演示隔离状态不明批次，暂停移入合格品区域并核对数量和去向。',
    correction: '演示补核批次记录、检验与偏差处置，按批准程序处理破损或不明状态产品。',
    review: '演示由授权质量岗位审核完整资料；界面不能代替该岗位作出真实产品放行。'
  }
};

const SCOPE_REQUIREMENTS = Object.freeze([
  '补全并现场核实水源、水处理、适用杀菌及其验证等完整工艺和产品预期用途',
  '建立并核实适用的良好卫生规范等前提方案（PRPs）',
  '由企业 HACCP 小组完成危害评价、CCP 判定及计划批准',
  '接入真实受控文件、批次监控、适用检验与质量审批证据'
]);

function getSource(processId) {
  const source = demoCase.processes.find(process => process.id === processId);
  if (!source || !PROFILES[processId]) throw new RangeError(`Unknown HACCP process: ${processId}`);
  return source;
}

function evidenceFor(source, profile) {
  return [
    { id: `${source.id}-hazard-analysis`, name: `完整危害分析与控制依据：${profile.specificEvidence}` },
    { id: `${source.id}-ccp-decision`, name: 'HACCP 小组的显著危害评价、CCP 判定理由与批准记录' },
    { id: `${source.id}-control-criteria`, name: 'CCP 关键限值的科学依据与有效性确认；如判定非 CCP，保留判定理由及适用控制要求' },
    { id: `${source.id}-monitoring`, name: '批准的监控方法、频次、责任岗位及真实批次执行记录，适用时含校准资料' },
    { id: `${source.id}-corrective-action`, name: '纠偏程序与偏差处置记录；无偏差时须有经复核的无偏差依据，不虚构纠偏完成' },
    { id: `${source.id}-validation-verification`, name: `实施前有效性确认与实施后持续验证：${profile.validationEvidence}` },
    { id: `${source.id}-controlled-records`, name: '计划版本、执行签署、批次追溯、质量复核与保存要求' }
  ].map(item => ({ ...item, status: 'missing', ...DEMO_FLAGS }));
}

export function getHaccpProcess(processId) {
  const source = getSource(processId);
  const profile = PROFILES[processId];
  const requirements = [
    `评价${source.name}的三类危害及显著性，并说明控制依据。${profile.primaryRisk}`,
    source.ccpReason,
    '先完成 CCP 判定；如为 CCP，关键限值须有科学依据并在实际生产条件下完成有效性确认。本演示不提供通用数值。',
    `${source.monitoring} 监控频次、方法、适用设备与责任须经企业批准，本演示没有实时监控。`,
    `${source.corrective} 受影响产品范围、恢复条件和授权复核须有真实记录。`,
    profile.verification,
    `以 ${source.id} 关联设备、分析项和证据要求；实际文件须另有批次、时间、受控版本与责任签署。${source.record}`
  ];
  const evidenceRequired = evidenceFor(source, profile);
  const principles = HACCP_PRINCIPLES.map((principle, index) => ({
    id: principle.id,
    name: principle.name,
    requirement: requirements[index],
    evidence: evidenceRequired[index].name,
    evidenceId: evidenceRequired[index].id,
    status: 'pending',
    ...DEMO_FLAGS
  }));
  return {
    id: source.id,
    processId: source.id,
    name: source.name,
    number: source.number,
    hazards: { ...source.hazards },
    controls: source.controls,
    ccpStatus: source.ccpStatus,
    ccpReason: source.ccpReason,
    limit: source.limit,
    monitoring: source.monitoring,
    corrective: source.corrective,
    verification: profile.verification,
    records: source.record,
    ownerRole: profile.ownerRole,
    prps: [...profile.prps],
    PRPs: [...profile.prps],
    sourceRef: source.sourceRef,
    status: 'pending_enterprise_review',
    evidenceStatus: 'missing',
    evidenceRequired,
    principles,
    mappedRequirements: principles.map(principle => ({ ...principle })),
    ...DEMO_FLAGS
  };
}

export function getProcessBrief(processId) {
  const source = getSource(processId);
  return {
    id: source.id,
    processId: source.id,
    name: source.name,
    number: source.number,
    primaryRisk: PROFILES[processId].primaryRisk,
    control: source.controls,
    pending: 'CCP 判定、适用控制标准及实际执行证据均待企业确认。',
    ...DEMO_FLAGS
  };
}

// Deliberately no approval-input interface: browser state cannot authorize release.
export function getReleaseGate(processId) {
  const process = getHaccpProcess(processId);
  return {
    id: process.id,
    processId: process.id,
    status: 'not_ready',
    label: '待企业审核 · 不具备实际放行条件',
    missing: [...SCOPE_REQUIREMENTS, ...process.evidenceRequired.map(item => item.name)],
    ...DEMO_FLAGS
  };
}

export function getDeviationScenario(processId) {
  const source = getSource(processId);
  const profile = PROFILES[processId];
  return {
    id: `${source.id}-deviation-demo`,
    processId: source.id,
    title: profile.scenario,
    steps: [
      { id: 'detected', title: '发现异常', description: `预设情境：${profile.scenario}。并非来自传感器或实际检查。` },
      { id: 'contained', title: '暂停与隔离', description: profile.containment },
      { id: 'corrected', title: '清洗或整改', description: profile.correction },
      { id: 'reviewed', title: '验证与质量复核', description: profile.review },
      { id: 'recorded', title: '记录与追溯', description: `演示将异常、受影响批次、处置依据和责任复核关联到 ${source.id}；真实记录仍未接入。` }
    ].map(step => ({ ...step, ...DEMO_FLAGS })),
    note: '仅演示异常处置顺序。推进步骤不会执行设备控制、生成检测结果、完成质量审批或允许产品放行。',
    ...DEMO_FLAGS
  };
}

// Optional pure UI transition. Each transition remains a rehearsal, including the last.
export function advanceDeviationScenario(processId, currentStepId = null) {
  const scenario = getDeviationScenario(processId);
  const index = currentStepId === null ? -1 : scenario.steps.findIndex(step => step.id === currentStepId);
  if (currentStepId !== null && index === -1) throw new RangeError(`Unknown deviation step: ${currentStepId}`);
  const nextIndex = Math.min(index + 1, scenario.steps.length - 1);
  return {
    processId,
    stepIndex: nextIndex,
    stepId: scenario.steps[nextIndex].id,
    step: { ...scenario.steps[nextIndex] },
    status: nextIndex === scenario.steps.length - 1 ? 'demo_sequence_complete' : 'demo_in_progress',
    ...DEMO_FLAGS
  };
}
