# Paridad con TreeAge Pro

HealthForest busca la capacidad de TreeAge Pro Healthcare con una interfaz más clara. Esta entrega es la fase 1: el motor y la interfaz cubren el trabajo cotidiano de costo-efectividad, Markov, incertidumbre y presupuesto. Lo que sigue está separado para no fingir funciones que todavía no están.

La arquitectura deja el cálculo en `src/engine` (funciones puras, sin interfaz). La aplicación solo dibuja y pide resultados. Las simulaciones largas corren en un Web Worker.

## Fases

**Fase 1, esta entrega.** Árbol, rollback, costo-efectividad, Markov de cohorte, microsimulación, sensibilidad, Monte Carlo de segundo orden, presupuesto, ejemplos, pruebas, temas y exportación.

**Fase 2.** Ajuste de curvas a Kaplan–Meier, sensibilidad de tres vías en la interfaz, asistente completo de distribuciones con matriz de correlación editable, informe PDF de todo el análisis y lotes de simulación. La supervivencia particionada, la simulación de eventos, el SIR, la calibración de un parámetro, el diagrama de estados y la importación de Markov desde `.trex` ya están en el motor.

**Fase 3.** Recursos y colas en la simulación de eventos, más idiomas, y una batería de modelos publicados para comparar números con otros programas (sin copiar los archivos de ejemplo de TreeAge).

## Modelos

| Función de TreeAge | Estado |
| --- | --- |
| Árboles de decisión | Hecho. También se importa un `.trex` de decisión (nodos, fórmulas con `;`, `#`, variables y rangos) |
| Nodos de decisión, azar y terminal | Hecho |
| Nodo lógico | Hecho |
| Clones y maestros de clon | Hecho (marcar, insertar y calcular) |
| Nodos de Markov dentro del árbol | Hecho |
| Subárbol de transición con salto a estado | Hecho |
| Recompensas inicial, incremental y final | Hecho, como en el método tradicional |
| Corrección de medio ciclo (el botón que pone inicial y final a la mitad) | Hecho |
| Corrección dentro del ciclo (WCC) | Hecho |
| Regla de Simpson | Hecho, además de los dos métodos de TreeAge |
| Túneles y `_tunnel` (desde 1) | Hecho, modos seguimiento y permanencia |
| `_stage` desde 0, `_stage_mid`, `_age` | Hecho |
| Tablas e interpolación (tablas de vida) | Hecho |
| Descuento al inicio, mitad o fin del ciclo | Hecho |
| Condición de parada | Hecho |
| Traza de la cohorte y supervivencia | Hecho |
| Diagrama de estados | Hecho. Se dibuja desde el Markov y el Markov se reconstruye desde el diagrama |
| Gráfico de Markov contra Kaplan–Meier y ajuste de curvas | Fase 2 |
| Microsimulación (primer orden), rastreadores, semilla | Hecho |
| Remuestreo de características (bootstrap) con semilla | Hecho |
| Distribución por paciente y por ciclo | Hecho |
| Supervivencia particionada | Hecho. Curvas exponencial, Weibull y lognormal; el estado es el área entre PFS y OS |
| Simulación de eventos discretos | Hecho. Relojes exponenciales en competencia y costo por el tiempo de espera |
| Cohorte dinámica / SIR no coherente | Hecho. Conteos, nodo de entrada y tasa que cambia en el tiempo |
| Calibración | Hecho para un parámetro, con límites y error cuadrático |
| Pagos aguas arriba e informe de caminos | Hecho |
| Costo de Markov por periodo (exportación de presupuesto) | Hecho, CSV |

## Costo-efectividad

| Función | Estado |
| --- | --- |
| Costo y efecto por estrategia | Hecho. Las estrategias son las ramas de la decisión raíz |
| RCEI secuencial y contra un comparador | Hecho |
| Dominancia fuerte y extendida | Hecho |
| Frontera eficiente | Hecho |
| Beneficio neto monetario y en salud | Hecho |
| Umbral de pago | Hecho |
| Orden de estrategias | Hecho |
| Varios conjuntos de pagos además de costo y efecto | Parcial: el motor acepta más pagos; la pantalla usa costo y efecto |

## Incertidumbre

| Función | Estado |
| --- | --- |
| Variables, fórmulas y definiciones en el nodo | Hecho. Lo avanzado está plegado |
| Rangos para sensibilidad | Hecho |
| Una vía, tornado, dos vías, umbral | Hecho |
| Tres vías | Fase 2 |
| Umbral de precio | Hecho si el precio es una variable (la herramienta de umbral) |
| Distribuciones beta, gamma, lognormal, normal, uniforme, triangular, exponencial, PERT, Poisson, Weibull, empírica | Hecho |
| Dirichlet y normal multivariada | Hecho en el motor; el panel solo las crea, no edita la matriz con comodidad |
| Correlación (cópula gaussiana) | Hecho en el motor |
| Muestreo por ensayo, por paciente, por ciclo y una vez | Hecho |
| Bootstrap | Fase 2 |
| Monte Carlo de segundo orden, semilla, plano, CEAC, CEAF, EVPI | Hecho, en un worker, con progreso y cancelar |
| Primer y segundo orden anidados | Hecho |
| EVPPI | Parcial: estimación por intervalos de un parámetro, y una función anidada en el motor |
| Lotes y bandas de predicción | Fase 2 |

## Presupuesto

Alineado con la buena práctica ISPOR (población, horizonte, mezcla actual y nueva, costos, incertidumbre, resultados anuales y acumulados).

| Función | Estado |
| --- | --- |
| Prevalencia (stock) e incidencia (cohortes que siguen en tratamiento) | Hecho |
| Crecimiento, fracción elegible, duración | Hecho |
| Participaciones manuales y adopción lineal, exponencial o logística | Hecho en el motor; la guía rellena una adopción lineal |
| Costos traídos del modelo o escritos a mano | Hecho |
| Descuento opcional (por defecto 0) | Hecho |
| Impacto anual y acumulado, tabla y gráficos | Hecho |
| Sensibilidad de una vía y probabilística | Hecho. La probabilística corre en el worker |

## Interfaz

| Función | Estado |
| --- | --- |
| Dibujo de izquierda a derecha, formas distintas, conectores | Hecho |
| Zoom, paneo, minimapa, alinear terminales, plegar ramas | Hecho |
| Resaltar la ruta óptima | Hecho |
| Temas claro, oscuro y de publicación; colores, fuente y espacios | Hecho |
| Mostrar u ocultar probabilidades, pagos, valores y nombres | Hecho |
| SVG, PNG y PDF del árbol | Hecho |
| Español e inglés | Hecho. Español al abrir |
| Guías para Markov, Monte Carlo y presupuesto | Hecho. Ocultan el detalle hasta que se pide |
| Validación de fórmulas al escribir | Hecho |
| Ayudas breves | Hecho |
| Asistente de distribuciones tan completo como el de TreeAge | Fase 2 |

## Rendimiento de esta fase

Medido con `npm run build` (sin las fuentes web, que se quitaron para abrir más rápido):

| Pieza | Tamaño | Cuándo se descarga |
| --- | --- | --- |
| HTML | 0,6 KB (0,4 KB gzip) | Al abrir |
| CSS | 9,6 KB (2,9 KB gzip) | Al abrir |
| JavaScript de la interfaz y el motor | 332 KB (105 KB gzip) | Al abrir |
| Pantallas de análisis y gráficos | 39 KB (9 KB gzip) | Al entrar a resultados, Markov, sensibilidad, Monte Carlo o presupuesto |
| Worker de simulación | 41 KB | Al pulsar Simular |

En el navegador de prueba la interfaz escribió «lista en 145 ms». Las simulaciones no bloquean la pantalla: van en un worker y se pueden cancelar.

## Tutoriales de TreeAge (la lista del historial)

Cada fila es una función que aparece en `TREEAGE_TUTORIAL_SPEC`. «Hecho» significa que el motor lo calcula y hay una prueba. «Parcial» significa que está la idea, no el diálogo completo de TreeAge.

| Función del tutorial | Estado |
| --- | --- |
| Nodos de decisión, azar, terminal, Markov, lógico y clon | Hecho |
| Nodo etiqueta / marcador | No. No cambia el cálculo |
| Diagrama de estados y vuelta al árbol | Hecho |
| Supervivencia particionada (PFS, OS, área entre curvas) | Hecho. Falta el informe mensual como pantalla propia |
| Simulación de eventos, eventos en competencia, costo por el tiempo | Hecho |
| Nodo de entrada y cohorte que no suma 100 % | Hecho, en el SIR |
| Probabilidad de infección según los infectados actuales | Hecho |
| Tasa de transmisión que baja después de un día | Hecho |
| `_stage`, tablas por edad, razones de riesgo, `discount` | Hecho. Es el modelo de Kibo |
| Recompensa de estado y peaje de transición | Hecho |
| Medio ciclo visible en el trazo | Hecho. El cáncer de ejemplo cobra 10.000 de 20.000 en el ciclo 0 |
| Informe de cohorte | Hecho |
| Informe que mezcla varios Markov de una estrategia (0,8 y 0,2 → 76,2 %) | Hecho |
| Curvas de supervivencia superpuestas | Parcial. El panel de supervivencia particionada dibuja PFS y OS juntas |
| Túneles | Hecho en el motor. Ningún tutorial de esta lista los usa |
| Microsimulación, rastreadores, semilla | Hecho |
| Rastreadores globales y colas de recursos | No |
| Bootstrap de características con semilla | Hecho |
| Depuración de un paciente (traza de rastreadores) | Parcial. Hay una traza por paciente; no es la consola de TreeAge |
| Pagos aguas arriba e informe de caminos | Hecho |
| Calibración a un objetivo (error cuadrático, límites) | Hecho para un parámetro. Falta Weibull → probabilidad y varios objetivos a la vez |
| Sensibilidad de una vía, umbral, tornado, dos vías | Hecho |
| Tres vías | No en la interfaz. El archivo de Kibo guarda la lista de variables |
| Distribuciones gamma, normal y beta enlazadas a variables | Hecho en el importador |
| PSA, plano, CEAC, EVPI, EVPPI | Hecho. CEAF también, aunque esos videos no lo nombran |
| Exportar el costo del Markov por periodo | Hecho, CSV. La adopción por año calendario sigue en el módulo de presupuesto |
| Comentarios del modelo y comparación de dos modelos | Parcial. Cada nodo tiene notas. No hay una vista de comparación |
| Asistente de pagos extra y frente de Excel | No |
