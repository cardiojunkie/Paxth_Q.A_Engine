import React from 'react';
import { Download } from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { CatalogFileGroup } from '../types';
import { populateCatalogFile } from '../lib/catalogFiles';
import { useAppContext } from '../context/AppContext';

export function CatalogFileDownload({ file, filename, label, sheetName = 'Catalog' }: {
  file: Pick<CatalogFileGroup, 'headers' | 'rows'>; filename: string; label: string; sheetName?: string;
}) {
  const { addNotification } = useAppContext();
  const download = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      populateCatalogFile(workbook.addWorksheet(sheetName), file);
      saveAs(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
    } catch (error) {
      addNotification({ type: 'error', title: 'Download Failed', message: error instanceof Error ? error.message : 'Could not generate this workbook. Please retry.' });
    }
  };
  return <button onClick={download} className="inline-flex items-center gap-2 px-3 py-2 text-xs border border-emerald-200 text-emerald-800 rounded-sm hover:bg-emerald-50">
    <Download className="w-4 h-4" />{label}
  </button>;
}
