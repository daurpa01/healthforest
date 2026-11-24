# Glossary

**CEAC.** Cost-effectiveness acceptability curve. For each willingness-to-pay threshold, the fraction of Monte Carlo draws in which a strategy is preferred.

**CEAF.** Cost-effectiveness acceptability frontier. At each threshold, the strategy that wins most often.

**Cohort.** The group that enters the model together. In a Markov model it is usually shown as 1 (100 percent) and split across states.

**Discounting.** Reducing the value of a cost or an effect that happens in the future. `discount(1000, 0.03, 5)` is 1000 in five years, at 3 percent.

**EVPI.** Expected value of perfect information. What you would pay, per patient, to know the true value of every parameter.

**EVPPI.** The same thing for one parameter, or a small group of them.

**Extended dominance.** A strategy sits above the line that joins two others: its ICER is worse than skipping ahead to the next one. It is left off the frontier.

**Efficient frontier.** The strategies that are not dominated, ordered from less effect to more effect.

**ICER.** Incremental cost-effectiveness ratio. Incremental cost divided by incremental effect. Read it as "extra cost for each extra QALY". It is not meaningful when a strategy is dominated.

**Incremental cost.** Cost of the new strategy minus cost of the reference strategy.

**Markov model.** A model that steps forward in cycles. In each cycle the cohort is split across states by a set of probabilities.

**Monte Carlo.** Repeating the model many times while drawing the parameters, so you can see the uncertainty.

**Net health benefit.** Effect minus cost divided by the threshold. The same idea as net monetary benefit, measured in QALYs.

**Net monetary benefit.** Effect times the willingness-to-pay threshold, minus cost. It compares strategies with a single number. The highest one wins.

**QALY.** Quality-adjusted life year. A year in full health is worth 1. A year with a utility of 0.7 is worth 0.7.

**Strong dominance.** A strategy costs more and produces less effect than another. It is not used to compute an ICER.

**Tornado.** Sensitivity bars, from the most influential variable to the least.

**Utility.** The quality-of-life weight, between 0 and 1, that multiplies time.

**Willingness to pay.** The most a decision maker would pay for one additional QALY. On screen it is the slider on Results.
