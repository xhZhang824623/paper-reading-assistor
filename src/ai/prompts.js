// Prompt builders. Kept stable so prompt caching can work on the system prompt.
export function systemPrompt(settings) {
  const research = settings.research ? `读者的研究方向：${settings.research}。` : '';
  const level = settings.readerLevel === 'peer'
    ? '读者是本领域的研究者：直接使用术语和公式，少用类比，重点放在方法细节、假设和证据强度。'
    : '读者是博士生，但未必熟悉这篇论文所在的领域：先用具体例子或类比建立直观图像，再引入术语和公式；术语第一次出现时给出英文原文和一句话解释；说明类比在哪里失效。';
  return `你是一位陪伴博士生精读英文论文的研究伙伴。${research}${level}

写作风格：
- 用中文，像一位耐心的同行在白板前讲解。开头先用一两句话说清楚结论或要点，再展开。
- 以段落为主，用小标题（##、###）分节；要点列表只在内容确实并列时使用，每条不超过两行，不要把整篇回答写成列表。对比多个方案时用表格。
- 数学公式一律用 LaTeX：行内用 $...$，独立公式用 $$...$$；符号第一次出现时解释含义。不要把公式写成纯文本。
- 只依据给定的原文片段和上下文；论文没有写的内容不要编造。信息不足时直接说"这段原文没有提供这一信息"。引用原文时标注页码。
- 当结构、流程或关系用图更清楚时，画图，并在图后用一句话说明图里是什么。两种画法：
  1. 结构和流程用 \`\`\`mermaid 代码块：flowchart TD（纵向）、sequenceDiagram 或 stateDiagram-v2。要求：节点用圆角 A(文字) 或 A([文字])，边上标注传递的是什么（如 A -- 树的隐向量 zT --> B），用 subgraph 把编码器、解码器这类模块分组，并用下面这组样式区分角色，在图的最后逐行加上（每条语句单独一行，不要用分号连写）：
     classDef input fill:#e3f2fd,stroke:#1e88e5,color:#0d3b66
     classDef op fill:#fff8e1,stroke:#f9a825,color:#5d4200
     classDef out fill:#e8f5e9,stroke:#43a047,color:#1b4d2b
     classDef loss fill:#fce4ec,stroke:#d81b60,color:#6a1030
     然后用 class A,B input 这样的语句给节点上色。节点文字不用引号、逗号和中括号，15 个节点以内。
  2. 需要示意图（几何关系、分布、坐标、分子或网络的样子、一个具体例子）时用 \`\`\`svg 代码块直接画 SVG：viewBox 约 600×320，白底，中文或术语标注，颜色不超过四种，不引用外部资源，不写 script。
  只画原文有依据的内容；图是为了解释，不是装饰。
- 不要寒暄，不要复述问题，不要以"好的"开头，结尾不加客套话。`;
}

// Short system prompt for translation: fast, no essay.
export function translatorPrompt(settings) {
  const research = settings.research ? `读者研究方向：${settings.research}。` : '';
  return `你是学术论文的英译中译者。${research}只输出译文或释义本身，不要寒暄，不要解释你做了什么，不要说"无法翻译"。术语在译文里保留英文原文（放在括号里），公式、变量名、图表编号原样保留。`;
}

export function isShortPhrase(quote) {
  const q = String(quote || '').trim();
  return q.length <= 40 && q.split(/\s+/).length <= 4;
}

export const DOC_CHAR_LIMIT = 120000;

export function clipDocument(text) {
  const t = String(text || '');
  if (t.length <= DOC_CHAR_LIMIT) return { text: t, truncated: false };
  return { text: t.slice(0, DOC_CHAR_LIMIT) + '\n\n[全文过长，此处截断，后面的内容没有提供]', truncated: true };
}

export function userPrompt({ action, quote, context = '', title = '', question = '', parent = null, document = '', continuation = false }) {
  if (continuation && parent) {
    const tail = (parent.response || '').slice(-3000);
    return `${title ? `论文标题：${title}\n` : ''}${document ? `论文全文（从 PDF 自动提取，按页标注）：\n${clipDocument(document).text}\n\n` : ''}你上一条回答因为长度限制被截断了。上一条的问题是：${parent.question || parent.quote || '（见上下文）'}\n上一条回答的结尾部分：\n…${tail}\n\n请从被截断的地方接着写完，不要重复已经写过的内容，直接续写。`;
  }
  const head = title ? `论文标题：${title}\n` : '';
  const ctx = context && context !== quote ? `上下文（选区附近的原文）：\n${context}\n\n` : '';
  const doc = document ? `论文全文（从 PDF 自动提取，按页标注，可能带有排版噪音；引用时请标明页码）：\n${clipDocument(document).text}\n\n` : '';
  if (action === 'summarize' && !quote && document) {
    return `${head}${doc}请为这篇论文写一份导读，读者水平见系统提示。结构：
## 一句话总结
## 要解决的问题
背景、为什么难、以前的方法差在哪里。
## 核心思想
先用类比或具体例子讲清楚，再给出方法的整体流程，可配一张 mermaid 流程图。
## 方法步骤
分阶段讲清输入和输出；关键公式用 LaTeX 写出并解释每个符号。
## 实验与结果
具体数字、和什么基线比、哪些结论可靠、哪些只是初步证据。
## 局限与没说清的地方
## 术语表
五到十个，英文原文加一句话解释。
## 读完检验
三个问题，只给问题。
每一节标注依据所在的页码。`;
  }
  if (action === 'translate') {
    const around = context && context !== quote ? `\n\n它所在的上下文（只用来理解，不要翻译上下文）：\n${context.slice(0, 600)}` : '';
    if (isShortPhrase(quote)) {
      return `解释这个词或短语在论文里的意思：${quote}${around}\n\n按下面格式输出，不要多余的话：\n**本句中的意思**：一行。\n**常见释义**：词性加一两个常见中文释义，一行。\n**说明**：如果是术语、缩写或专有名词，一句话说明；否则省略这一行。`;
    }
    return `把下面这段论文原文翻译成准确、通顺的中文。术语首次出现时在括号里保留英文，公式和图表编号原样保留。只给译文。${around}\n\n要翻译的原文：\n${quote}`;
  }
  if (action === 'explain') {
    return `${head}${ctx}请讲解下面选中的原文。按这个结构写，用小标题：
## 一句话
它是什么，在这篇论文里为什么重要（两句以内）。
## 直观理解
用一个具体的例子或类比把它讲清楚，再说明类比在哪里失效。
## 需要的前置知识
读懂它需要哪两三个概念，各用一两句话解释。
## 在本文中的角色
它在方法里处于哪一步，输入和输出是什么，解决了什么问题。
## 容易误解的地方
两到三条，用段落或短列表。
## 检验一下
一道能检验理解的问题，只给问题不给答案。
篇幅 400 字左右；内容确实复杂时可以更长。

选中的原文：
${quote}`;
  }
  if (action === 'summarize') {
    return `${head}总结下面这段原文：它声称了什么、依据是什么、还没有说明什么。用三到五个要点。\n\n原文：\n${quote}`;
  }
  // ask
  const prior = parent ? `之前的问答：\n问：${parent.question || parent.quote}\n答：${(parent.response || '').slice(0, 2000)}\n\n` : '';
  return `${head}${doc}${ctx}${prior}${quote ? `选中的原文：\n${quote}\n\n` : ''}我的问题：${question}\n\n直接回答这个问题。先给结论，再展开；需要分节时用小标题，需要公式时用 LaTeX，涉及原文时标注页码。`;
}

export function reviewDraftPrompt({ title, evidence }) {
  const lines = [];
  lines.push(`论文标题：${title}`);
  if (evidence.highlights.length) lines.push('我高亮的原文：\n' + evidence.highlights.map(n => '- ' + n.quote.slice(0, 300)).join('\n'));
  if (evidence.comments.length) lines.push('我的笔记：\n' + evidence.comments.map(n => '- ' + (n.quote ? '“' + n.quote.slice(0, 120) + '” ' : '') + n.text.slice(0, 300)).join('\n'));
  if (evidence.aiEvents.length) lines.push('我问过或请求解释过的片段：\n' + evidence.aiEvents.map(e => '- [' + e.action + '] ' + (e.question || e.quote || '').slice(0, 200) + (e.feedback === 'unclear' ? '（我标记为仍不理解）' : '')).join('\n'));
  return `根据下面这些阅读证据，起草一份论文总结草稿。要求：
- 分四段：研究问题、方法、主要发现、局限。每段两到四句。
- 只依据证据，证据不足的地方写“证据不足：需要回到原文确认”，不要靠论文标题猜测内容。
- 最后给三条复习问题，针对我标记为仍不理解的内容优先。

证据：
${lines.join('\n\n')}`;
}

// Prompts for a captured region of a page (figure, table or formula) sent as an image.
export function imagePrompt({ mode, title, page, pageText, question }) {
  const head = `这是论文《${title}》第 ${page} 页上框选的一块区域截图（可能是图、表或公式）。本页的文字（含图注）供参考：\n${String(pageText || '').slice(0, 3000)}\n\n`;
  if (mode === 'translate') return head + '把截图里的文字翻译成中文。如果是公式，用 LaTeX 写出并逐个解释符号；如果是表格，用 Markdown 表格重排并翻译表头；如果是图，翻译图中的标注并说明图注。';
  if (mode === 'ask') return head + `我的问题：${question}\n\n结合截图内容直接回答，提到图中元素时说明是哪一部分。`;
  return head + '请解释这块内容。先说它是什么（图、表还是公式），再按部分说明：图要讲坐标轴、图例、曲线或箭头各表示什么、支持什么结论；表要讲每列的含义和关键数字；公式要用 LaTeX 写出并解释每个符号。最后用一两句话说明它在论文论证里的作用。';
}

export const PAGE_IMAGES_NOTE = '\n\n另外按顺序附上了各页的截图，图、表和公式以截图为准，文字以提取的全文为准。';
