// Preset exhibit data. No uploaded document or AI output is represented here.
export const demoCase = {
  id: 'water',
  mode: 'preset_demo',
  title: '饮料灌装线示范方案',
  product: 'PET 常温非碳酸包装饮用水',
  version: 'DEMO 04',
  sourceLabel: '内置饮料方案 · 演示样例',
  scope: '以外购 PET 空瓶的冲洗、灌装与包装段说明工艺和 HACCP 分析结构。水源、水处理、适用杀菌及其验证需另行纳入完整方案。本页使用预置案例演示，未解析提交文件，也不构成已审核的 HACCP 计划或自动合规结论。',
  processes: [
    {
      id: 'p01',
      number: '01',
      name: '空瓶上料',
      action: '空瓶由上料端进入输送带，依次送往冲洗工位。',
      position: '-0.57m 0.17m 0m',
      cameraTarget: '-0.57m 0.17m 0m',
      cameraOrbit: '28deg 58deg 1.35m',
      hazards: {
        biological: '瓶内或瓶口受存放、搬运和人员接触污染。',
        chemical: '不合格包材或不当存放带入化学污染。',
        physical: '瓶体、瓶口破损或混入碎屑。'
      },
      controls: '核对包材验收与批次状态；防护存放，保持上料区清洁，避免直接接触瓶口。',
      ccpStatus: '待企业判定',
      ccpReason: '需结合包材风险、验收与后续控制能力评价；不能因上料是第一道工序就指定为 CCP。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '检查包材身份、瓶体和瓶口完整性及防护状态；方法、频次和责任人由现场方案确定。',
      corrective: '剔除破损或污染瓶，隔离可疑包材批次，排查存放与上料环节，复核后再投入使用。',
      record: '包材验收、供应商及批次、上料检查、异常处置与复核记录。',
      sourceRef: '演示工艺说明 · 工序 01'
    },
    {
      id: 'p02',
      number: '02',
      name: '冲洗处理',
      action: '瓶体经过冲洗工位，喷头执行处理动作并排出残液。',
      position: '-0.35m 0.24m 0m',
      cameraTarget: '-0.35m 0.24m 0m',
      cameraOrbit: '25deg 55deg 1.35m',
      hazards: {
        biological: '冲洗介质污染或处理不足，未能按工艺要求控制瓶内污染。',
        chemical: '采用清洗消毒剂时可能存在不当配制或残留。',
        physical: '异物未被清除，或喷嘴等部件脱落。'
      },
      controls: '确认冲洗介质适用，核查喷嘴、处理覆盖和排残；如采用化学消毒，执行已验证的消毒与残留控制程序。',
      ccpStatus: '待企业判定',
      ccpReason: '需明确实际采用冲洗还是消毒、目标危害及处理效果，再结合后续工序评价控制措施。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '检查供液与喷嘴状态、处理覆盖和排残；适用的浓度、接触时间及残留按已验证程序监控。',
      corrective: '暂停受影响工位，隔离可能受影响的瓶，排查喷嘴与供液，确认处理效果恢复后继续生产。',
      record: '冲洗检查、适用的消毒参数、排残检查、异常批次与恢复确认记录。',
      sourceRef: '演示工艺说明 · 工序 02'
    },
    {
      id: 'p03',
      number: '03',
      name: '旋转灌装',
      action: '灌装头下降，瓶内液位上升，完成后灌装头复位。',
      position: '-0.075m 0.30m 0m',
      cameraTarget: '-0.075m 0.30m 0m',
      cameraOrbit: '25deg 55deg 1.3m',
      hazards: {
        biological: '灌装阀、环境或人员使处理后的水与瓶口再次受到污染。',
        chemical: '清洗剂残留或清洗液误入产品。',
        physical: '阀组和输送机构磨损产生碎屑。'
      },
      controls: '供水应已满足本产品的处理与放行要求；落实清洗消毒放行、阀组卫生、灌装防护与操作卫生。',
      ccpStatus: '待企业判定',
      ccpReason: '需联同上游水处理、灌装环境与防护能力分析；设备名称和外观不能作为 CCP 判定依据。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '核查生产前清洗放行、阀组与防护状态、清洗生产切换；按方案执行适用的水质与环境监测。',
      corrective: '发现卫生失控时暂停相关生产，隔离受影响时段产品，调查原因，完成清洗和验证后恢复。',
      record: '供水放行、清洗放行、卫生检查、生产时段、受影响批次及恢复验证记录。',
      sourceRef: '演示工艺说明 · 工序 03'
    },
    {
      id: 'p04',
      number: '04',
      name: '供盖旋盖',
      action: '瓶盖送至瓶口，旋盖机构下压旋转并完成封盖。',
      position: '0.14m 0.26m 0m',
      cameraTarget: '0.14m 0.26m 0m',
      cameraOrbit: '28deg 55deg 1.3m',
      hazards: {
        biological: '瓶盖污染或封口失效，导致封装后污染。',
        chemical: '不合格盖材或设备维护介质带入化学污染。',
        physical: '盖体破损、异物或机构碎屑混入。'
      },
      controls: '核对瓶盖验收与批次，保护供盖清洁；按瓶盖与瓶口组合验证封口完整性及适用的扭矩要求。',
      ccpStatus: '待企业判定',
      ccpReason: '需评价密封失效的食品安全影响、危害显著性及控制验证结果，不能直接把旋盖工位设为 CCP。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '检查供盖防护、漏盖歪盖和封口完整性；适用的扭矩检查方法与频次按验证后的规范执行。',
      corrective: '隔离异常产品，排查供盖与旋盖头，评估自上次合格检查以来的产品，调整并确认恢复。',
      record: '瓶盖批次、封口检查、适用的扭矩结果、设备调整及受影响产品处置记录。',
      sourceRef: '演示工艺说明 · 工序 04'
    },
    {
      id: 'p05',
      number: '05',
      name: '检测与贴标',
      action: '瓶体通过外观检测位，完成标签贴附并流向下料端。',
      position: '0.34m 0.20m -0.02m',
      cameraTarget: '0.34m 0.20m -0.02m',
      cameraOrbit: '32deg 55deg 1.35m',
      hazards: {
        biological: '封口缺陷漏检，可能使存在再污染风险的产品继续流转。',
        chemical: '相关化学危害需依靠对应工艺控制与检验，不能由模型中的外观相机检出。',
        physical: '配置检测范围内的异物或包装缺陷漏检，剔除装置失效。'
      },
      controls: '明确检测范围并验证剔除有效性，核对标签与批次对应；外观相机不代表能检测微生物、化学残留或所有异物。',
      ccpStatus: '待企业判定',
      ccpReason: '需依据实际检测技术、目标危害及检出与剔除能力评价；液位偏差也不自动等于食品安全危害。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '执行检测与剔除装置功能检查，核对标签和批号；挑战样本、方法、频次及责任人由现场方案确定。',
      corrective: '检测失效或标识错误时隔离受影响产品，复核检测范围与追溯信息，由质量人员评估处置。',
      record: '功能检查、剔除验证、标签批次核对、受影响时段及产品复核记录。',
      sourceRef: '演示工艺说明 · 工序 05'
    },
    {
      id: 'p06',
      number: '06',
      name: '成品下料',
      action: '封装后的瓶装水沿输送带进入成品下料与转运区域。',
      position: '0.63m 0.18m 0m',
      cameraTarget: '0.63m 0.18m 0m',
      cameraOrbit: '35deg 58deg 1.4m',
      hazards: {
        biological: '搬运中封装破损，可能造成再次污染。',
        chemical: '不适当的存放或转运环境造成化学污染。',
        physical: '搬运挤压、跌落或破损引入异物。'
      },
      controls: '保持包装完整，核对批号与产品状态；区分待检、合格和隔离产品，按产品要求储运并保留追溯信息。',
      ccpStatus: '待企业判定',
      ccpReason: '需结合实际储运条件、包装防护与放行程序评价；成品端的状态标识本身不等于 CCP 控制。',
      limit: '需按实际产品与已验证工艺确定',
      monitoring: '检查包装完整性、批次与状态标识及适用储运条件；由授权人员复核检验和放行资料。',
      corrective: '隔离受损或状态不明产品，核对批次、数量与去向，按审核批准的程序评估处置和放行。',
      record: '批次流转、检验放行、仓储转运、隔离与异常处置记录。',
      sourceRef: '演示工艺说明 · 工序 06'
    }
  ]
};
