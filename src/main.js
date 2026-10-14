// Bootstrap: load state, apply settings, route between views.
import { store } from './state/store.js';
import { closeStaleSessions } from './domain/session.js';
import { $, toast } from './ui/dom.js';
import { initSidebar, updateSidebar } from './ui/sidebar.js';
import { initImport } from './ui/import.js';
import * as home from './ui/home.js';
import * as library from './ui/library.js';
import * as reader from './ui/reader.js';
import * as review from './ui/review.js';
import * as knowledge from './ui/knowledge.js';
import * as settings from './ui/settings.js';

const views = { home, library, read: reader, review, knowledge, settings };
let active = null;

export function applySettings() {
  const s = store.state.settings;
  document.body.dataset.theme = s.theme || 'light';
  document.body.dataset.font = s.fontSize || 'medium';
}

function parseHash() {
  const h = (location.hash || '#/home').replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return { name: views[name] ? name : 'home', params: { id: id ? decodeURIComponent(id) : null } };
}

async function route() {
  const { name, params } = parseHash();
  if (active && active.mod.destroy) { try { await active.mod.destroy(); } catch (err) { console.error(err); } }
  const container = $('#view');
  container.innerHTML = '';
  document.body.className = document.body.className.replace(/\broute-\S+/g, '').trim();
  document.body.classList.add('route-' + name);
  document.body.classList.remove('reader-focus');
  const mod = views[name];
  active = { name, mod };
  try {
    await mod.show(container, params);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="page"><div class="danger-banner">页面渲染出错：' + (err && err.message ? String(err.message).replace(/</g, '&lt;') : '未知错误') + '</div></div>';
  }
  updateSidebar(name, params);
  if (name !== 'read') container.scrollTop = 0;
}

function boot() {
  store.load();
  if (closeStaleSessions(store.state)) store.save();
  applySettings();
  initSidebar();
  initImport();
  store.subscribe(type => {
    if (type === 'save-failed') {
      const err = store.lastSaveError;
      toast('浏览器存储失败' + (err && err.name === 'QuotaExceededError' ? '：空间不足' : '') + '。本次修改没有保存，请到设置页导出备份。', { type: 'error' });
    }
    updateSidebar(active ? active.name : '', parseHash().params);
  });
  if (store.loadInfo.migratedFromV1) toast('已从旧版本迁移你的论文、笔记和记录。旧数据保留未动。', { type: 'ok', sticky: true });
  if (store.loadInfo.corrupt) toast('本机保存的数据无法读取，已另存一份损坏副本并以空库启动。', { type: 'error' });
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/home';
  route();
}

boot();
