# Preguntas frecuentes

**Hago doble clic y no pasa nada.**
Abre Chrome, Edge o Firefox y arrastra `Abrir HealthForest.html` a la ventana. No hace falta instalar Python.

**El navegador pide permiso para abrir archivos.**
No lo necesita. El HTML ya trae el programa dentro. Si una guía en `docs/guia` no se abre desde el botón ?, ábrela desde la carpeta o desde GitHub.

**Los números no coinciden con TreeAge.**
Revisa el umbral de pago, si el descuento está dentro de la fórmula y otra vez en las preferencias del Markov, y si el archivo usa `annuity` (valor presente de un pago repetido) o solo el número de años. La comparación con archivos reales está en `docs/validation.md`.

**El Monte Carlo no se mueve.**
Hace falta al menos una variable con distribución. En **Monte Carlo**, elige la variable y pulsa el atajo de probabilidad o de costo. Luego **Simular**.

**La pantalla dice que no puede calcular.**
Hay una fórmula rota. El aviso nombra el problema. Lo habitual es un paréntesis sin cerrar, una variable que no existe o una probabilidad negativa.

**¿Mis datos salen del computador?**
No. No hay servidor de cálculo. Guardar descarga un archivo en tu carpeta de descargas. La versión en línea también calcula en tu navegador.

**¿Puedo citarlo?**
Sí. Usa `CITATION.cff` en la raíz del repositorio.

**Quiero una función que no está.**
Abre un issue de GitHub con la plantilla "Pedir una función". Cuenta la tarea, no hace falta proponer la pantalla.
