import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const RENDER_API_KEY    = Deno.env.get('RENDER_API_KEY') || '';
const RENDER_SERVICE_ID = 'srv-d7bgm3p17lss73aitb30';
const WEBHOOK_URL       = 'https://psiu-webhook.onrender.com';
const UPDATE_SECRET     = 'psiu2024';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Buscar token atual do ambiente Base44 (sempre fresco neste contexto)
    const tokenAtual = Deno.env.get('BASE44_SERVICE_TOKEN') || '';

    if (!tokenAtual) {
      console.error('[RENOVAR] BASE44_SERVICE_TOKEN não encontrado!');
      return Response.json({ error: 'Token não encontrado' }, { status: 500 });
    }

    // Decodificar expiração do token
    let expMinutos = 0;
    try {
      const payload = tokenAtual.split('.')[1];
      const decoded = JSON.parse(atob(payload));
      const exp = decoded.exp || 0;
      expMinutos = Math.round((exp - Date.now() / 1000) / 60);
    } catch {}

    console.log(`[RENOVAR] Token com ${expMinutos} min restantes — atualizando servidor...`);

    // 1. Atualizar token no servidor via /update-token (instantâneo, sem redeploy)
    const resUpdate = await fetch(`${WEBHOOK_URL}/update-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenAtual, secret: UPDATE_SECRET })
    });

    const updateData = await resUpdate.json().catch(() => ({}));
    console.log('[RENOVAR] /update-token response:', resUpdate.status, JSON.stringify(updateData));

    // 2. Atualizar também no Render (para o próximo boot ter o token correto)
    await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        { key: 'BASE44_SERVICE_TOKEN',    value: tokenAtual },
        { key: 'RECEITANET_CHATBOT_TOKEN', value: '4761052b-1c8c-494a-a4a9-ae60b6b15b2d' },
        { key: 'RECEITANET_TOKEN',         value: '4761052b-1c8c-494a-a4a9-ae60b6b15b2d' },
        { key: 'GROQ_API_KEY',             value: Deno.env.get('GROQ_API_KEY') || '' }
      ])
    });

    // 3. Só faz redeploy se o servidor não respondeu ao /update-token
    if (!resUpdate.ok) {
      console.warn('[RENOVAR] /update-token falhou — fazendo redeploy...');
      await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCache: 'do_not_clear' })
      });
      return Response.json({ ok: true, msg: 'Token renovado via redeploy (fallback)', expMinutos });
    }

    return Response.json({ ok: true, msg: 'Token renovado instantaneamente via /update-token', expMinutos });
  } catch (error) {
    console.error('[RENOVAR] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
