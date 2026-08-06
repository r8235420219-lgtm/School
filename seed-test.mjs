import Database from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const db = new Database('./data/app.sqlite');
const now = Date.now();

// Clean prior seed
db.exec("DELETE FROM assets WHERE original_name LIKE 'SEED-%'");
db.exec("DELETE FROM nodes WHERE name LIKE 'SEED %'");

const ins = db.prepare('INSERT INTO nodes (parent_id, kind, name, sort_order, created_at) VALUES (?,?,?,?,?)');
const subj = ins.run(null, 'subject', 'SEED Mathematics', 0, now).lastInsertRowid;
const subc = ins.run(subj, 'subcategory', 'SEED Algebra', 0, now).lastInsertRowid;
const chap = ins.run(subc, 'chapter', 'SEED Chapter 1', 0, now).lastInsertRowid;

mkdirSync('./storage/qa', { recursive: true });
const imgName = 'SEED-diagram.png';
const relPath = join('qa', `${now}-${imgName}`);
writeFileSync(join('./storage', relPath), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const imageAsset = db.prepare(
  'INSERT INTO assets (chapter_id, tab, type, file_path, original_name, extracted_text, uploaded_at) VALUES (?,?,?,?,?,?,?)'
).run(chap, 'qa', 'image', relPath, imgName, null, now).lastInsertRowid;

const pdfName = 'SEED-notes.pdf';
const pdfRel = join('qa', `${now}-${pdfName}`);
writeFileSync(join('./storage', pdfRel), Buffer.from('%PDF-1.4 fake'));
const pdfAsset = db.prepare(
  'INSERT INTO assets (chapter_id, tab, type, file_path, original_name, extracted_text, uploaded_at) VALUES (?,?,?,?,?,?,?)'
).run(chap, 'qa', 'pdf', pdfRel, pdfName, 'Photosynthesis converts light into chemical energy.', now).lastInsertRowid;

console.log(JSON.stringify({ subj: Number(subj), subc: Number(subc), chap: Number(chap), imageAsset: Number(imageAsset), pdfAsset: Number(pdfAsset) }));
db.close();
