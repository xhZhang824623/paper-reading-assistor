// PDF import: validation, SHA-256 dedup, IndexedDB storage, then the paper record.
import { store } from '../state/store.js';
import { dbPut, dbDelete } from '../state/db.js';
import { newPaper } from '../state/schema.js';
import { toast } from './dom.js';

const MAX_SIZE = 120 * 1024 * 1024;

async function sha256(buffer) {
  if (globalThis.crypto && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Plain-http deployments have no crypto.subtle (not a secure context); use the JS implementation.
  const { sha256Hex } = await import('../domain/sha256.js');
  return sha256Hex(new Uint8Array(buffer));
}

function cleanTitle(name) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function importFiles(fileList, { open = true } = {}) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return [];
  const imported = [];
  for (const file of files) {
    try {
      if (file.size > MAX_SIZE) { toast(`${file.name}：超过 120 MB，未导入`, { type: 'error' }); continue; }
      const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (head !== '%PDF-') { toast(`${file.name}：不是有效的 PDF`, { type: 'error' }); continue; }
      const bytes = await file.arrayBuffer();
      const hash = await sha256(bytes);
      const dup = store.state.papers.find(p => p.hash === hash);
      if (dup) {
        if (!dup.hasPdf) {
          await dbPut(dup.id, file);
          dup.hasPdf = true; dup.fileName = file.name; dup.size = file.size;
          store.save();
          toast(`已把 PDF 重新关联到「${dup.title}」`, { type: 'ok' });
        } else toast(`「${dup.title}」已在库中，未重复导入`);
        imported.push(dup); continue;
      }
      const paper = newPaper({ title: cleanTitle(file.name), fileName: file.name, size: file.size, hash, hasPdf: true, status: 'inbox', readerView: 'pdf' });
      await dbPut(paper.id, file);
      store.state.papers.push(paper);
      const r = store.save();
      if (!r.ok) {
        store.state.papers = store.state.papers.filter(p => p.id !== paper.id);
        await dbDelete(paper.id).catch(() => {});
        toast(`${file.name}：记录保存失败（${r.error && r.error.name === 'QuotaExceededError' ? '浏览器存储空间不足' : '浏览器存储不可用'}），已回滚`, { type: 'error' });
        continue;
      }
      imported.push(paper);
      toast(`已导入「${paper.title}」`, { type: 'ok' });
    } catch (err) {
      console.error(err);
      toast(`${file.name}：导入失败，${err && err.message ? err.message : '浏览器文件存储不可用'}`, { type: 'error' });
    }
  }
  if (open && imported.length) location.hash = '#/read/' + imported[0].id;
  return imported;
}

export function initImport() {
  const input = document.getElementById('fileInput');
  document.getElementById('importBtn').onclick = () => input.click();
  input.onchange = async e => { const files = Array.from(e.target.files || []); e.target.value = ''; await importFiles(files); };
  let depth = 0;
  const overlay = document.getElementById('dropOverlay');
  document.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    await importFiles(e.dataTransfer.files);
  });
}
function hasFiles(e) { return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); }
