# Glosario

**AVAC (QALY).** Año de vida ajustado por calidad. Un año con salud plena vale 1. Un año con una utilidad de 0,7 vale 0,7.

**Beneficio neto monetario.** Efecto × umbral de pago − costo. Sirve para comparar estrategias con un solo número. Gana el más alto.

**Beneficio neto en salud.** Efecto − costo / umbral. La misma idea, medida en AVAC.

**CEAC.** Curva de aceptabilidad. Para cada umbral de pago, la fracción de sorteos del Monte Carlo en los que una estrategia es la preferida.

**CEAF.** Frontera de aceptabilidad. En cada umbral, la estrategia que gana más a menudo.

**Cohorte.** El grupo que entra junto al modelo. En un Markov suele representarse como 1 (el 100 %) y se reparte entre estados.

**Costo incremental.** Costo de la estrategia nueva menos costo de la de referencia.

**Descuento.** Bajar el valor de un costo o un efecto que ocurre en el futuro. `discount(1000, 0.03, 5)` son 1000 dentro de 5 años, al 3 %.

**Dominancia fuerte.** Una estrategia cuesta más y rinde menos que otra. No se usa para calcular un RCEI.

**Dominancia extendida.** Una estrategia queda por encima de la recta que une a otras dos: su RCEI es peor que el de saltar a la siguiente. También se deja fuera de la frontera.

**EVPI.** Valor esperado de la información perfecta. Lo que pagarías, por paciente, por conocer el valor verdadero de todos los parámetros.

**EVPPI.** Lo mismo, para un solo parámetro o un grupo pequeño.

**Frontera eficiente.** Las estrategias que no están dominadas, ordenadas de menor a mayor efecto.

**ICER.** Ver RCEI.

**Markov.** Modelo que avanza por ciclos. En cada ciclo la cohorte se reparte entre estados según unas probabilidades.

**Monte Carlo.** Repetir el modelo muchas veces sorteando los parámetros, para ver la incertidumbre.

**QALY.** Ver AVAC.

**RCEI (ICER).** Razón de costo-efectividad incremental. Costo incremental dividido por efecto incremental. Se lee como "costo extra por cada AVAC extra". No se interpreta cuando hay dominancia.

**Tornado.** Barras de sensibilidad, de la más influyente a la menos.

**Umbral de pago.** Lo máximo que quien decide pagaría por un AVAC adicional. En la pantalla es la barra de Resultados.

**Utilidad.** El peso de calidad de vida, entre 0 y 1, que multiplica el tiempo.
