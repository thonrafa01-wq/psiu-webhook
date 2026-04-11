import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || '';

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { mensagem, sala_id, autor_nome, agentes, historico } = await req.json();

    if (!mensagem || !sala_id) {
      return Response.json({ error: 'mensagem e sala_id obrigatórios' }, { status: 400, headers: corsHeaders });
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    // Detectar quais agentes foram mencionados
    const msgLower = mensagem.toLowerCase();
    const agentesParaResponder = (agentes || []).filter((ag: any) => {
      const trigger = (ag.trigger || '').toLowerCase();
      const nomeTag = '@' + ag.nome.toLowerCase();
      return msgLower.includes(trigger) || msgLower.includes(nomeTag);
    });

    // Se nenhum agente mencionado explicitamente, verificar se algum deve responder por contexto
    // (ex: pergunta geral na sala que tem apenas 1 agente)
    const respostas = [];

    for (const agente of agentesParaResponder) {
      try {
        // Montar histórico para contexto
        const contexto = (historico || []).slice(-10).map((m: any) => ({
          role: m.autor_tipo === 'agente' ? 'assistant' : 'user',
          content: `${m.autor_nome}: ${m.conteudo}`
        }));

        const systemPrompt = `${agente.instrucoes}

Você está em uma sala de reunião/chat chamada "${sala_id}".
Responda de forma concisa (máximo 4 parágrafos).
Não use markdown excessivo. Seja natural e conversacional.
Não se apresente toda vez — só responda o que foi pedido.`;

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              ...contexto,
              { role: 'user', content: `${autor_nome}: ${mensagem}` }
            ],
            temperature: 0.7,
            max_tokens: 500
          })
        });

        if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
        const data = await res.json();
        const resposta = data.choices?.[0]?.message?.content?.trim();

        if (resposta) {
          // Salvar resposta do agente no banco
          await db.Mensagem.create({
            sala_id,
            autor_nome: agente.nome,
            autor_tipo: 'agente',
            conteudo: resposta,
            tipo: 'texto',
            lida: false
          });

          respostas.push({ agente: agente.nome, resposta });
        }
      } catch (e) {
        console.error(`[AGENTE ${agente.nome}] Erro:`, e.message);
      }
    }

    return Response.json({ ok: true, respostas }, { headers: corsHeaders });
  } catch (error) {
    console.error('[agentReply] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
