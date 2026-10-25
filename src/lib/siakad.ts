import JSZip from "jszip";
import { nilaiHuruf, nilaiIndeks } from "./types";

/**
 * Export Nilai SIAKAD — TEMPLATE PRESERVING (port dari main.js desktop).
 *
 * Template JANGAN ditulis ulang dengan SheetJS: proses itu menghilangkan
 * style, lebar kolom, tab sheet, dan struktur asli template. Di sini file
 * template disalin apa adanya (di-unzip dengan JSZip), lalu HANYA XML sheet
 * semester yang sesuai yang di-patch, dan di-zip kembali.
 */

export interface SiakadProdiConfig {
  key: "PAI" | "PGMI" | "HKI" | "ESy";
  label: string;
  code: string;
  file: string;
}

export function deteksiProdi(text: string): SiakadProdiConfig | null {
  const t = String(text || "").toLowerCase();
  if (t.includes("pgmi")) return { key: "PGMI", label: "PGMI", code: "86232", file: "PGMI.xlsx" };
  if (t.includes("pai")) return { key: "PAI", label: "PAI", code: "86208", file: "PAI.xlsx" };
  if (t.includes("ekonomi") || t.includes("esy")) return { key: "ESy", label: "Ekonomi Syariah", code: "60206", file: "ESy.xlsx" };
  if (t.includes("hukum") || t.includes("keluarga") || t.includes("hki")) return { key: "HKI", label: "Hukum Keluarga Islam", code: "74230", file: "HKI.xlsx" };
  return null;
}

export function namaSheetSiakad(config: SiakadProdiConfig, semesterNo: number): string {
  if (config.key === "PAI") return `SM ${semesterNo}`;
  if (config.key === "PGMI") return `PGMI${semesterNo}`;
  if (config.key === "HKI") return `AS${semesterNo}`;
  return `ESy${semesterNo}`;
}

export function xmlDecode(text = ""): string {
  return String(text)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function xmlEncode(text: unknown = ""): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function normalizeSiakadText(value = ""): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

export function getCellXml(rowXml: string, col: string): string | null {
  const m = String(rowXml).match(new RegExp(`<c\\b[^>]*\\br="${col}[0-9]+"[^>]*(?:/>|>[\\s\\S]*?</c>)`));
  return m ? m[0] : null;
}

function replaceCell(rowXml: string, col: string, newCell: string): string {
  const re = new RegExp(`<c\\b[^>]*\\br="${col}[0-9]+"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
  if (re.test(rowXml)) return rowXml.replace(re, newCell);
  return rowXml;
}

const COL_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

/** Patch satu sel mempertahankan atribut style (s). Teks = inlineStr, angka = t="n". */
export function patchTypedCell(rowXml: string, col: string, value: string | number): string {
  const rowNumber = (rowXml.match(/<row\b[^>]*\br="(\d+)"/) || [])[1] || "";
  const existing = getCellXml(rowXml, col);
  if (existing) {
    const address = (existing.match(/\br="([A-Z]+[0-9]+)"/) || [])[1] || `${col}${rowNumber}`;
    const style = (existing.match(/\bs="(\d+)"/) || [])[1] || "";
    const styleAttr = style ? ` s="${style}"` : "";
    const isNumeric = typeof value === "number" && Number.isFinite(value);
    const replacement = isNumeric
      ? `<c r="${address}"${styleAttr}><v>${value}</v></c>`
      : `<c r="${address}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEncode(value ?? "")}</t></is></c>`;
    return replaceCell(rowXml, col, replacement);
  }
  // Sel belum ada di baris template: sisipkan pada urutan kolom yang benar,
  // meminjam style dari sel tetangga bila ada.
  const address = `${col}${rowNumber}`;
  const isNumeric = typeof value === "number" && Number.isFinite(value);
  const newCell = isNumeric
    ? `<c r="${address}"><v>${value}</v></c>`
    : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEncode(value ?? "")}</t></is></c>`;
  const myIdx = COL_ORDER.indexOf(col);
  const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)[0-9]+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  for (const c of cells) {
    if (COL_ORDER.indexOf(c[1]) > myIdx) {
      return rowXml.replace(c[0], newCell + c[0]);
    }
  }
  return rowXml.replace(/<\/row>\s*$/, `${newCell}</row>`);
}

function updateCalcOnLoad(workbookXml: string): string {
  if (/<calcPr\b/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*)\/?>/, (_m, attrs: string) => {
      const clean = String(attrs || "").replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g, "");
      return `<calcPr${clean} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
    });
  }
  return workbookXml.replace("</workbook>", '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
}

function semesterFromValue(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (/^[1-8]$/.test(text)) return Number(text);
  const m = text.match(/(?:semester|sem)[^0-9]*([1-8])\b/i);
  if (m) return Number(m[1]);
  const compact = text.replace(/\s+/g, "");
  const m2 = compact.match(/(?:PGMI|PAI|AS|HKI|ESY)[^0-9]*([1-8])(?:[^0-9]|$)/i);
  return m2 ? Number(m2[1]) : null;
}

export interface SiakadStudentRow {
  nim: string;
  nama: string;
  nilaiAkhir: number;
}

export interface SiakadKelasInfo {
  kodeKelas: string;
  mkKode: string;
  mkNama: string;
  mkSemester: number | null;
  tahun: string; // dari tahun_akademik.tahun
  semesterTerm: string; // Ganjil | Genap | Pendek
}

/**
 * Unduh workbook SIAKAD hasil patch template.
 * Mengembalikan jumlah mahasiswa yang tertulis. Melempar Error dengan
 * pesan Bahasa Indonesia bila template/sheet/bobot tidak valid.
 */
export async function exportSiakadWorkbook(args: {
  config: SiakadProdiConfig;
  kelas: SiakadKelasInfo;
  students: SiakadStudentRow[];
  totalBobot: number;
}): Promise<{ matched: number; sheet: string; fileName: string }> {
  const { config, kelas, students } = args;
  if (Math.abs(Number(args.totalBobot) - 100) >= 0.01) {
    throw new Error(`Total bobot penilaian ${Number(args.totalBobot).toFixed(2)}%. Harus tepat 100% sebelum export SIAKAD.`);
  }
  const semesterNo =
    semesterFromValue(kelas.mkSemester) ||
    semesterFromValue(kelas.kodeKelas) ||
    semesterFromValue(kelas.mkNama) ||
    null;
  if (!semesterNo) {
    throw new Error("Semester mata kuliah tidak dapat ditentukan (harus semester 1 sampai 8). Periksa data Mata Kuliah/Kelas di Smart Class.");
  }
  const expectedSheetName = namaSheetSiakad(config, semesterNo);

  const res = await fetch(`/templates-siakad/${config.file}`);
  if (!res.ok) throw new Error(`Template ${config.label} tidak ditemukan pada aplikasi.`);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());

  const workbookFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relsFile) throw new Error("Struktur template SIAKAD tidak valid (workbook.xml tidak ditemukan).");
  const workbookXml = await workbookFile.async("string");
  const relsXml = await relsFile.async("string");

  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = m[0];
    const id = (tag.match(/\bId="([^"]+)"/) || [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) relMap.set(id, target);
  }

  const sheets: { name: string; path: string }[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g)) {
    const targetRel = relMap.get(m[2]);
    if (targetRel) {
      const relPath = targetRel.startsWith("/") ? targetRel.slice(1) : `xl/${targetRel.replace(/^\.\//, "")}`;
      sheets.push({ name: xmlDecode(m[1]), path: relPath });
    }
  }

  const targetSheet = sheets.find((s) => normalizeSiakadText(s.name) === normalizeSiakadText(expectedSheetName));
  if (!targetSheet) {
    throw new Error(`Sheet template SIAKAD "${expectedSheetName}" tidak ditemukan untuk ${config.label} semester ${semesterNo}.`);
  }
  const sheetFile = zip.file(targetSheet.path);
  if (!sheetFile) throw new Error(`File sheet template SIAKAD "${expectedSheetName}" tidak ditemukan.`);
  let xml = await sheetFile.async("string");

  const dataMatch = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!dataMatch) throw new Error(`Struktur sheet template SIAKAD "${expectedSheetName}" tidak valid.`);

  // Kode semester SIAKAD: tahun 4 digit + Ganjil='2', Genap='1', Pendek='3'
  const academicYear = (String(kelas.tahun || "").match(/\d{4}/) || [""])[0] || String(kelas.tahun || "");
  const term = kelas.semesterTerm.toLowerCase() === "ganjil" ? "2"
    : kelas.semesterTerm.toLowerCase() === "genap" ? "1"
    : kelas.semesterTerm.toLowerCase() === "pendek" ? "3" : "";
  const siakadSemester = `${academicYear}${term}`;

  const valuesForStudent = (student: SiakadStudentRow): Record<string, string | number> => {
    const letter = nilaiHuruf(student.nilaiAkhir);
    return {
      A: student.nim ?? "",
      B: student.nama ?? "",
      C: kelas.mkKode ?? "",
      D: kelas.mkNama ?? "",
      E: siakadSemester,
      F: kelas.kodeKelas ?? "",
      G: letter,
      H: nilaiIndeks(letter),
      I: Number(Number(student.nilaiAkhir).toFixed(2)),
      J: config.code,
      K: config.label,
    };
  };

  // Kumpulkan baris yang ada (r -> xml). Baris data mulai baris 2.
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g;
  const existingRows = new Map<number, string>();
  let lastRowXml = "";
  for (const m of dataMatch[1].matchAll(rowRe)) {
    existingRows.set(Number(m[1]), m[0]);
    if (Number(m[1]) >= 2) lastRowXml = m[0];
  }
  const headerRowXml = existingRows.get(1) || "";

  let matched = 0;
  let dataSection = dataMatch[1];
  const patchedRows = new Map<number, string>();

  students.forEach((student, idx) => {
    const rowNumber = idx + 2;
    let row = existingRows.get(rowNumber);
    if (!row) {
      // Template menyediakan lebih sedikit baris: buat baris baru meniru
      // gaya baris data terakhir (atau header) dengan nomor baris ini.
      const base = lastRowXml || headerRowXml;
      if (!base) return;
      row = base.replace(/<row\b([^>]*)\br="\d+"/, `<row$1r="${rowNumber}"`);
      row = row.replace(/\br="([A-Z]+)\d+"/g, (_mm, col: string) => `r="${col}${rowNumber}"`);
    }
    let out = row;
    for (const [col, value] of Object.entries(valuesForStudent(student))) {
      out = patchTypedCell(out, col, value);
    }
    patchedRows.set(rowNumber, out);
    matched++;
  });

  dataSection = dataSection.replace(rowRe, (rowXml) => {
    const rowNumber = Number((rowXml.match(/<row\b[^>]*\br="(\d+)"/) || [])[1]);
    return patchedRows.get(rowNumber) ?? rowXml;
  });
  // Tambahkan baris baru yang belum ada di dataSection.
  const missing = [...patchedRows.keys()].filter((n) => !existingRows.has(n)).sort((a, b) => a - b);
  for (const n of missing) {
    dataSection += patchedRows.get(n);
  }

  xml = xml.replace(dataMatch[0], `<sheetData>${dataSection}</sheetData>`);
  zip.file(targetSheet.path, xml);
  zip.file("xl/workbook.xml", updateCalcOnLoad(workbookXml));

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeClass = String(kelas.kodeKelas || "KELAS").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const fileName = `Nilai_SIAKAD_${config.key}_${safeClass}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { matched, sheet: expectedSheetName, fileName };
}
