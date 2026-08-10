const fs = require('fs');
let lines = fs.readFileSync('src/context/AppContext.tsx', 'utf-8').split('\n');

const start = lines.findIndex(l => l.includes('const addParsedData = useCallback((data: SkuData[]) => {'));
const end = lines.findIndex(l => l.includes('const addJobs = useCallback((newJobs: Job[]) => {'));

if (start !== -1 && end !== -1) {
  lines.splice(start, end - start, 
`  const deleteSku = useCallback((sku: string) => {
    removeSkus([sku]);
  }, [removeSkus]);

  const clearData = useCallback(() => {
    removeSkus(skuDataList.map(s => s.sku));
    setJobs([]);
  }, [removeSkus, skuDataList]);
`);
  fs.writeFileSync('src/context/AppContext.tsx', lines.join('\n'));
  console.log("Fixed");
} else {
  console.log("Not found", start, end);
}
