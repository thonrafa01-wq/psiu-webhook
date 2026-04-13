import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RENDER_API_KEY = Deno.env.get('RENDER_API_KEY') || '';
const RENDER_SERVICE_ID = 'srv-d7bgm3p17lss73aitb30';
const ZAPI_INSTANCE = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const RAFA_PHONE = '5519999619605';

async function enviarWhatsApp(phone: string, message: string) {
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone, message })
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Buscar token atual do ambiente Base44
    const tokenAtual = Deno.env.get('BASE44_SERVICE_TOKEN') || '';

    if (!tokenAtual) {
      await enviarWhatsApp(RAFA_PHONE, '⚠️ PSIU: BASE44_SERVICE_TOKEN não encontrado no ambiente!');
      return Response.json({ error: 'Token não encontrado' }, { status: 500 });
    }

    // Atualizar variável de ambiente no Render
    const resEnv = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ key: 'BASE44_SERVICE_TOKEN', value: tokenAtual }])
    });

    const envData = await resEnv.json();

    if (!resEnv.ok) {
      await enviarWhatsApp(RAFA_PHONE, `⚠️ PSIU: Erro ao renovar token no Render: ${JSON.stringify(envData)}`);
      return Response.json({ error: 'Falha ao atualizar env no Render' }, { status: 500 });
    }

    // Trigger redeploy
    await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ clearCache: 'do_not_clear' })
    });

    return Response.json({ ok: true, msg: 'Token renovado e redeploy iniciado' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
