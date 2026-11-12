# Activar el control diario en Supabase

El panel web está en https://scaffidi-control-prueba-lectura.scaffidisanti.chatgpt.site. Hasta que termine la primera importación, la web muestra la configuración pendiente. El control del escritorio conserva la última lectura local.

## 1. Crear el proyecto y habilitar la cuenta

Desde https://supabase.com/dashboard/new creá un proyecto de la inmobiliaria. Guardá la contraseña de la base en tu gestor de contraseñas. En Project Settings / API Keys y en Connect vas a encontrar la URL HTTPS del proyecto y su clave pública **publishable** (o **anon**). Esas son las dos entradas del panel privado.

La persona que instala necesita la CLI de Supabase y Node 24. Ejecutá los comandos desde la carpeta que contiene el directorio `supabase/`. Esta instalación puede hacerse sin GitHub.

```sh
supabase login
supabase link --project-ref REFERENCIA_DEL_PROYECTO
supabase db push
supabase functions deploy dropbox-sync --no-verify-jwt
```

La función comprueba una credencial propia en cada invocación. En **Authentication → Users**, creá tu usuario con correo y contraseña. Copiá su UUID. En SQL Editor, ejecutá esto reemplazando el valor:

```sql
insert into public.sc_members(user_id) values ('UUID_DEL_USUARIO') on conflict do nothing;
```

El registro explícito en sc_members da acceso de lectura al panel. Una cuenta nueva por sí sola no da acceso a las fichas. La clave de servicio queda en la función del servidor.

## 2. Autorizar Dropbox una sola vez

En https://www.dropbox.com/developers/apps creá una aplicación *Scoped access*. Para leer una carpeta existente elegí *Full Dropbox* como alcance de contenido. Concedé únicamente los permisos **files.metadata.read** y **files.content.read**. Copiá la **App key**. La función limita las consultas a la carpeta configurada.

En Terminal ejecutá:

```sh
node supabase/setup/autorizar-dropbox.mjs
```

El asistente abre el flujo de autorización mediante un enlace que debés visitar en Dropbox. Pegá el código en la Terminal. Para la carpeta compartida que ya usamos, ingresá el namespace de la carpeta compartida y la ruta **/A FICHAS/CARGADAS** dentro del mismo. Si accedés por el nombre montado en tu cuenta, ingresá la ruta completa comenzando con / y dejá el namespace vacío.

El asistente guarda los archivos de conexión en una carpeta privada bajo ~/.scaffidi-control y muestra su ruta. En el comando siguiente reemplazá RUTA_PRIVADA por esa ruta:

```sh
supabase secrets set --env-file "RUTA_PRIVADA/dropbox.private.env"
```

## 3. Conservar las confirmaciones y encender la tarea

Para conservar las decisiones ya tomadas en el escritorio, ejecutá una vez:

```sh
node supabase/setup/importar-validaciones.mjs "$HOME/Desktop/control pagos/validaciones.json" "RUTA_PRIVADA/confirmaciones.sql"
```

En el **SQL Editor del mismo proyecto**, ejecutá el contenido de `RUTA_PRIVADA/confirmaciones.sql` y luego el de `RUTA_PRIVADA/configurar-vault.sql`. Este último guarda el secreto de la tarea en Supabase Vault. Para activar la consulta programada cada minuto ejecutá el contenido de `supabase/setup/activar-cron.sql`. Podés revisar la ejecución en **Cron** y en los registros de la función **dropbox-sync**.

Los dos archivos privados de conexión, el SQL con confirmaciones y los Excel quedan fuera del repositorio. La carpeta de código que se despliega contiene solo el lector y la configuración.

## 4. Prueba desde el celular

Abrí el panel con la cuenta propietaria del sitio. En el primer acceso en cada dispositivo ingresá la URL y la clave pública del proyecto. Entrá con el correo habilitado en Supabase. Esperá la primera importación completa. Puede tardar varios ciclos para cientos de fichas.

Elegí el mes. El panel muestra cada cobro con fecha y recibo, el importe registrado, la ventana contractual, el vencimiento y la última comprobación completa de Dropbox. «Cobro registrado» indica que el movimiento figura en la ficha. «Pagado» requiere que el importe exigible esté validado o que exista una confirmación correspondiente a esa versión. Una fecha sin hora informa el día del pago. La hora que figura arriba corresponde a la sincronización.

Para medir el tiempo real, anotá la hora de guardado del próximo cobro verdadero en Dropbox y comprobá desde el celular cuándo aparece. La tarea corre cada minuto y el navegador consulta al volver a la pantalla y cada minuto mientras está visible. Una cola de cambios, la primera carga, la conciliación diaria, la disponibilidad del proyecto y errores de Dropbox pueden aumentar el plazo. A partir de cinco minutos desde el último éxito, el panel advierte sobre la antigüedad de los datos. Un error conserva la última lectura completa.

La sincronización cubre archivos Excel directamente dentro de CARGADAS. Una carpeta distinta, los subdirectorios y nuevos formatos de contrato necesitan su propia verificación.

Documentación de administración: [programar funciones en Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [permisos de filas](https://supabase.com/docs/guides/database/postgres/row-level-security), [autorización de Dropbox](https://developers.dropbox.com/oauth-guide).
