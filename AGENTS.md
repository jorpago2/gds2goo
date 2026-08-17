
# low-cost-gds project guidance

## Arquitectura y propiedad

- React es el único propietario de la estructura, visibilidad, atributos ARIA, estado visual y eventos de la interfaz.
- `src/App.tsx` coordina el estado y las acciones; `lib/gds.js`, `lib/raster.js`, `lib/goo.js` y el resto de `lib/` deben mantener la lógica de dominio independiente del DOM.
- El parser y el flattening GDSII (`parseGds`/`flattenGds`) producen datos y advertencias; no deben modificar nodos React ni guardar referencias a ellos.
- El canvas se dibuja desde refs y efectos controlados por React. El código de dominio y los Workers no manipulan directamente el DOM renderizado por React.

## Importación GDSII y límites

- La importación es local al navegador. Conserva la validación de `.gds`/`.gdsii`, el límite de 25 MB, el hash de origen cuando se usa un manifiesto y los mensajes de compatibilidad.
- No ocultes elementos GDS no rasterizables ni advertencias de jerarquía, referencias, datatypes o transformaciones absolutas. Si la aplicación no los aplica, el usuario debe poder saberlo.
- Respeta los presupuestos de expansión de `flattenGds` (`maxShapes`, `maxInstances`, `maxPoints` y profundidad). No los elimines ni los conviertas en un fallo silencioso para aceptar archivos grandes.
- Mantén separadas la representación GDS, la geometría a escala física y la rasterización para la pantalla LCD. Comprueba unidades, orientación, anclaje, espejo, inversión y resolución antes de cambiar una transformación.

## Worker de exportación

- `src/workers/maskExportClient.ts` es la frontera entre React y `mask-export.worker.ts`. Conserva request IDs, progreso, cancelación, rechazo de solicitudes pendientes ante errores y transferencias de buffers.
- Mantén rasterización, codificación GOO y PNG fuera del hilo principal cuando ya pertenezcan al Worker. El Worker no debe recibir refs DOM ni decidir estado visual.
- Un cambio en los límites, el formato del mensaje o los datos transferidos requiere comprobar tanto el cliente como el Worker y una exportación real; no basta con que TypeScript compile.

## Carbon y `scientific-ui`

- Usa la versión instalada de `@carbon/react` cuando encaje, pero Carbon no garantiza por sí solo una composición clara, jerarquía correcta o buen responsive. Consulta documentación o Storybook solo al introducir un componente, resolver una duda o sobrescribir estilos internos.
- Respeta tokens, accesibilidad, foco, teclado, estados de carga/error/vacío y comportamiento responsive. Evalúa la interfaz renderizada, no solo el JSX.
- Corrige por defecto los problemas específicos de esta aplicación. Modifica `@jorpago2/scientific-ui` únicamente si la causa pertenece realmente al componente compartido y la corrección debe propagarse.
- Si se actualiza la dependencia vendorizada, cambia conjuntamente `package.json`, `pnpm-lock.yaml` y `vendor/jorpago2-scientific-ui-*.tgz`, y comprueba que el tarball nuevo queda rastreado por Git.

## Camino rápido y colaboración

- Atiende una familia concreta de problemas por iteración. Inspecciona la implementación relevante y una resolución representativa; amplía el alcance solo si el riesgo o el resultado lo justifican.
- Usa subagentes `gpt-5.6-luna` con razonamiento `max` en paralelo solo para partes independientes donde mejoren claramente velocidad, cobertura o calidad. Asigna archivos y objetivos sin solapamiento; el agente principal integra, revisa el diff y verifica el estado final.
- No uses subagentes para cambios pequeños o fuertemente acoplados, ni permitas ediciones simultáneas del mismo archivo.

## Verificación

- Para cambios visuales o de interacción, usa `$browser:control-in-app-browser` cuando esté disponible, inspecciona la pantalla renderizada y reutiliza el servidor local y HMR durante la iteración. No declares resuelto un problema visual solo por compilación o inspección estática.
- Cambio visual localizado: navegador interno y resolución afectada. Cambio responsive: escritorio y un viewport representativo del breakpoint. Cambio de parser, Worker o TypeScript: ejecuta el flujo afectado y las comprobaciones correspondientes.
- Usa únicamente los scripts reales del proyecto: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:ui`, `pnpm build`, `pnpm dev`, `pnpm preview`, `pnpm storybook` y `pnpm build-storybook`.
- `pnpm test` construye la aplicación y ejecuta las pruebas Node; `pnpm test:ui` ejecuta los flujos de navegador. Reserva `pnpm build` para la integración final o antes de publicar, y no ejecutes una matriz completa para un ajuste localizado.
- Mantén separadas la validez de la conversión GDS/raster y la calidad visual salvo que el cambio afecte a ambas. Informa solo de comprobaciones realmente ejecutadas.
