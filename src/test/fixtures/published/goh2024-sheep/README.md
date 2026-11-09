# Goh et al. 2024: sheep core body temperature

Goh, G., Vesterdorf, K., Fuller, A., Blache, D., & Maloney, S. K. (2024). Optimal sampling
interval for characterisation of the circadian rhythm of body temperature in homeothermic animals
using periodogram and cosinor analysis. _Ecology and Evolution_, 14, e11243.
https://doi.org/10.1002/ece3.11243

Data: Goh, G. et al. (2024). Dryad, https://doi.org/10.5061/dryad.1g1jwsv46. **Licence: CC0 1.0**
(public-domain dedication), so it may be redistributed here.

## File

- `Tc_Sheep.csv` (144,950 bytes, sha256
  `8e9f68e869df4d2bd2e74fc6b53e05f57bcd159339fcae703826e0d160b9ffe7`): the deposit's "Sheep"
  sheet of `Five_days_of_Tc_data_in_nine_species.xlsx` (sha256
  `de4eb3450f25f75f8ebe04944a86cc8143eeea2d40bbb521674153fafe1f7ae3`, from the Dryad mirror at
  Zenodo record 10894770), written unchanged as a wide CSV: `time_h` (hours from the first sample,
  every 5 min, 5 days) then one column per animal (Tc, °C). No missing values.

## Published result pinned

Paper, p. 5 (Results 3): of the individuals whose dominant Lomb-Scargle period was not about 24 h,
one sheep peaked at 12 h. With a Lomb-Scargle periodogram over 4 to 36 h in 0.1 h steps, AnCiR
finds Sheep 7 at 12.0 h and the other eleven sheep between 23.2 and 25.2 h (the paper: every
other individual near 24 h, Figure 2). Each animal's peak period is also pinned to AnCiR's value
(to 0.1 h) as a regression golden.
