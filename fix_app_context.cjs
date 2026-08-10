const fs = require('fs');
let content = fs.readFileSync('src/context/AppContext.tsx', 'utf-8');

const toReplace = `  const addParsedData = useCallback((data: SkuData[]) => {
    setSkuDataList(data);
  }, []);

  const updateSku = useCallback((sku: string, updates: Partial<SkuData>) => {
    setSkuDataList(prev => prev.map(item => item.sku === sku ? { ...item, ...updates } : item));
  }, []);

  const deleteSku = useCallback((sku: string) => {
    setSkuDataList(prev => prev.filter(item => item.sku !== sku));
  }, []);

  const clearData = useCallback(() => {
    setSkuDataList([]);
  }, []);`;

content = content.replace(toReplace, "");
fs.writeFileSync('src/context/AppContext.tsx', content);
