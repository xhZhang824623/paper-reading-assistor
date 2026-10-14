// Teaching example. Not a real paper. Lets the reader try selection, highlights and the
// assistant flow without an API key. Deletable from the library.
export const DEMO_ID = 'demo';

export const DEMO_PARAGRAPHS = [
  ['Abstract', 'Medical image segmentation models often perform well on data from the same distribution as their training set. However, their performance may degrade when deployed in a different clinical environment. Domain shift refers to a change in the data distribution between the source and target domains.', '医学图像分割模型通常在与训练集同分布的数据上表现良好。然而，将其部署到不同的临床环境时，性能可能下降。Domain shift（域偏移）指源域与目标域之间数据分布的变化。'],
  ['1. Understanding the problem', 'Consider a model trained on images acquired at Hospital A. Images from Hospital B may differ in scanner settings, patient populations, or acquisition protocols. These differences can change image appearance without changing the underlying segmentation task.', '假设模型在医院 A 获取的图像上训练。医院 B 的图像可能在扫描设置、患者群体或采集流程方面存在差异。这些差异可能改变图像外观，而不改变底层的分割任务。'],
  ['2. What should we examine?', 'To assess generalization, we should evaluate the model on independent target-domain data and compare its performance with a source-domain baseline. A change in image appearance alone does not tell us how much the segmentation performance will decrease; this requires experimental evidence.', '为了评估泛化能力，应在独立的目标域数据上评估模型，并与源域基线比较。图像外观变化本身不能说明分割性能会下降多少；这需要实验验证。'],
];

export const DEMO_TEXT = DEMO_PARAGRAPHS.map(([h, en]) => h + '\n\n' + en).join('\n\n');

export function demoPaper() {
  return {
    id: DEMO_ID,
    title: 'Domain shift in medical image segmentation（教学示例）',
    authors: '自编教学材料',
    year: '',
    venue: '非真实论文',
    category: '医学影像',
    tags: ['Domain shift', 'Segmentation', '示例'],
    status: 'reading',
    demo: true,
    hasPdf: false,
    excerptText: DEMO_TEXT,
    readerView: 'text',
  };
}

// Preset answers. Only used for the demo paper, and always labeled as such.
export function demoAnswer(action, quote, question = '') {
  if (action === 'translate') {
    const hit = DEMO_PARAGRAPHS.find(([, en]) => quote && (en.includes(quote.trim()) || quote.includes(en)));
    if (hit) return '（示例译文，对应整段）\n\n' + hit[2];
    return '（示例译文）域偏移指源域与目标域之间数据分布的变化。任意选区的忠实翻译需要在设置里接入 AI。';
  }
  if (action === 'summarize') {
    return '示例要点：模型在训练分布上的表现不能直接代表跨医院表现。扫描设置、患者群体等变化可能造成域偏移；是否影响分割、影响多少，需要独立目标域实验验证。';
  }
  const body = 'Domain shift（域偏移）是源域与目标域数据分布的变化。直观上：在医院 A 的影像上练习，再到医院 B 工作，图像风格和人群可能不同。\n\n数学上可以用 P_source(X,Y) ≠ P_target(X,Y) 描述广义分布变化。仅输入分布变化且 P(Y|X) 不变是更具体的 covariate shift；不能把所有域偏移都当成这种情况。\n\n要检验迁移效果，应比较独立目标域评估与源域基线。\n\n检验一下：如果医院 B 的图像只是亮度不同，分割性能一定下降吗？';
  if (action === 'ask') return '你的问题是：「' + question + '」。示例论文只有预置回答，不能实时推理。\n\n' + body;
  return body;
}
