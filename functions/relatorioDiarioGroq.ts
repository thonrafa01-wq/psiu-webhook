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
      max_tokens: 600
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const agora = new Date();
    const ontemISO = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Buscar todos atendimentos das últimas 24h
    const todos = await base44.asServiceRole.entities.Atendimento.filter({});
    const ultimas24h = todos.filter((a: any) => a.data_atendimento >= ontemISO);

    // Calcular métricas
    const total = ultimas24h.length;
    const resolvidos = ultimas24h.filter((a: any) => a.resolvido === true).length;
    const boletos = ultimas24h.filter((a: any) => (a.motivo || '').toLowerCase().includes('financ') || (a.motivo || '').toLowerCase().includes('boleto')).length;
    const chamados = ultimas24h.filter((a: any) => (a.motivo || '').toLowerCase().includes('suporte') || (a.motivo || '').toLowerCase().includes('tecnico')).length;
    const cancelamentos = ultimas24h.filter((a: any) => (a.motivo || '').toLowerCase().includes('cancel')).length;
    const taxaResolucao = total > 0 ? Math.round((resolvidos / total) * 100) : 0;

    const data = agora.toLocaleDateString('pt-BR');

    const prompt = `Você é um assistente da PSIU Telecom. Crie um relatório diário resumido e profissional com emojis para o dono Rafa com estas métricas do dia ${data}:
- Total de atendimentos: ${total}
- Boletos/Financeiro: ${boletos}
- Chamados técnicos: ${chamados}
- Cancelamentos: ${cancelamentos}
- Resolvidos: ${resolvidos}
- Taxa de resolução: ${taxaResolucao}%
Seja direto, use emojis, máximo 15 linhas.`;

    const mensagem = await perguntarGroq(prompt);
    const fallback = `📊 *Relatório Diário PSIU - ${data}*\n\n📞 Total: ${total}\n💰 Financeiro: ${boletos}\n🔧 Técnico: ${chamados}\n❌ Cancelamentos: ${cancelamentos}\n✅ Resolvidos: ${resolvidos} (${taxaResolucao}%)`;

    await enviarWhatsApp(RAFA_PHONE, mensagem || fallback);

    return Response.json({ ok: true, total, resolvidos, taxaResolucao });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
