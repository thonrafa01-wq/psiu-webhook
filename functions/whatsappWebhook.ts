import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import OpenAI from 'npm:openai@4.28.0';

const RECEITANET_CHATBOT_TOKEN = Deno.env.get('RECEITANET_CHATBOT_TOKEN') || '';
const SMSNET_USER = Deno.env.get('SMSNET_USER') || '';
const SMSNET_PASS = Deno.env.get('SMSNET_PASS') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const RECEITANET_BASE = 'https://sistema.receitanet.net/api/novo/chatbot';

async function buscarClientePorTelefone(phone: string) {
  const url = `${RECEITANET_BASE}/clientes?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&phone=${phone}`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function buscarClientePorCpf(cpfcnpj: string) {
  const cpf = cpfcnpj.replace(/\D/g, '');
  const url = `${RECEITANET_BASE}/clientes?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&cpfcnpj=${cpf}`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function buscarBoletos(idCliente: string, contato: string) {
  const url = `${RECEITANET_BASE}/boletos?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&idCliente=${idCliente}&contato=${contato}&tipo=whatsapp`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function abrirChamado(idCliente: string, contato: string) {
  const url = `${RECEITANET_BASE}/abertura-chamado?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&idCliente=${idCliente}&contato=${contato}&ocorrenciatipo=1&motivoos=1`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function listarChamados(idCliente: string) {
  const url = `${RECEITANET_BASE}/chamados?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&idCliente=${idCliente}`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function enviarMensagem(telefone: string, mensagem: string) {
  let numero = telefone.replace(/\D/g, '');
  if (!numero.startsWith('55')) numero = '55' + numero;
  const username = SMSNET_USER.includes('-') ? SMSNET_USER : `${SMSNET_USER}-6`;
  const params = new URLSearchParams({ username, password: SMSNET_PASS, to: numero, msg: mensagem });
  const res = await fetch(`https://sistema.smsnet.com.br/sms/global?${params.toString()}`);
  const text = await res.text();
  console.log(`SMSNet status: ${res.status} | resposta:`, text.substring(0, 200));
  return text;
}

async function classificarIntencao(mensagem: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    const msg = mensagem.toLowerCase();
    if (msg.match(/boleto|fatura|pagar|pagamento|pix|segunda via/)) return 'boleto';
    if (msg.match(/internet|conexao|conexão|sem sinal|caiu|lento|travando|rompimento|fibra/)) return 'suporte';
    if (msg.match(/cancelar|cancelamento/)) return 'cancelamento';
    if (msg.match(/oi|olá|ola|bom dia|boa tarde|boa noite|menu|ajuda|help|opções/)) return 'menu';
    return 'outro';
  }
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você classifica mensagens de clientes de uma provedora de internet (ISP). 
Retorne APENAS uma das seguintes categorias, sem explicação:
- boleto: cliente quer segunda via de boleto, PIX, fatura
- suporte: cliente sem internet, conexão lenta, rompimento de fibra, sem sinal
- cancelamento: cliente quer cancelar o serviço
- menu: saudação, oi, bom dia, quero ajuda, menu
- outro: qualquer outra coisa`
      },
      { role: 'user', content: mensagem }
    ],
    max_tokens: 10,
  });
  return resp.choices[0].message.content?.trim().toLowerCase() || 'outro';
}

// ── Extrai telefone e mensagem do payload (Chatwoot ou formato simples) ────────
function extrairDados(body: Record<string, unknown>): { telefone: string; mensagem: string } {
  // Formato Chatwoot: { event: "message_created", message_type: "incoming", ... }
  if (body.event === 'message_created' || body.event === 'message_updated') {
    // Ignora mensagens enviadas pelo agente/bot (type outgoing)
    if (body.message_type === 'outgoing' || body.message_type === 'activity') {
      return { telefone: '', mensagem: '' };
    }
    // Telefone vem em conversation.meta.sender.phone_number ou contact.phone_number
    const conversation = body.conversation as Record<string, unknown> || {};
    const meta = conversation.meta as Record<string, unknown> || {};
    const sender = (meta.sender || body.contact || {}) as Record<string, unknown>;
    const phone = String(sender.phone_number || sender.phone || '').replace(/\D/g, '');
    const content = String(body.content || '');
    return { telefone: phone, mensagem: content };
  }

  // Formato simples (form-urlencoded do SMSNet webhook direto)
  const telefone = String(
    body.number || body.numero || body.phone || body.from || body.sender || ''
  ).replace(/\D/g, '');
  const mensagem = String(
    body.content || body.mensagem || body.message || body.text || body.body || ''
  );
  return { telefone, mensagem };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      return new Response('WhatsApp Webhook PSIU TELECOM - OK', { status: 200 });
    }

    let body: Record<string, unknown> = {};
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await req.formData().catch(() => null);
      if (formData) for (const [k, v] of formData.entries()) body[k] = v.toString();
    } else {
      const text = await req.text().catch(() => '');
      try { body = JSON.parse(text); } catch {
        const params = new URLSearchParams(text);
        for (const [k, v] of params.entries()) body[k] = v;
      }
    }

    console.log('Webhook body recebido:', JSON.stringify(body).substring(0, 500));

    const { telefone, mensagem: mensagemRecebida } = extrairDados(body);

    if (!telefone || !mensagemRecebida) {
      return Response.json({ ok: true, msg: 'sem dados relevantes' });
    }

    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    const clientesLocal = await db.ClienteWhatsapp.filter({ telefone });
    let clienteLocal = clientesLocal.length > 0 ? clientesLocal[0] : null;

    // ── Cliente não identificado ──────────────────────────────────────────────
    if (!clienteLocal || !clienteLocal.identificado) {
      const resultadoBusca = await buscarClientePorTelefone(telefone);

      if (resultadoBusca.success && resultadoBusca.id) {
        const dadosCliente = {
          telefone,
          id_cliente_receitanet: String(resultadoBusca.id),
          nome: resultadoBusca.nome || '',
          cpf_cnpj: resultadoBusca.cpfcnpj || '',
          identificado: true,
          ultimo_contato: new Date().toISOString(),
          estado_conversa: 'identificado',
        };
        if (clienteLocal) {
          await db.ClienteWhatsapp.update(clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
        } else {
          clienteLocal = await db.ClienteWhatsapp.create(dadosCliente);
        }
        await db.Atendimento.create({
          telefone,
          nome_cliente: resultadoBusca.nome || '',
          id_cliente_receitanet: String(resultadoBusca.id),
          motivo: 'menu',
          mensagem_original: mensagemRecebida,
          estado_final: 'em_andamento',
          data_atendimento: new Date().toISOString(),
          resolvido: false,
        });
        await enviarMensagem(telefone, `Olá, *${resultadoBusca.nome}*! 👋\n\nSou o assistente virtual da *PSIU TELECOM*. Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
        return Response.json({ ok: true });
      }

      if (clienteLocal?.estado_conversa === 'aguardando_cpf') {
        const resultadoCpf = await buscarClientePorCpf(mensagemRecebida);
        if (resultadoCpf.success && resultadoCpf.id) {
          const dadosCliente = {
            telefone,
            id_cliente_receitanet: String(resultadoCpf.id),
            nome: resultadoCpf.nome || '',
            cpf_cnpj: resultadoCpf.cpfcnpj || '',
            identificado: true,
            ultimo_contato: new Date().toISOString(),
            estado_conversa: 'identificado',
          };
          await db.ClienteWhatsapp.update(clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
          await db.Atendimento.create({
            telefone,
            nome_cliente: resultadoCpf.nome || '',
            id_cliente_receitanet: String(resultadoCpf.id),
            motivo: 'menu',
            mensagem_original: mensagemRecebida,
            estado_final: 'em_andamento',
            data_atendimento: new Date().toISOString(),
            resolvido: false,
          });
          await enviarMensagem(telefone, `Ótimo, *${resultadoCpf.nome}*! ✅ Cadastro localizado!\n\nComo posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente`);
          return Response.json({ ok: true });
        } else {
          await enviarMensagem(telefone, `Não consegui localizar seu cadastro com esse CPF/CNPJ. 😕\n\nPode verificar e tentar novamente? Digite apenas os números.`);
          return Response.json({ ok: true });
        }
      }

      clienteLocal = await db.ClienteWhatsapp.create({
        telefone,
        identificado: false,
        ultimo_contato: new Date().toISOString(),
        estado_conversa: 'aguardando_cpf',
      });
      await enviarMensagem(telefone, `Olá! 👋 Sou o assistente virtual da *PSIU TELECOM*.\n\nPara te atender melhor, preciso verificar seu cadastro. Por favor, informe seu *CPF ou CNPJ* (apenas números):`);
      return Response.json({ ok: true });
    }

    // ── Cliente identificado ─────────────────────────────────────────────────
    const idCliente = clienteLocal.id_cliente_receitanet;
    const nomeCliente = clienteLocal.nome || 'cliente';

    await db.ClienteWhatsapp.update(clienteLocal.id, { ultimo_contato: new Date().toISOString() });

    // Cliente em atendimento humano — não responder
    if (clienteLocal.estado_conversa === 'aguardando_humano') {
      console.log(`Cliente ${nomeCliente} está com atendente humano`);
      return Response.json({ ok: true, msg: 'cliente com atendente humano' });
    }

    const intencao = await classificarIntencao(mensagemRecebida);
    console.log(`Intenção: ${intencao} | mensagem: "${mensagemRecebida}"`);

    const opcao = mensagemRecebida.trim();

    const atendimentoData: Record<string, unknown> = {
      telefone,
      nome_cliente: nomeCliente,
      id_cliente_receitanet: idCliente,
      motivo: intencao,
      mensagem_original: mensagemRecebida,
      data_atendimento: new Date().toISOString(),
      resolvido: false,
    };

    if (opcao === '1' || intencao === 'boleto') {
      atendimentoData.estado_final = 'boleto_solicitado';
      await db.Atendimento.create({ ...atendimentoData, resolvido: true });
      const boletos = await buscarBoletos(idCliente, telefone);
      if (boletos.success && boletos.boletos?.length > 0) {
        const b = boletos.boletos[0];
        const venc = b.vencimento ? ` | Vence: ${b.vencimento}` : '';
        const val = b.valor ? ` | Valor: R$ ${b.valor}` : '';
        let msg = `💰 *Segunda via de boleto*\n\n${venc}${val}\n\n`;
        if (b.pix) msg += `*PIX Copia e Cola:*\n\`${b.pix}\`\n\n`;
        if (b.url) msg += `*Link do boleto:*\n${b.url}\n\n`;
        msg += `Qualquer dúvida, estou aqui! 😊`;
        await enviarMensagem(telefone, msg);
      } else {
        await enviarMensagem(telefone, `Não encontrei boletos em aberto para sua conta no momento. 😊\n\nSe precisar de mais alguma coisa, é só me falar!`);
      }
      return Response.json({ ok: true });
    }

    if (opcao === '2' || intencao === 'suporte') {
      atendimentoData.estado_final = 'chamado_aberto';
      const chamados = await listarChamados(idCliente);
      const chamadoAberto = chamados.success && chamados.chamados?.find((c: Record<string, unknown>) => c.status !== 'Fechado' && c.status !== 'Resolvido');
      if (chamadoAberto) {
        await db.Atendimento.create({ ...atendimentoData, resolvido: true });
        await enviarMensagem(telefone, `🔍 Já existe um chamado aberto para você:\n\n*Chamado #${chamadoAberto.id}*\n📋 ${chamadoAberto.descricao || 'Suporte técnico'}\n📌 Status: ${chamadoAberto.status}\n\nNossa equipe já está cuidando! Qualquer novidade te avisamos aqui. 💪`);
      } else {
        const resultado = await abrirChamado(idCliente, telefone);
        await db.Atendimento.create({ ...atendimentoData, resolvido: resultado.success });
        if (resultado.success) {
          await enviarMensagem(telefone, `✅ *Chamado de suporte aberto com sucesso!*\n\n📋 Protocolo: #${resultado.id || 'gerado'}\n\nNossa equipe técnica já foi notificada e entrará em contato em breve. ⏱️\n\nQualquer dúvida, estou aqui!`);
        } else {
          await enviarMensagem(telefone, `Não consegui abrir o chamado automaticamente. 😕\n\nVou transferir para um atendente humano agora.\n\nAguarde um momento... 🙏`);
          await db.ClienteWhatsapp.update(clienteLocal.id, { estado_conversa: 'aguardando_humano' });
        }
      }
      return Response.json({ ok: true });
    }

    if (opcao === '3' || intencao === 'cancelamento' || mensagemRecebida.toLowerCase().includes('atendente') || mensagemRecebida.toLowerCase().includes('humano')) {
      atendimentoData.estado_final = 'transferido_humano';
      await db.Atendimento.create({ ...atendimentoData, resolvido: false });
      await db.ClienteWhatsapp.update(clienteLocal.id, { estado_conversa: 'aguardando_humano' });
      await enviarMensagem(telefone, `👨‍💼 Transferindo para um atendente humano...\n\nEm breve alguém da nossa equipe entrará em contato. Horário de atendimento: *seg a sex, 8h às 18h*.\n\nSe for urgente fora do horário, aguarde o próximo dia útil. 🙏`);
      return Response.json({ ok: true });
    }

    // Resposta genérica — mostra o menu novamente
    await enviarMensagem(telefone, `Olá, *${nomeCliente}*! 😊 Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
    return Response.json({ ok: true });

  } catch (err) {
    console.error('Erro no webhook:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
