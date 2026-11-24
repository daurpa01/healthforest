#!/bin/bash
cd "$(dirname "$0")/.."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "./Abrir HealthForest.html"
else
  echo "Abre este archivo con el navegador: $(pwd)/Abrir HealthForest.html"
fi
