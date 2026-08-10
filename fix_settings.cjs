const fs = require('fs');
let content = fs.readFileSync('src/hooks/useSettings.ts', 'utf-8');
content = content.replace("maxPageContentLength: 100000", "maxPageContentLength: 40000");
fs.writeFileSync('src/hooks/useSettings.ts', content);
