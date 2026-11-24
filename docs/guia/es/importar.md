# Importar un modelo de TreeAge

HealthForest lee archivos `.trex` de TreeAge Pro que sean XML (no un ZIP con otro nombre). Sirve para árboles de decisión y para modelos de Markov.

1. Pulsa **Abrir**.
2. Elige el archivo `.trex`.
3. El árbol aparece con sus variables, sus tablas y, si el archivo las trae, sus distribuciones.

Qué se trae:

- Nodos de decisión, azar, terminal y Markov.
- Fórmulas con punto y coma, que TreeAge usa entre argumentos. HealthForest las entiende.
- `#` como probabilidad complementaria.
- Saltos de Markov (`healthy`, `disease`…), recompensas de estado y peajes de transición.
- Tablas. En una fórmula se escriben `tabla[edad]`.
- Distribuciones gamma, beta y normal, y el número de repeticiones guardado en el archivo.

Qué conviene revisar después de importar:

- El umbral de pago. Muchos `.trex` no lo traen. HealthForest pone 5000 para que la tabla se pueda leer. Cámbialo en **Resultados**.
- El descuento. Si la fórmula ya usa `discount(...)`, el Markov no vuelve a descontar encima.
- Las distribuciones. Si el archivo no tiene, el Monte Carlo no tiene nada que sortear. Puedes asignarlas tú en **Monte Carlo**.

El ejemplo de la portada, **Vacunación: árbol importado de TreeAge**, es un ejemplo de vacunación elaborado por Daniel Uribe (importado de TreeAge). Ábrelo si quieres ver un árbol real sin tener el archivo a mano.
