# Paridad con TreeAge Pro

HealthForest busca la capacidad de TreeAge Pro Healthcare con una interfaz más clara. Esta entrega es la fase 1: el motor y la interfaz cubren el trabajo cotidiano de costo-efectividad, Markov, incertidumbre y presupuesto. Lo que sigue está separado para no fingir funciones que todavía no están.

La arquitectura deja el cálculo en `src/engine` (funciones puras, sin interfaz). La aplicación solo dibuja y pide resultados. Las simulaciones largas corren en un Web Worker.

## Fases

**Fase 1, esta entrega.** Árbol, rollback, costo-efectividad, Markov de cohorte, microsimulación, sensibilidad, Monte Carlo de segundo orden, presupuesto, ejemplos, pruebas, temas y exportación.

**Fase 2.** Supervivencia particionada, simulación de eventos discretos, lectura de archivos de TreeAge (`.trex`), ajuste de curvas a Kaplan–Meier, sensibilidad de tres vías, asistente completo de distribuciones con matriz de correlación editable, informe PDF de todo el análisis, distribuciones bootstrap y lotes de simulación.

**Fase 3.** Recursos y colas en la simulación de eventos, más idiomas, y una batería de modelos publicados para comparar números con otros programas (sin copiar los archivos de ejemplo de TreeAge).

## Modelos

| Función de TreeAge | Estado |
| --- | --- |
| Árboles de decisión | Hecho |
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
| Diagrama de estados | Hecho, lectura |
| Gráfico de Markov contra Kaplan–Meier y ajuste de curvas | Fase 2 |
| Microsimulación (primer orden), rastreadores, semilla | Hecho |
| Distribución por paciente y por ciclo | Hecho |
| Supervivencia particionada | Fase 2 |
| Simulación de eventos discretos | Fase 2 |

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
