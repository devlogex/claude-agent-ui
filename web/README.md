# web/

The React client lives here. It is built with Vite into `dist/web/`, which `src/server.ts`
serves as static files (`AppOptions.webRoot`).

Nothing is here yet: the client is M2. Until then the server exposes the JSON API only, and
`express.static` on a missing `dist/web` simply falls through to the API routes.
