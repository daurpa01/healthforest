# Import a TreeAge model

HealthForest reads TreeAge Pro `.trex` files that are XML (not a zip with another name). It handles decision trees and Markov models.

1. Click **Open**.
2. Choose the `.trex` file.
3. The tree appears with its variables, its tables and, if the file has them, its distributions.

What comes across:

- Decision, chance, terminal and Markov nodes.
- Formulas that use semicolons between arguments, the way TreeAge writes them.
- `#` as the complementary probability.
- Markov jumps (`healthy`, `disease`…), state rewards and transition tolls.
- Tables. In a formula they are written `table[age]`.
- Gamma, beta and normal distributions, and the repetition count stored in the file.

What to check after importing:

- Willingness to pay. Many `.trex` files do not store it. HealthForest uses 5000 so the table can be read. Change it on **Results**.
- Discounting. If a formula already uses `discount(...)`, the Markov model does not discount a second time.
- Distributions. If the file has none, Monte Carlo has nothing to draw. You can assign them on **Monte Carlo**.

The **IECS vaccines** example on the welcome screen is a course `.trex` that is already imported. Open it if you want a real tree without having the file.
