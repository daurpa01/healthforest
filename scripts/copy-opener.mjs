import { copyFileSync } from 'node:fs'
copyFileSync(new URL('../dist/index.html', import.meta.url), new URL('../Abrir HealthForest.html', import.meta.url))
console.log('Abrir HealthForest.html')
