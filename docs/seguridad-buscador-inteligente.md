# Dependencias del buscador: validación de seguridad

Base: `e7196cfe2abca0bc3e7c46ae8c350492d987544c`, rama `feature/smart-search-mundo-parity`, PR #3. Entorno local aislado con Node.js 22.23.5, sin `.env.local` ni operaciones productivas.

## Auditoría inicial

`npm audit --json` informó 16 alertas de paquetes: 1 crítica, 5 altas, 9 moderadas y 1 baja. Son alertas agregadas por paquete, no 16 CVE independientes.

| Severidad | Paquetes afectados |
| --- | --- |
| Crítica | `next` |
| Alta | `sharp`, `brace-expansion`, `js-yaml`, `source-map-js`, `zod` |
| Moderada | `minimatch`, `typescript-eslint`, cinco paquetes `@typescript-eslint` (`eslint-plugin`, `parser`, `type-utils`, `typescript-estree`, `utils`), `mercadopago`, `uuid` |
| Baja | `dompurify` |

Next tenía, entre otros, avisos de ejecución remota y problemas de caché. Sharp tenía avisos de sus bibliotecas nativas de imágenes. Referencias: [Next en Windows](https://github.com/advisories/GHSA-p293-qw3h-jr36), [Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [Sharp/librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

## Cambios mediante npm

- `next` y `eslint-config-next`: 16.3.2 → 16.4.6, manteniendo la misma versión entre ambos.
- `sharp`: 0.35.3 → 0.35.5.
- Actualización dirigida de las cadenas transitivas afectadas dentro de los rangos de sus padres. Entre otras: `brace-expansion` 1.1.22, `dompurify` 3.5.0, `js-yaml` 4.3.2, `source-map-js` 1.2.4, `zod` 4.6.7 y `typescript-eslint` 8.74.0.
- Se mantienen Mercado Pago 2.13.0, Supabase JS 2.112.4, React y React DOM 19.2.8. No se agregan overrides ni exclusiones para ocultar alertas.
- El flujo de GitHub incorpora `npm audit --omit=dev --audit-level=high` después de `npm ci`.

## Riesgo residual explícito

La auditoría tras actualizar informa 0 críticas, 0 altas, 2 moderadas y 0 bajas. Las dos entradas son una misma cadena: `mercadopago@2.13.0 → uuid@9.0.1`, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

El aviso afecta a las funciones `v3/v5/v6` cuando reciben buffers externos. La inspección del SDK instalado muestra `v4()` sin argumentos en `dist/utils/restClient/index.js`. Esa llamada no usa las funciones señaladas, pero esto no elimina la alerta del paquete ni constituye una garantía general de ausencia de riesgos.

npm propone actualizar Mercado Pago a 3.6.2, una versión mayor. No se realizó ese cambio ni se forzó una dependencia mayor dentro del SDK porque el alcance prohíbe modificar Mercado Pago. Su eventual actualización requiere autorización y validación independiente de la integración. El umbral de auditoría productiva alto/crítico puede pasar aunque queden alertas moderadas; no debe describirse como una auditoría sin vulnerabilidades.

## Conservación y publicación

El código del buscador, su diseño, la cabecera, el carrito y el motor de compatibilidades se conservan. No se modifican API comerciales, stock, pedidos, clientes, ventas, sesiones, permisos ni datos. No hay migraciones, merge ni despliegue.

La publicación requiere la aprobación del responsable, con conocimiento del riesgo moderado residual.

## Resultados finales

| Comprobación con Node.js 22.23.5 | Resultado |
| --- | --- |
| `npm ci` | Salida 0, lockfile reproducible |
| `npm audit --omit=dev --audit-level=high` | Salida 0; 0 altas/críticas y 2 moderadas |
| `npx tsc --noEmit` | Salida 0 |
| `npm run test:store` | Salida 0; 712 pruebas: 711 aprobadas, 0 fallidas, 1 omitida |
| `npm run lint` | Salida 0; 0 errores y 66 advertencias |
| `npm run build` | Salida 0; Next.js 16.4.6, Webpack, 102 páginas estáticas generadas |

La revisión de componentes reales con CSS compilado y datos ficticios comprobó ambos modos del buscador, marca, logo y carrito en 360, 390, 430, 768 y 1440 px, sin desbordes horizontales. La suite conserva cobertura de conector/autocompletado, cambio de modo, marca/modelo/año/posición, compatibilidad verificada, ausencia de resultados, filtros y contratos de navegación y carrito. No se realizaron consultas comerciales reales para validar esos recorridos.

Sharp 0.35.5 convirtió y redimensionó correctamente una imagen sintética a WebP en memoria. La comparación con la base confirma que los archivos del buscador, cabecera, carrito, API comerciales, sesiones y permisos no cambiaron. El commit final y estos resultados se registran en el PR #3.
