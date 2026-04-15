/**
 * Ejekat Nemi — Cloudflare Worker: Disponibilidad
 * Lee eventos de Google Calendar via API Key pública
 *
 * Ruta: GET /disponibilidad?guia=mauricio-ardon
 *
 * Variables en Cloudflare:
 *   GOOGLE_CALENDAR_API_KEY → AIzaSy...
 *   CALENDAR_BAILE_ID       → c_83a7...@group.calendar.google.com
 *   CALENDAR_TOURS_ID       → c_b41d...@group.calendar.google.com
 *   ALLOWED_ORIGIN          → https://ejekatnemi.com
 */

const GUIAS = {
  'mauricio-ardon': {
    nombre:      'Mauricio Ardón Galdámez',
    calendarios: ['baile', 'tours'],
  }
  // Agregar más guías aquí cuando se unan a La Cantera:
  // 'nombre-guia': { nombre: 'Nombre Completo', calendarios: ['baile'] }
};

export default {
  async fetch(request, env) {

    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResp(null, 204, allowed);
    }

    // Validar origen
    if (allowed && origin !== allowed) {
      return corsResp({ error: 'Origen no autorizado' }, 403, allowed);
    }

    // ── Ruta: GET /disponibilidad ──
    if (request.method === 'GET' && url.pathname === '/disponibilidad') {
      const guiaId = url.searchParams.get('guia') || 'mauricio-ardon';
      const guia   = GUIAS[guiaId];

      if (!guia) {
        return corsResp({ error: 'Guía no encontrado' }, 404, allowed);
      }

      const apiKey = env.GOOGLE_CALENDAR_API_KEY;
      if (!apiKey) {
        return corsResp({ error: 'API Key no configurada' }, 500, allowed);
      }

      // Calcular rango de fechas — próximos 30 días
      const ahora  = new Date();
      const fin    = new Date();
      fin.setDate(fin.getDate() + 30);

      const timeMin = ahora.toISOString();
      const timeMax = fin.toISOString();

      const calendarioIds = {
        baile: env.CALENDAR_BAILE_ID,
        tours: env.CALENDAR_TOURS_ID,
      };

      // Consultar cada calendario del guía
      const resultados = {};

      for (const tipo of guia.calendarios) {
        const calId = calendarioIds[tipo];
        if (!calId) continue;

        const calIdEnc = encodeURIComponent(calId);
        const apiUrl   = `https://www.googleapis.com/calendar/v3/calendars/${calIdEnc}/events?` +
          `key=${apiKey}` +
          `&timeMin=${encodeURIComponent(timeMin)}` +
          `&timeMax=${encodeURIComponent(timeMax)}` +
          `&singleEvents=true` +
          `&orderBy=startTime` +
          `&maxResults=50`;

        try {
          const res  = await fetch(apiUrl);
          const data = await res.json();

          if (!res.ok) {
            resultados[tipo] = { error: data.error?.message || 'Error al leer calendario' };
            continue;
          }

          // Procesar eventos
          const eventos = (data.items || [])
            .filter(e => e.summary?.toLowerCase().includes('disponible'))
            .map(e => ({
              titulo:  e.summary,
              inicio:  e.start?.dateTime || e.start?.date,
              fin:     e.end?.dateTime   || e.end?.date,
              todo_el_dia: !e.start?.dateTime,
            }));

          // Extraer disponibilidad por día de la semana
          const porDia = {};
          eventos.forEach(e => {
            const fecha = new Date(e.inicio);
            const dia   = fecha.toLocaleDateString('es-SV', { weekday: 'long' });
            const hora  = e.todo_el_dia ? 'Todo el día' :
              `${new Date(e.inicio).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })} – ` +
              `${new Date(e.fin).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}`;

            if (!porDia[dia]) porDia[dia] = new Set();
            porDia[dia].add(hora);
          });

          // Convertir Sets a arrays
          const disponibilidad = {};
          Object.entries(porDia).forEach(([dia, horas]) => {
            disponibilidad[dia] = Array.from(horas);
          });

          resultados[tipo] = {
            total_eventos: eventos.length,
            disponibilidad,
            proximos_eventos: eventos.slice(0, 5),
          };

        } catch (err) {
          resultados[tipo] = { error: err.message };
        }
      }

      return corsResp({
        guia:          guia.nombre,
        guia_id:       guiaId,
        periodo:       { desde: timeMin, hasta: timeMax },
        calendarios:   resultados,
        actualizado:   new Date().toISOString(),
      }, 200, allowed);
    }

    // ── Ruta: POST / — leads (Worker principal heredado) ──
    if (request.method === 'POST' && url.pathname === '/') {
      return corsResp({ error: 'Use el Worker de leads para POST /' }, 400, allowed);
    }

    return corsResp({ error: 'Ruta no encontrada' }, 404, allowed);
  }
};

function corsResp(data, status, origin) {
  return new Response(
    data ? JSON.stringify(data) : null,
    {
      status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods':'GET, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type',
        'Access-Control-Max-Age':      '86400',
        'Cache-Control':               'public, max-age=300', // cache 5 min
      }
    }
  );
}
