const fs = require('fs');
let content = fs.readFileSync('src/context/AppContext.tsx', 'utf-8');

// Replace the hook import
content = content.replace("import { SkuData, QAStatus } from '../hooks/useCatalogData';", "import { SkuData, QAStatus, useCatalogData } from '../hooks/useCatalogData';");

// Remove local state definition for skuDataList
content = content.replace("  const [skuDataList, setSkuDataList] = useState<SkuData[]>([]);\n", "");

// Insert hook call
content = content.replace("  const [jobs, setJobs] = useState<Job[]>([]);", "  const { skuDataList, addParsedData, updateSkuStatus, updateSku, removeSkus, isLoading } = useCatalogData();\n  const [jobs, setJobs] = useState<Job[]>([]);");

// Replace AppContext interface methods
content = content.replace("  deleteSku: (sku: string) => void;\n  clearData: () => void;", "  deleteSku: (sku: string) => void;\n  clearData: () => void;\n  removeSkus: (skus: string[]) => void;\n  updateSkuStatus: (skus: string[], newStatus: QAStatus) => void;\n  isLoadingSkuData: boolean;");

// Replace context implementations
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

content = content.replace(toReplace, `  const deleteSku = useCallback((sku: string) => {
    removeSkus([sku]);
  }, [removeSkus]);

  const clearData = useCallback(() => {
    removeSkus(skuDataList.map(s => s.sku));
  }, [removeSkus, skuDataList]);`);

// Add new exports
content = content.replace("skuDataList, addParsedData, updateSku, deleteSku, clearData,", "skuDataList, addParsedData, updateSku, deleteSku, clearData, removeSkus, updateSkuStatus, isLoadingSkuData: isLoading,");

fs.writeFileSync('src/context/AppContext.tsx', content);
console.log("Updated AppContext.tsx");
