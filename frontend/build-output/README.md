# Built frontend (HTML, CSS, JavaScript)

This folder is the production build of the React app in `../src`, the same files that are served at
https://trustwork-psi.vercel.app. It is generated, not hand-written:

```bash
cd frontend
VITE_API_URL=https://trustwork-api-c6as.onrender.com npx vite build --outDir build-output --emptyOutDir
```

- `index.html`: the page shell
- `assets/*.css`: all styles (compiled from Tailwind CSS in `src/index.css`)
- `assets/*.js`: all application code (compiled from `src/**/*.jsx` and `src/lib/*.js`)

To read or change the code, use the source in `../src`.
