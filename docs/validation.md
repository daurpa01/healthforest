# Validación contra los modelos reales

Los archivos `examples/arbol.trex` y `examples/arbol2.trex` son el trabajo de curso IECS 2017 (costo-efectividad de dos vacunas frente a no vacunar). HealthForest los lee con el importador de `.trex` y hace el rollback él mismo. Las cuentas de esta página se repitieron en Python, aparte del motor, para no copiar ni el documento de apoyo ni una salida de TreeAge.

## Los dos archivos no tienen las mismas fórmulas

`Arbol.trex` escribe los años de vida y los costos de la enfermedad **sin descontar** (`78`, `350`, `1000+(950*30)`).

`Arbol2.trex` sustituye esas expresiones por las funciones de TreeAge `annuity(desc; n)` y `discount(valor; desc; tiempo)`, con `desc = 0.03`.

El documento de apoyo calculó el caso base como si `annuity` fuera el número de años y `discount` no cambiara el valor. Esos números coinciden con `Arbol.trex`. No coinciden con las fórmulas de `Arbol2.trex`.

Definiciones usadas, las de TreeAge:

- `Discount(valor; tasa; tiempo) = valor / (1 + tasa) ^ tiempo`
- `Annuity(tasa; periodos) = (1 - (1 + tasa) ^ -periodos) / tasa`, el valor presente de un pago de 1 al final de cada periodo. Si la tasa es 0, el resultado es el número de periodos.

Las probabilidades son las mismas en los dos archivos. `#` es el complemento. Con la estrategia Nada:

| Evento | Probabilidad |
| --- | ---: |
| Infección respiratoria no fatal | 0.195 |
| Infección respiratoria fatal | 0.00195 |
| Infección neurológica sin secuelas | 0.0143 |
| Infección neurológica con secuelas | 0.000715 |
| Infección neurológica fatal | 0.00143 |
| Sin infección (`#`) | 0.786605 |

En Vacuna N1 esas probabilidades se multiplican por `rr_vacuna_N1 = 0.29`. En Vacuna N2, por `rr_vacuna_N2 = 0.2`. El costo de la vacuna (12 y 60) entra en **todas** las ramas de esa estrategia. En N1 y N2 el costo del evento (350 o 1000, y `950*30` si hay secuelas) está escrito sin `discount`, aunque en Nada sí está descontado. El importador no corrige esa diferencia: evalúa la fórmula que está en el archivo.

## Arbol.trex frente a la cuenta de apoyo

La cuenta de apoyo y HealthForest dan lo mismo, porque aquí no hay descuento que aplicar.

| Estrategia | Cuenta de apoyo, costo | HealthForest, costo | Diferencia | % | Cuenta de apoyo, AVAC | HealthForest, AVAC | Diferencia | % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nada | 105.755000 | 105.755000 | 0 | 0 | 77.816371 | 77.816371 | 0 | 0 |
| Vacuna N1 | 42.668950 | 42.668950 | 0 | 0 | 77.946748 | 77.946748 | 0 | 0 |
| Vacuna N2 | 81.151000 | 81.151000 | 0 | 0 | 77.963274 | 77.963274 | 0 | 0 |

Nada queda dominada (cuesta más y rinde menos). El RCEI de N2 frente a N1 es (81.151 − 42.66895) / (77.963274 − 77.946748) = **2328.49 por AVAC**. HealthForest lo devuelve igual.

## Arbol2.trex: la cuenta de apoyo no evalúa annuity ni discount

| Estrategia | Cuenta de apoyo, costo | Fórmulas de Arbol2, costo | HealthForest, costo | Apoyo vs HealthForest | Fórmulas vs HealthForest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nada | 105.755000 | 40.659426 | 40.659426 | −65.095574 (−61.6 %) | 0 |
| Vacuna N1 | 42.668950 | 42.668950 | 42.668950 | 0 | 0 |
| Vacuna N2 | 81.151000 | 81.151000 | 81.151000 | 0 | 0 |

| Estrategia | Cuenta de apoyo, AVAC | Fórmulas de Arbol2, AVAC | HealthForest, AVAC | Apoyo vs HealthForest | Fórmulas vs HealthForest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nada | 77.816371 | 29.970546 | 29.970546 | −47.845825 (−61.5 %) | 0 |
| Vacuna N1 | 77.946748 | 29.998551 | 29.998551 | −47.948197 (−61.5 %) | 0 |
| Vacuna N2 | 77.963274 | 30.002101 | 30.002101 | −47.961173 (−61.5 %) | 0 |

El costo de N1 y de N2 coincide en las tres columnas porque esas ramas suman el precio de la vacuna y el costo del evento **sin** `discount`. El costo de Nada y todos los AVAC cambian en cuanto `annuity` y `discount` se calculan de verdad: 78 años al 3 % valen unos 30 años descontados, no 78.

Con esas fórmulas, Nada ya no está dominada: es la opción más barata (40.66) y la de menos AVAC. El RCEI de N1 frente a Nada es unos 72 por AVAC. El de N2 frente a N1 es **10840.11 por AVAC**, no 2328.49. El 2328.49 solo sale del archivo sin descontar.

## Sensibilidad y Monte Carlo

`Arbol2.trex` guarda rangos, no distribuciones. `monteRunTrials` está en falso y `monteNumSamples` es 0. No hay un PSA dentro del archivo, así que HealthForest no inventa uno en el ejemplo importado.

| Variable | Bajo | Alto |
| --- | ---: | ---: |
| costo_vacuna_N1 | 8 | 16 |
| costo_vacuna_N2 | 40 | 80 |
| rr_vacuna_N1 | 0.15 | 0.45 |
| rr_vacuna_N2 | 0.1 | 0.3 |
| desc | (no trae mínimo) | 0.06 |

El tornado usa los cuatro rangos completos. Como todas las ramas de N1 incluyen `costo_vacuna_N1`, mover ese precio de 8 a 16 mueve el costo de N1 en exactamente 8. `desc` no entra al tornado: el archivo solo guardó el extremo alto.

## Presupuesto Onclarity y Cobas

El libro `Budget impact analysis Onclarity Cobas.xlsx` tiene una sola hoja, `Onclarity`, y solo series de **salida**: costo total, costo de precáncer y costo de cáncer, para Onclarity y para Cobas. No trae población tamizada, precio de la prueba, cobertura ni costos unitarios. Las capturas de Power BI muestran esos totales y, por separado, el volumen de tamización de la Resolución 4505; no alcanzan para armar el cálculo.

HealthForest no puede reconstruir esos totales a partir de una población y un costo por persona, porque la serie no crece a una tasa constante: salta del año 1 al 2 y después casi se aplana. Meter los totales como “participaciones” solo repetiría la tabla, no la explicaría.

Lo que sí cierra, al centavo, es la suma que ya está en el libro. HealthForest no la recalcula; la comprueba.

| Año | Onclarity total en el libro | Suma precáncer + cáncer | Resto (total − ambos) | Cobas total | Suma precáncer + cáncer | Resto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 364528.81 | 132465.54 | 232063.26 | 451529.16 | 276562.66 | 174966.51 |
| 2 | 414899.67 | 185132.33 | 229767.34 | 557339.73 | 385000.47 | 172339.26 |
| 3 | 417571.86 | 188814.47 | 228757.39 | 563503.43 | 391981.92 | 171521.51 |
| 4 | 416290.46 | 188444.04 | 227846.42 | 561957.62 | 391116.77 | 170840.85 |
| 5 | 414679.59 | 187732.60 | 226946.98 | 559815.87 | 389642.60 | 170173.27 |

Los totales pedidos (364528.81 … y 451529.16 …) son exactamente la columna “Costo total” del libro. El resto, unos 227–232 mil para Onclarity y 170–175 mil para Cobas, no está desglosado. Sin el costo de la tamización y la población de cada año no se puede decir de qué está hecho.

## Ejemplo en la aplicación

En la portada, **Vacunas IECS** abre `Arbol2.trex` ya importado, con el nombre “Vacunas IECS (importado de TreeAge)”. También se puede usar **Abrir** con cualquier `.trex`. El umbral de pago no venía en el archivo; el ejemplo usa 5000 para que la comparación se lea en la tabla.
