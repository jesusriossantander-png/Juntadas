# 🔥 La Juntada

Calculadora para dividir los gastos cuando se juntan con amigos, con registro de las juntadas y aviso cuando hace mucho que no se juntan.

**App:** https://jesusriossantander-png.github.io/Juntadas/

## Qué hace

- **Calculadora**: cargás quién puso cuánto en comida y en bebida (pueden ser 2 o 3 los que compraron) y la app divide en partes iguales entre los que participan y dice **quién le paga a quién**, con la menor cantidad de transferencias. Si alguien compró pero no participa, marcás "No entra" y recupera lo que puso. Los cálculos son exactos al centavo.
- **Etiquetas por persona**: cada uno es una etiqueta (de a dos por fila) donde se carga el nombre, lo que puso en comida y en bebida, si toma y cuánto estuvo. La bebida la pagan solo los que toman.
- **Tiempo que estuvo**: 100%, 75%, 50%, 25%, otro porcentaje o "No entra" (compró pero no participa); cada uno paga en proporción.
- **Resultado**: abajo, mitad y mitad, el total gastado (con comida y bebida) y quién le paga a quién.
- **Compartir**: un botón manda las cuentas al grupo por WhatsApp.
- **Registro**: cada juntada guardada queda con fecha, lo que puso cada uno y las transferencias. Se puede editar.
- **Grupo compartido**: desde Ajustes se crea el grupo y se manda el link por WhatsApp. Todos ven el mismo registro, cualquiera puede cargar y los cambios aparecen en vivo en los demás celulares. Sin usuarios ni contraseñas: el link lleva un código secreto.
- **Aviso**: si pasan más de X días desde la última juntada (7, 15, 30, 45, 60 o el número que elijas), aparece "🍻 ¡Hace N días que no se juntan!" al abrir la app y, en el grupo, **llega una notificación a cada celular** que activó los avisos (una vez por ciclo).
- Los amigos que ya cargaste quedan guardados para agregarlos con un toque.

Sin grupo, todo queda guardado en el celular. Con grupo, se guarda en Supabase (plan gratis). Desde Ajustes se puede bajar un respaldo.

## Cómo está armado el grupo compartido

- **Supabase**: `supabase/migrations/20261102000100_grupo_compartido.sql` crea las tablas y las funciones. La app no puede leer las tablas directamente: solo llama funciones que exigen el código del grupo.
- **Tiempo real**: cuando alguien guarda, los demás celulares se enteran por un canal de Supabase Realtime y recargan.
- **Avisos**: `.github/workflows/avisos.yml` corre todos los días a las 10:17 (hora argentina) `scripts/avisos.mjs`, que pide a Supabase los grupos vencidos y manda la notificación (Web Push) a cada celular suscripto. Necesita el secret `JUNTADA` (clave secreta de Supabase) en GitHub. La clave privada de los avisos se guarda en la tabla `config` de Supabase.
- En **iPhone**, las notificaciones solo llegan con la app agregada a la pantalla de inicio (iOS 16.4 o más nuevo).

Pruebas: `npm test` (cálculos), `node tests/nube.integracion.mjs` y `node tests/grupo.e2e.mjs` (contra un Supabase local).

## Instalar en el celular

- **Android**: abrí la app en Chrome → menú ⋮ → "Instalar app" / "Agregar a pantalla principal".
- **iPhone**: abrila en Safari → Compartir → "Agregar a inicio".

Una vez instalada funciona sin internet.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # cálculos y aviso
npm run build      # genera dist/
npm run test:e2e   # prueba en el navegador (con `npx vite preview --port 4173` corriendo)
```

Se publica sola en GitHub Pages con cada push a `main` (workflow `deploy-pages.yml`; en *Settings → Pages* el *Source* tiene que ser **GitHub Actions**).
