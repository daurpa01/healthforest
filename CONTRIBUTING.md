# Contribuir

Esta página es para quien modifica el programa. Si solo quieres usarlo, vuelve al [README](README.md).

## Requisitos

Node 22. Para el instalador de escritorio, además Rust y las librerías de Tauri 2.

```bash
npm ci
npm test
npm run dev
npm run build
```

`npm run build` deja un solo archivo, `dist/index.html`, y lo copia a `Abrir HealthForest.html` en la raíz. Ese HTML se abre con doble clic (`file://`): el JavaScript y el CSS van dentro del archivo, y la simulación corre en un worker creado en memoria, sin pedir otro archivo al disco.

`npm run dev` abre el servidor de desarrollo en el puerto 5173. Sirve para programar. No hace falta para usar la copia ya construida.

El motor está en `src/engine` y no importa React. Las pruebas comparan rollback, RCEI, Markov, microsimulación, Monte Carlo con semilla, el importador `.trex` y los ejemplos de los tutoriales contra cuentas hechas a mano.

La comparación con los archivos reales está en [docs/validation.md](docs/validation.md). Lo que falta para parecerse a TreeAge Pro está en [docs/treeage-parity.md](docs/treeage-parity.md).

## Publicación

GitHub Pages publica `dist` con `.github/workflows/pages.yml` en cada cambio de `main`. La dirección es https://daurpa01.github.io/healthforest/.

Los instaladores de Windows, macOS y Linux se generan al publicar una etiqueta `v*` con `.github/workflows/release.yml` (Tauri) y quedan como borrador en Releases. En una máquina propia: `npm ci`, `npm run build` y `npx @tauri-apps/cli build`.

## Guías

Las guías para quien usa el programa viven en `docs/guia`. Si cambias una pantalla, actualiza la captura en `docs/guia/img` y el párrafo que la cita.
