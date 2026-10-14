import { store } from '../state/store.js';
import { $, $$, html, raw, render, toast, confirmDialog, download } from './dom.js';
import { PROVIDERS, EFFORTS, aiReady, testConnection, providerConfig } from '../ai/adapter.js';
import { AI_PROVIDERS, newPaper } from '../state/schema.js';
import { exportJSON, mergeImport, knowledgeMarkdown } from '../domain/export.js';
import { demoPaper } from '../data/demo-paper.js';
import { applySettings } from '../main.js';

// A real dropdown of known models plus a "自定义" entry that reveals a text box.
function modelSelect(meta, attr, id, value, optional = false) {
  const known = meta.models.includes(value) || (optional && value === '');
  return html`<div class="stack" style="gap:4px"><select ${raw(attr)}="${id}" data-select-model>
    ${optional ? html`<option value="" ${value === '' ? 'selected' : ''}>（不单独设置，同上）</option>` : ''}
    ${meta.models.map(m => html`<option value="${m}" ${m === value ? 'selected' : ''}>${m}</option>`)}
    <option value="__custom__" ${!known ? 'selected' : ''}>自定义…</option>
  </select><input data-custom-model="${id}" value="${known ? '' : value}" placeholder="输入模型 id" ${known ? 'hidden' : ''}></div>`;
}

function providerPanel(s, id) {
  const meta = PROVIDERS[id];
  const cfg = s.settings.ai.providers[id];
  const isCurrent = s.settings.ai.provider === id;
  return html`<details class="block provider-panel" data-provider="${id}" ${isCurrent || cfg.apiKey ? 'open' : ''}>
    <summary>${meta.label} ${cfg.apiKey ? html`<span class="badge badge-ok">已填 Key</span>` : html`<span class="badge">未配置</span>`}${isCurrent ? html` <span class="badge badge-accent">当前使用</span>` : ''}</summary>
    <div class="form-grid" style="margin-top:8px">
      <div class="field full"><label>API Key</label><div class="row"><input type="password" data-key="${id}" value="${cfg.apiKey}" placeholder="${meta.keyPlaceholder}" style="flex:1" autocomplete="off"><button class="btn" type="button" data-toggle-key="${id}">显示</button></div></div>
      <div class="field"><label>模型（解释、提问、总结）</label>${modelSelect(meta, 'data-model', id, cfg.model)}</div>
      <div class="field"><label>翻译用的快速模型（可选）</label>${modelSelect(meta, 'data-fastmodel', id, cfg.fastModel || '', true)}</div>
      <div class="field full"><label>API 地址${id === 'anthropic' ? '（留空用官方）' : ''}</label><input data-baseurl="${id}" value="${cfg.baseUrl}" placeholder="${id === 'anthropic' ? 'https://api.anthropic.com' : cfg.baseUrl}"></div>
    </div>
    <div class="row"><button class="btn btn-sm" type="button" data-test="${id}">测试连接</button><span class="small muted" data-test-result="${id}"></span><span style="flex:1"></span><a class="small" href="${meta.docs}" target="_blank" rel="noopener">平台文档 ↗</a></div>
    <p class="hint" style="margin-top:6px">${meta.note}</p>
  </details>`;
}

export async function show(container) {
  const s = store.state;
  const ai = s.settings.ai;
  let storageLine = '';
  try { if (navigator.storage && navigator.storage.estimate) { const est = await navigator.storage.estimate(); storageLine = `浏览器已用约 ${(est.usage / 1048576).toFixed(1)} MB，配额约 ${(est.quota / 1073741824).toFixed(1)} GB`; } } catch {}
  const jsonSize = (JSON.stringify(s).length / 1024).toFixed(0);

  render(container, html`<div class="page">
    <div class="page-head"><div><h1>设置</h1><p>只放能改的东西。数据保存在当前浏览器；清除浏览器数据会丢失，记得定期导出备份。</p></div></div>
    <div class="settings-grid">
      <section class="card"><h2>阅读</h2>
        <div class="form-grid">
          <div class="field"><label>正文字号</label><select id="setFont"><option value="small" ${s.settings.fontSize === 'small' ? 'selected' : ''}>小（15px）</option><option value="medium" ${s.settings.fontSize === 'medium' ? 'selected' : ''}>中（17px）</option><option value="large" ${s.settings.fontSize === 'large' ? 'selected' : ''}>大（19px）</option></select></div>
          <div class="field"><label>配色</label><select id="setTheme"><option value="light" ${s.settings.theme === 'light' ? 'selected' : ''}>清爽</option><option value="warm" ${s.settings.theme === 'warm' ? 'selected' : ''}>暖色</option></select></div>
          <div class="field full"><label>我的研究方向（会放进提示词，让解释更贴近）</label><input id="setResearch" value="${s.settings.research}" placeholder="例如：手术机器人、医学影像分割"></div>
          <div class="field full"><label class="checkbox"><input type="checkbox" id="setAutoVocab" ${s.settings.autoVocab ? 'checked' : ''}> 查过的单词自动进生词本（不自动排入复习；默认关闭，建议手动点「加入生词本」只收真正想记的词）</label></div>
          <div class="field full"><label>解释风格</label><select id="setLevel"><option value="novice" ${s.settings.readerLevel !== 'peer' ? 'selected' : ''}>面向非本领域读者：先类比和直观解释，再引入术语和公式</option><option value="peer" ${s.settings.readerLevel === 'peer' ? 'selected' : ''}>面向同领域研究者：直接用术语和公式，少类比</option></select></div>
        </div>
        <div class="hint">快捷键（阅读区有选区时）：<span class="kbd">T</span> 翻译 <span class="kbd">E</span> 解释 <span class="kbd">Q</span> 提问 <span class="kbd">H</span> 高亮 <span class="kbd">B</span> 笔记 · <span class="kbd">/</span> 聚焦提问框 · <span class="kbd">F</span> 专注模式 · <span class="kbd">Esc</span> 关闭</div>
      </section>

      <section class="card"><h2>AI（个人模式）</h2>
        <div class="note-banner" style="margin-bottom:12px">个人模式直接从浏览器调用各平台接口，API Key 只保存在这台电脑的浏览器里，不经过任何服务器。只在自己的电脑上使用；不要在共用电脑上填写。每次调用按各平台计费。</div>
        <div class="form-grid">
          <div class="field"><label class="checkbox" style="margin-top:22px"><input type="checkbox" id="setAiEnabled" ${ai.enabled ? 'checked' : ''}> 启用 AI（翻译、解释、提问、复盘草稿）</label></div>
          <div class="field"><label>当前使用的平台</label><select id="setProvider">${AI_PROVIDERS.map(id => html`<option value="${id}" ${ai.provider === id ? 'selected' : ''}>${PROVIDERS[id].label}${ai.providers[id].apiKey ? '' : '（未填 Key）'}</option>`)}</select></div>
          <div class="field"><label>默认思考深度（仅 Anthropic 生效）</label><select id="setEffort">${EFFORTS.map(m => html`<option value="${m.id}" ${ai.effort === m.id ? 'selected' : ''}>${m.label}</option>`)}</select></div>
        </div>
        <label class="checkbox" style="margin:4px 0 10px"><input type="checkbox" id="setAttachPages" ${s.settings.attachPageImages ? 'checked' : ''}> 全文提问时附带每页截图（模型能看到图、表和公式；更慢更贵，17 页约三万 token；最多 30 页）</label>
        <div class="stack" id="providerPanels">${AI_PROVIDERS.map(id => providerPanel(s, id))}</div>
        <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="saveAi">保存 AI 设置</button><span class="small muted" id="aiStatus">${aiReady(s.settings) ? `当前：${PROVIDERS[ai.provider].label} · ${providerConfig(s.settings).model}` : '当前未启用或当前平台没有 Key'}</span></div>
        <p class="hint" style="margin-top:10px">每个平台的 Key、模型、地址分别保存，切换「当前使用的平台」即可换用。每条回答都会记录用的是哪个平台和模型。按论文可以在论文信息里勾选「不发送给 AI」。</p>
      </section>

      <section class="card"><h2>数据</h2>
        <dl class="kv"><dt>记录大小</dt><dd>${jsonSize} KB（不含 PDF）</dd>${storageLine ? html`<dt>浏览器存储</dt><dd>${storageLine}</dd>` : ''}<dt>论文 / 笔记 / 记录</dt><dd>${s.papers.length} / ${s.notes.length} / ${s.events.length}</dd></dl>
        <div class="row" style="margin-top:12px"><button class="btn" id="exportJson">导出全部记录（JSON）</button><button class="btn" id="importJson">从备份恢复…</button><button class="btn" id="exportKnowledge">导出知识（Markdown）</button></div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <p class="hint" style="margin-top:8px">JSON 备份包含 API Key 以外的全部记录，不包含 PDF 文件。恢复时只添加本机没有的记录，不覆盖已有内容；没有 PDF 的论文会标为「无 PDF」，重新导入同一个文件即可关联。</p>
        <div class="row" style="margin-top:12px">${s.papers.some(p => p.demo) ? html`<button class="btn" id="removeDemo">删除教学示例</button>` : html`<button class="btn" id="restoreDemo">恢复教学示例</button>`}<button class="btn btn-danger" id="wipeAll">清空本机全部数据…</button></div>
      </section>

      <section class="card"><h2>Notion 归档</h2>
        <p class="muted small">当前版本不自动写入 Notion。复盘页的「复制并打开 Notion」可以直接粘贴到现有页面：</p>
        <div class="row" style="margin-top:8px"><a class="btn btn-sm" href="https://app.notion.com/p/3f709d6e364e812a9181c4dcd9fb4da0" target="_blank" rel="noopener">Paper Reading ↗</a><a class="btn btn-sm" href="https://app.notion.com/p/9a416214ae5249f4aa039f8843951733" target="_blank" rel="noopener">Concept Library ↗</a><a class="btn btn-sm" href="https://app.notion.com/p/83d6e57c331244e483ddc871402518a6" target="_blank" rel="noopener">Academic English Bank ↗</a></div>
      </section>

      <section class="card"><h2>关于这个版本</h2>
        <dl class="kv"><dt>版本</dt><dd>0.2 个人版</dd><dt>真实的</dt><dd>PDF 导入与去重、PDF.js 划词与高亮、文本片段标注、阅读会话、笔记、知识条目（概念 / 生词 / 表达）与间隔复习、全文翻译（本机缓存）、截图提问、复盘与导出、从旧版迁移、多平台 AI 调用（Anthropic / DeepSeek / OpenAI 兼容）</dd><dt>没有的</dt><dd>登录、云同步、Notion 自动写入、OCR</dd></dl>
      </section>
    </div>
  </div>`);

  const saveReading = () => {
    s.settings.fontSize = $('#setFont').value;
    s.settings.theme = $('#setTheme').value;
    s.settings.research = $('#setResearch').value.trim();
    s.settings.readerLevel = $('#setLevel').value;
    s.settings.autoVocab = $('#setAutoVocab').checked;
    store.save();
    applySettings();
  };
  $('#setFont').onchange = saveReading; $('#setTheme').onchange = saveReading; $('#setResearch').onchange = saveReading; $('#setLevel').onchange = saveReading; $('#setAutoVocab').onchange = saveReading;

  const readModel = sel => { const el = $(sel); if (!el) return ''; if (el.value !== '__custom__') return el.value.trim(); const custom = el.parentElement.querySelector('[data-custom-model]'); return custom ? custom.value.trim() : ''; };
  container.addEventListener('change', e => {
    const sel = e.target.closest('[data-select-model]');
    if (!sel) return;
    const custom = sel.parentElement.querySelector('[data-custom-model]');
    if (custom) { custom.hidden = sel.value !== '__custom__'; if (sel.value === '__custom__') custom.focus(); }
  });
  const readAiForm = () => {
    ai.enabled = $('#setAiEnabled').checked;
    s.settings.attachPageImages = $('#setAttachPages').checked;
    ai.provider = $('#setProvider').value;
    ai.effort = $('#setEffort').value;
    for (const id of AI_PROVIDERS) {
      ai.providers[id].apiKey = $(`[data-key="${id}"]`).value.trim();
      ai.providers[id].model = readModel(`[data-model="${id}"]`);
      ai.providers[id].fastModel = readModel(`[data-fastmodel="${id}"]`);
      ai.providers[id].baseUrl = $(`[data-baseurl="${id}"]`).value.trim();
    }
  };
  $('#saveAi').onclick = () => {
    readAiForm();
    const r = store.save();
    if (r.ok) toast(aiReady(s.settings) ? `AI 已启用：${PROVIDERS[ai.provider].label} · ${providerConfig(s.settings).model}` : 'AI 设置已保存（当前未启用或没有 Key）', { type: 'ok' });
    const top = container.scrollTop;
    show(container).then(() => { container.scrollTop = top; });
  };
  container.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggleKey) { const i = $(`[data-key="${b.dataset.toggleKey}"]`); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? '显示' : '隐藏'; }
    if (b.dataset.test) {
      const id = b.dataset.test;
      readAiForm(); store.save();
      const out = $(`[data-test-result="${id}"]`);
      out.textContent = '正在连接…'; b.disabled = true;
      const r = await testConnection(s.settings, id);
      b.disabled = false;
      out.textContent = r.ok ? `连接正常 · ${r.model} · ${r.latencyMs} ms · 回复：${(r.text || '').slice(0, 30)}` : `失败：${r.error}`;
      out.className = 'small ' + (r.ok ? 'strong' : 'muted');
    }
  });
  $('#exportJson').onclick = () => download(exportJSON(s), 'paper-reading-backup-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
  $('#exportKnowledge').onclick = () => download(knowledgeMarkdown(s), 'knowledge.md', 'text/markdown');
  $('#importJson').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const { state, added } = mergeImport(s, parsed);
      const r = store.replace(state);
      if (r.ok) toast(`已恢复：论文 ${added.papers}，笔记 ${added.notes}，记录 ${added.events}，知识 ${added.knowledge}`, { type: 'ok', sticky: true });
      show(container);
    } catch (err) { toast('恢复失败：' + (err.message || '文件无法读取'), { type: 'error' }); }
  };
  const removeDemo = $('#removeDemo');
  if (removeDemo) removeDemo.onclick = async () => {
    const { deletePaperFlow } = await import('./paper-edit.js');
    const demo = s.papers.find(p => p.demo);
    if (demo && await deletePaperFlow(demo.id)) show(container);
  };
  const restoreDemo = $('#restoreDemo');
  if (restoreDemo) restoreDemo.onclick = () => { s.papers.push(newPaper(demoPaper())); s.settings.demoDismissed = false; store.save(); show(container); };
  $('#wipeAll').onclick = async () => {
    if (!await confirmDialog({ title: '清空本机全部数据？', message: '会删除这个浏览器里保存的所有论文记录、笔记和设置。PDF 文件也会被移除。建议先导出备份。', confirmText: '全部清空', danger: true })) return;
    try { localStorage.removeItem('paper-reading-v2'); } catch {}
    try { indexedDB.deleteDatabase('paper-reading-files'); } catch {}
    location.hash = '#/home';
    location.reload();
  };
}
