# Portada responsive — implementación local

Rama codex/hero-responsive. Migración preparada y probada únicamente en PostgreSQL
aislado en memoria. La aplicación del esquema a producción requiere autorización.

La migración 20261121123355_hero_responsive.sql agrega imagen móvil opcional y cuatro
coordenadas de encuadre. Los puntos focales de escritorio y celular son independientes,
entre 0 y 100, con valor inicial 50. La URL de escritorio existente se conserva.

## Configuración

En Mi tienda → Página de inicio → Portadas de la tienda:
- Cargar portada de escritorio. Proporción sugerida 1600 × 700.
- Cargar portada móvil opcional. Proporción sugerida 900 × 1200.
- Ajustar Horizontal y Vertical para cada dispositivo y guardar.
- Usar portada de escritorio en móvil vacía el campo al guardar. Los archivos anteriores
  permanecen en Storage.
- Las vistas previas muestran el encuadre. Se conservan los textos y destinos de botones.

El cambio de imagen conserva el guardado inmediato del editor existente. Los puntos
focales y el vaciado del campo móvil se aplican con Guardar en Supabase.
La subida reutiliza ImagePicker y la API autenticada de Storage.

La imagen móvil se selecciona por debajo de 768 px mediante picture. Sin ella se usa la
imagen de escritorio. Los lectores toleran filas antiguas sin los campos nuevos.
Los guardados de campos nuevos requieren la migración y comunican su ausencia.

## Reversión

Primero respaldar los cinco campos nuevos y volver a una versión de la aplicación
compatible con el esquema anterior. El SQL en scripts/maintenance/rollback-hero-responsive.sql
elimina únicamente esas columnas. La imagen de escritorio, los textos y los archivos de
Storage permanecen. La reversión descarta la configuración nueva si no se respaldó.

## Revisión local aislada

El chequeo visual utiliza el componente Hero y su CSS compilado, con imágenes sintéticas
locales para distinguir las fuentes. La selección y las cargas reales en Storage requieren
un proyecto Supabase de desarrollo con esta migración aplicada.
