# FAQ

**I double-click and nothing happens.**
Open Chrome, Edge or Firefox and drag `Abrir HealthForest.html` onto the window. You do not need to install Python.

**The browser asks for permission to open files.**
It does not need that. The HTML file already contains the program. If a guide in `docs/guia` does not open from the ? button, open it from the folder or from GitHub.

**The numbers do not match TreeAge.**
Check the willingness to pay, whether discounting is inside the formula and also in the Markov settings, and whether the file uses `annuity` (the present value of a repeated payment) or just a count of years. Comparisons with real files are in `docs/validation.md`.

**Monte Carlo does not move.**
At least one variable needs a distribution. On **Monte Carlo**, pick the variable and use the probability or cost shortcut. Then click **Simulate**.

**The screen says it cannot calculate.**
A formula is broken. The message names the problem. The usual causes are an unclosed bracket, a variable that does not exist, or a negative probability.

**Do my data leave the computer?**
No. There is no calculation server. Save downloads a file to your downloads folder. The online version also calculates in your browser.

**Can I cite it?**
Yes. Use `CITATION.cff` at the root of the repository.

**I want a feature that is not there.**
Open a GitHub issue with the "Pedir una función" template. Describe the task. You do not need to design the screen.
