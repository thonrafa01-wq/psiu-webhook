import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || '';
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

async function perguntarGroq(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Buscar atendimentos em andamento com mais de 3 horas
    const agora = new Date();
    const tresHorasAtras = new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString();

    const atendimentos = await base44.asServiceRole.entities.Atendimento.filter({
      estado_final__in: ['em_andamento', 'encaminhado_atendente'],
      resolvido: false
    });

    const pendentes = atendimentos.filter((a: any) => a.data_atendimento < tresHorasAtras);

    if (pendentes.length === 0) {
      return Response.json({ ok: true, msg: 'Nenhum atendimento pendente' });
    }

    // Usar Groq para formatar a mensagem
    const listaClientes = pendentes.map((a: any) =>
      `- ${a.nome_cliente || 'Sem nome'} | Tel: ${a.telefone} | Motivo: ${a.motivo || 'não informado'}`
    ).join('\n');

    const prompt = `Você é um assistente de suporte da PSIU Telecom. Crie uma mensagem de alerta curta e profissional para o técnico Rafa informando que os seguintes clientes estão aguardando atendimento há mais de 3 horas. Use emojis. Seja direto. Lista de clientes:\n${listaClientes}`;

    const mensagem = await perguntarGroq(prompt);
    await enviarWhatsApp(RAFA_PHONE, mensagem || `⚠️ *Fila de Retorno PSIU*\n\n${pendentes.length} cliente(s) aguardando há +3h:\n\n${listaClientes}`);

    return Response.json({ ok: true, pendentes: pendentes.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
