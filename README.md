# SpaceHo2 🤠

A browser-based tribute to the classic 4X strategy game **Spaceward Ho!**
Pure HTML5 canvas + vanilla JavaScript — no build step, no dependencies.

## Play

Open `index.html` in a browser (or serve the folder, e.g. `python3 -m http.server`).

You command the blue empire against three AI rivals. Last empire standing wins.

## How it works

- **Planets** have a temperature, gravity, and metal reserves. How well your
  people thrive on a planet (its *suitability*) depends on how close it is to
  your homeworld's ideal temperature and gravity. Suitability drives population
  growth and income.
- **Terraforming** moves a planet's temperature toward your ideal — gravity is
  forever. **Mining** converts reserves into metal for shipbuilding; when your
  stockpile runs dry, the galactic market sells metal at a steep markup.
- **Research** has six tracks: Range, Speed, Weapons, Shields,
  Miniaturization (cheaper ships), and Radical (cheaper research). Ships keep
  the tech levels they were *built* with, so old hulls grow obsolete.
- **Ships**: Scouts explore and refresh intel, Colony Ships settle uninhabited
  worlds, Satellites defend in place, and Fighters / Destroyers / Dreadnoughts
  fight. Combat is automatic when rival fleets share a system; warships
  orbiting an undefended enemy world bombard its population.
- **Fog of war**: you only see live data where you have a planet or ship;
  everywhere else you see the last survey (dashed rings on the map).
- Press **Ho!** to end your turn.

## Development

The model (`js/model.js`, `js/ai.js`, `js/data.js`) is DOM-free and testable
headless:

```sh
node test/smoke.js                 # simulates full AI-vs-AI games
npm install --no-save jsdom
node test/ui.test.js               # drives the real UI in jsdom
```
