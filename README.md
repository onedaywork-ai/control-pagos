# Scaffidi Control: prueba funcional de lectura

Primer componente verificable de la aplicación. Lee fichas Excel reales en el navegador y muestra contratos históricos, períodos, movimientos y celdas de origen. No modifica los originales. No contiene datos de clientes en el código ni en el despliegue.

## Operativo

- Lectura `.xlsx`, `.xls`, `.xlsm` con SheetJS 0.20.3, sin ejecutar macros.
- Reconocimiento del formato `INFO CONTRATO` / `PAGOS`, con encabezados desplazados y varios bloques contractuales.
- Año derivado del inicio del bloque y el número de período, nunca de la fecha de cobro.
- Separación entre alquiler, depósito, comisión y servicios.
- Suma de movimientos con fecha, identificación de pagos sin fecha, recibos reutilizados y copias en conflicto.
- Evidencia por hoja/celda y exportación JSON. Sin almacenamiento persistente de datos personales en el sitio.
- Motor de estados con importe exigible y contrato validados; la interfaz de esta primera prueba conserva REVISAR porque todavía no incorpora una validación contractual permanente.

## Límites del piloto

La selección manual de Excel sirve para validar la lectura inicial. No es el mecanismo definitivo de actualización. El conector Dropbox instalado en el chat permitió revisar una muestra real, pero no autoriza una conexión autónoma desde la aplicación.

Faltan OAuth de Dropbox propio del servidor, webhooks, cursor incremental, reintentos, base de datos Supabase, Auth y roles, historial de auditoría y conciliación continua. El sitio de prueba es privado mediante Sites; no implementa aún los roles internos de la inmobiliaria. No hay configuración falsa ni botón de sincronización simulado.

Los identificadores del piloto identifican bloque y versión para trazabilidad. La base definitiva deberá asignar UUID permanentes al contrato y conservar las relaciones con archivos, renovaciones y grupos de cobro. En particular, un grupo de cobro puede representar varios contratos, con asignaciones explícitas que impidan duplicar el importe.

Las fórmulas se leen con el valor guardado, pero no se recalculan y no se aceptan como evidencia automática de cobro. Las estructuras distintas se remiten a revisión. El lector no interpreta por sí solo DOCX/PDF ni valida aumentos ICL.

## Desarrollo

Node 24. Instalar dependencias con el helper de Sites del entorno o `npm ci`.

```
node --test tests/*.test.ts
npx tsc --noEmit
npm run dev
```

La prueba no lleva muestras privadas en el repositorio. La verificación contra la muestra real y el informe están fuera del código del sitio.

## Criterio para el próximo paso

Contrastar una muestra con el equipo, registrar sus decisiones por contrato y comprobar una sincronización real de Dropbox que reprocese solo archivos cambiados. Solo entonces habilitar estados definitivos en el panel.

## Control diario remoto · noviembre de 2026

La pantalla principal usa Supabase Auth y consulta el mes seleccionado al entrar, al volver a la pestaña y cada minuto. La lectura manual del piloto se conserva en /lector. La función de Dropbox y la configuración de Supabase están en [la guía de activación](supabase/ACTIVACION.md). El proceso programado conserva el cursor, las lecturas y el último corte completo en Postgres. El servidor necesita un proyecto Supabase habilitado y autorización OAuth de Dropbox.
