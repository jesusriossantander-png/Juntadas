# 🔥 La Juntada

Calculadora para dividir los gastos cuando se juntan con amigos, con registro de las juntadas y aviso cuando hace mucho que no se juntan.

**App:** https://jesusriossantander-png.github.io/Juntadas/

## Qué hace

- **Calculadora**: cargás quién puso cuánto (pueden ser 2 o 3 los que compraron) y la app divide en partes iguales entre los que participan y dice **quién le paga a quién**, con la menor cantidad de transferencias. Si alguien compró pero no participa, marcás "No entra" y recupera lo que puso. Los cálculos son exactos al centavo.
- **Alcohol aparte**: activando "Separar el alcohol", cada uno indica cuánto de lo que puso fue alcohol y quién no toma. El alcohol lo pagan solo los que toman; el resto, todos.
- **Tiempo que estuvo**: si alguien llegó muy tarde o estuvo un rato, se le pone "La mitad (50%)", "Un rato (25%)" u otro porcentaje y paga en proporción.
- **Compartir**: un botón manda las cuentas al grupo por WhatsApp.
- **Registro**: cada juntada guardada queda con fecha, lo que puso cada uno y las transferencias. Se puede marcar como saldada, editar o borrar.
- **Aviso**: si pasan más de X días desde la última juntada (7, 15, 30, 45, 60 o el número que elijas), al abrir la app aparece "🍻 ¡Hace N días que no se juntan!" con un botón para avisar al grupo.
- Los amigos que ya cargaste quedan guardados para agregarlos con un toque.

No hace falta registrarse: todo queda guardado en el celular (sin servidores). Desde Ajustes podés bajar un respaldo y cargarlo en otro teléfono.

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
