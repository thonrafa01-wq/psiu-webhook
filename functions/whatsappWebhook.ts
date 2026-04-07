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

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      return new Response('WhatsApp Webhook PSIU TELECOM - OK', { status: 200 });
    }

    let body: Record<string, string> = {};
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

    console.log('Webhook body recebido:', JSON.stringify(body));

    const telefone = (body.numero || body.phone || body.from || body.sender || '').replace(/\D/g, '');
    const mensagemRecebida = body.mensagem || body.message || body.text || body.body || '';

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
        // Registrar atendimento inicial
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

    // Registrar atendimento
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
      try {
        const resultadoBoleto = await buscarBoletos(idCliente, telefone);
        if (resultadoBoleto.success) {
          atendimentoData.estado_final = 'resolvido_auto';
          atendimentoData.resolvido = true;
          await db.Atendimento.create(atendimentoData);
          await enviarMensagem(telefone, `✅ Boleto enviado para seu WhatsApp, *${nomeCliente}*!\n\nCaso não receba em alguns instantes, entre em contato com nossa equipe.`);
        } else {
          atendimentoData.estado_final = 'resolvido_auto';
          atendimentoData.resolvido = true;
          await db.Atendimento.create(atendimentoData);
          await enviarMensagem(telefone, `*${nomeCliente}*, não encontrei faturas em aberto para sua conta. 🎉\n\nSe você acredita que há um erro, posso conectar você com nossa equipe. Digite *3* para falar com um atendente.`);
        }
      } catch (_e) {
        atendimentoData.estado_final = 'em_andamento';
        await db.Atendimento.create(atendimentoData);
        await enviarMensagem(telefone, `Desculpe, ocorreu um erro ao buscar seu boleto. Tente novamente ou digite *3* para falar com um atendente.`);
      }

    } else if (opcao === '2' || intencao === 'suporte') {
      try {
        const chamados = await listarChamados(idCliente);
        if (chamados.success && chamados.data && chamados.data.length > 0) {
          atendimentoData.estado_final = 'resolvido_auto';
          atendimentoData.resolvido = true;
          await db.Atendimento.create(atendimentoData);
          await enviarMensagem(telefone, `*${nomeCliente}*, você já possui um chamado em aberto (#${chamados.data[0].id}). 🔧\n\nNossa equipe já está trabalhando no seu caso!\n\nSe for urgente, digite *3* para falar com um atendente.`);
        } else {
          const resultadoChamado = await abrirChamado(idCliente, telefone);
          if (resultadoChamado.success) {
            atendimentoData.estado_final = 'resolvido_auto';
            atendimentoData.resolvido = true;
            await db.Atendimento.create(atendimentoData);
            await enviarMensagem(telefone, `✅ Chamado aberto com sucesso, *${nomeCliente}*!\n\n📋 *Protocolo: #${resultadoChamado.id || resultadoChamado.chamado || 'gerado'}*\n\nNossa equipe técnica irá analisar em breve. Horário: Seg-Sex 8h-18h, Sáb 8h-12h.`);
          } else {
            atendimentoData.estado_final = 'transferido_humano';
            await db.Atendimento.create(atendimentoData);
            await enviarMensagem(telefone, `Não foi possível abrir o chamado automaticamente. 😕\n\nDigite *3* para falar diretamente com nossa equipe técnica.`);
          }
        }
      } catch (_e) {
        atendimentoData.estado_final = 'em_andamento';
        await db.Atendimento.create(atendimentoData);
        await enviarMensagem(telefone, `Ocorreu um erro ao processar seu chamado. Digite *3* para falar com um atendente.`);
      }

    } else if (opcao === '3' || intencao === 'cancelamento') {
      atendimentoData.estado_final = 'transferido_humano';
      await db.Atendimento.create(atendimentoData);
      await db.ClienteWhatsapp.update(clienteLocal.id, { estado_conversa: 'aguardando_humano' });
      await enviarMensagem(telefone, `Entendido, *${nomeCliente}*! 👨‍💻\n\nTransferindo você para um de nossos atendentes. Em instantes alguém irá te atender.\n\n⏰ Horário: Seg-Sex 8h-18h, Sáb 8h-12h\n\nObrigado pela paciência!`);

    } else if (intencao === 'menu') {
      atendimentoData.estado_final = 'em_andamento';
      await db.Atendimento.create(atendimentoData);
      await enviarMensagem(telefone, `Olá, *${nomeCliente}*! 👋 Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);

    } else {
      atendimentoData.estado_final = 'em_andamento';
      await db.Atendimento.create(atendimentoData);
      await enviarMensagem(telefone, `*${nomeCliente}*, não entendi muito bem. 😅\n\nPosso te ajudar com:\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção.`);
    }

    return Response.json({ ok: true });

  } catch (error) {
    console.error('Erro no webhook:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
