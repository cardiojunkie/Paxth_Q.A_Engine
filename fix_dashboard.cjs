const fs = require('fs');
let content = fs.readFileSync('src/components/DashboardModule.tsx', 'utf-8');

const exportCode = `
  const exportToExcel = async () => {
    if (skuDataList.length === 0) return;
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('QA Results');
    
    const headers = [
      'SKU', 'Status', 'QA Status', 'Confidence', 'Summary', 'Issue Count', 'Missing Attributes Count', 'Mapping Errors Count', 'Attribute Set'
    ];
    worksheet.addRow(headers);
    
    skuDataList.forEach(sku => {
      const qaResult = sku.raw_row?.qa_result || {};
      const stats = qaResult.issue_count || 0;
      
      worksheet.addRow([
        sku.sku,
        sku.status,
        qaResult.qa_status || '',
        qaResult.confidence || '',
        qaResult.summary || '',
        stats,
        qaResult.issues?.filter((i:any) => i.issue_type === 'missing').length || 0,
        qaResult.issues?.filter((i:any) => i.issue_type === 'mapping').length || 0,
        sku.attribute_set || ''
      ]);
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'catalog-qa-results.xlsx');
  };

  const stats = {`;

content = content.replace("  const stats = {", exportCode);
fs.writeFileSync('src/components/DashboardModule.tsx', content);
