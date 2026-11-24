import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
copyFileSync('dist/index.html', 'HealthForest.html')
console.log('HealthForest.html listo para abrir con doble clic.')
