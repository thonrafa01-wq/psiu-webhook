import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Proxy seguro para o banco de dados da PSIU Telecom
// O Render chama esta função passando um service_key fixo para autenticação
// Assim o BASE44_SERVICE_TOKEN nunca precisa ser renovado no Render

const SERVICE_KEY = 'psiu-internal-2026';

Deno.serve(async (req) => {
  try {
    // Autenticação via service key fixo (não expira)
    const authHeader = req.headers.get('x-service-key') || '';
    if (authHeader !== SERVICE_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, entity, query, id, data } = body;

    // Usar service role para ter acesso total ao banco
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    if (!db[entity]) {
      return Response.json({ error: `Entity '${entity}' not found` }, { status: 400 });
    }

    let result;

    switch (action) {
      case 'list':
        result = await db[entity].list(query || {});
        break;
      case 'filter':
        result = await db[entity].filter(query || {});
        break;
      case 'create':
        result = await db[entity].create(data);
        break;
      case 'update':
        result = await db[entity].update(id, data);
        break;
      case 'delete':
        result = await db[entity].delete(id);
        break;
      case 'get':
        result = await db[entity].get(id);
        break;
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return Response.json({ success: true, data: result });
  } catch (error) {
    console.error('[dbProxy] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
