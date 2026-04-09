import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import OpenAI from 'npm:openai@4.28.0';

const RECEITANET_CHATBOT_TOKEN = Deno.env.get('RECEITANET_CHATBOT_TOKEN') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const RECEITANET_BASE = 'https://sistema.receitanet.net/api/novo/chatbot';

// Z-API Credentials
const ZAPI_INSTANCE = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

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

  const res = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-token': ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({ phone: numero, message: mensagem }),
  });
  const data = await res.json();
  console.log(`Z-API envio status: ${res.status}`, JSON.stringify(data).substring(0, 200));
  return data;
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

// ── Extrai telefone e mensagem do payload Z-API ────────────────────────────────
function extrairDados(body: Record<string, unknown>): { telefone: string; mensagem: string } {
  // Formato Z-API webhook de mensagem recebida
  // { phone: "5519999999999", text: { message: "oi" }, isGroupMsg: false, ... }
  
  // Ignora mensagens de grupos
  if (body.isGroupMsg === true) {
    return { telefone: '', mensagem: '' };
  }

  // Ignora mensagens enviadas por nós (fromMe)
  if (body.fromMe === true) {
    return { telefone: '', mensagem: '' };
  }

  // Formato Z-API padrão
  const phone = String(body.phone || body.from || '').replace(/\D/g, '');
  
  // Mensagem pode vir em text.message ou message
  let mensagem = '';
  if (body.text && typeof body.text === 'object') {
    mensagem = String((body.text as Record<string, unknown>).message || '');
  } else {
    mensagem = String(body.message || body.content || body.body || '');
  }

  // Também aceita formato Chatwoot legado
  if (!phone && (body.event === 'message_created' || body.event === 'message_updated')) {
    if (body.message_type === 'outgoing' || body.message_type === 'activity') {
      return { telefone: '', mensagem: '' };
    }
    const conversation = body.conversation as Record<string, unknown> || {};
    const meta = conversation.meta as Record<string, unknown> || {};
    const sender = (meta.sender || body.contact || {}) as Record<string, unknown>;
    const phoneChat = String(sender.phone_number || sender.phone || '').replace(/\D/g, '');
    const content = String(body.content || '');
    return { telefone: phoneChat, mensagem: content };
  }

  return { telefone: phone, mensagem };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      return new Response('WhatsApp Webhook PSIU TELECOM - OK (Z-API)', { status: 200 });
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

    // ── Cliente identificado — processar intenção ─────────────────────────────
    await db.ClienteWhatsapp.update(clienteLocal.id, { ultimo_contato: new Date().toISOString() });

    const intencao = await classificarIntencao(mensagemRecebida);
    console.log(`Intenção detectada: ${intencao} para ${telefone}`);

    // ── Fluxo de boleto ───────────────────────────────────────────────────────
    if (intencao === 'boleto') {
      await db.Atendimento.create({
        telefone,
        nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet,
        motivo: 'boleto',
        mensagem_original: mensagemRecebida,
        estado_final: 'em_andamento',
        data_atendimento: new Date().toISOString(),
        resolvido: false,
      });

      const boletos = await buscarBoletos(clienteLocal.id_cliente_receitanet, telefone);
      console.log('Boletos:', JSON.stringify(boletos).substring(0, 500));

      if (boletos.success && boletos.link) {
        await enviarMensagem(telefone, `Aqui está sua *2ª via de boleto/PIX*, *${clienteLocal.nome}*! 📄\n\n🔗 ${boletos.link}\n\n_Vencimento: ${boletos.vencimento || 'conforme boleto'}_\n\nQualquer dúvida, é só chamar! 😊`);
        await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'resolvido', resolvido: true });
      } else if (boletos.boletos && Array.isArray(boletos.boletos) && boletos.boletos.length > 0) {
        const lista = boletos.boletos.slice(0, 3).map((b: Record<string, unknown>, i: number) =>
          `${i + 1}. Venc: ${b.vencimento || 'N/A'} | R$ ${b.valor || 'N/A'}\n🔗 ${b.link || b.url || 'indisponível'}`
        ).join('\n\n');
        await enviarMensagem(telefone, `Encontrei ${boletos.boletos.length} boleto(s) para *${clienteLocal.nome}*:\n\n${lista}\n\nQualquer dúvida, é só chamar! 😊`);
        await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'resolvido', resolvido: true });
      } else {
        await enviarMensagem(telefone, `*${clienteLocal.nome}*, não encontrei boletos em aberto no momento. 🤔\n\nPossível que esteja em dia! Caso precise de mais informações, entre em contato com nossa equipe.`);
        await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'sem_boleto', resolvido: true });
      }
      return Response.json({ ok: true });
    }

    // ── Fluxo de suporte ──────────────────────────────────────────────────────
    if (intencao === 'suporte') {
      await db.Atendimento.create({
        telefone,
        nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet,
        motivo: 'suporte',
        mensagem_original: mensagemRecebida,
        estado_final: 'em_andamento',
        data_atendimento: new Date().toISOString(),
        resolvido: false,
      });

      const chamado = await abrirChamado(clienteLocal.id_cliente_receitanet, telefone);
      console.log('Chamado:', JSON.stringify(chamado).substring(0, 500));

      if (chamado.success) {
        await enviarMensagem(telefone, `Entendido, *${clienteLocal.nome}*! 🛠️ Seu chamado foi aberto com sucesso!\n\n📋 *Protocolo: ${chamado.protocolo || chamado.id || 'gerado'}*\n\nNossa equipe técnica irá verificar e entrará em contato em breve. O prazo de atendimento é de até *4 horas úteis*.\n\nAguarde! 🙏`);
        await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'chamado_aberto', resolvido: true });
      } else {
        await enviarMensagem(telefone, `*${clienteLocal.nome}*, registrei sua solicitação de suporte! 📝\n\nVou encaminhar para nossa equipe técnica. Em breve entraremos em contato.\n\nObrigado pela paciência! 🙏`);
        await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'encaminhado', resolvido: true });
      }
      return Response.json({ ok: true });
    }

    // ── Fluxo de cancelamento ─────────────────────────────────────────────────
    if (intencao === 'cancelamento') {
      await db.Atendimento.create({
        telefone,
        nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet,
        motivo: 'cancelamento',
        mensagem_original: mensagemRecebida,
        estado_final: 'em_andamento',
        data_atendimento: new Date().toISOString(),
        resolvido: false,
      });
      await enviarMensagem(telefone, `*${clienteLocal.nome}*, que pena receber essa notícia! 😢\n\nPara solicitar o cancelamento, preciso encaminhar para nossa equipe comercial.\n\n📞 Entre em contato pelo nosso WhatsApp comercial ou aguarde que um atendente irá te chamar em breve.\n\nObrigado por ter sido nosso cliente! 🙏`);
      await db.Atendimento.update((await db.Atendimento.filter({ telefone, resolvido: false }))[0]?.id, { estado_final: 'encaminhado_cancelamento', resolvido: false });
      return Response.json({ ok: true });
    }

    // ── Menu / saudação ───────────────────────────────────────────────────────
    if (intencao === 'menu') {
      await enviarMensagem(telefone, `Olá, *${clienteLocal.nome}*! 👋\n\nSou o assistente virtual da *PSIU TELECOM*. Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
      return Response.json({ ok: true });
    }

    // ── Resposta padrão ───────────────────────────────────────────────────────
    await enviarMensagem(telefone, `*${clienteLocal.nome}*, não entendi muito bem. 😅\n\nPosso te ajudar com:\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção!`);
    return Response.json({ ok: true });

  } catch (err) {
    console.error('Erro no webhook:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
