# Vi3W Coin Rush
3D coin-collector game (React + Three.js via react-three-fiber). Player and coin models come from Vi3W (app.vi3w.in); rocks are procedural low-poly.

## Run
    npm install
    npm run dev

## Use your Vi3W models
Download as .glb and save as `public/models/player.glb` and `public/models/coin.glb`.
Missing files fall back to built-in placeholders.

## Deploy
    npm run build   # upload `dist` to Vercel/Netlify
