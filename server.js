const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RECEITANET_CHATBOT_TOKEN = process.env.RECEITANET_CHATBOT_TOKEN || '';
const RECEITANET_BASE = 'https://sistema.receitanet.net/api/novo/chatbot';
const BASE44_APP_ID = '69d55fd1a341508858f11d46';
const BASE44_SERVICE_TOKEN = process.env.BASE44_SERVICE_TOKEN || '';

const ZAPI_INSTANCE = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

// ── Base44 Entity helpers ─────────────────────────────────────────────────────
const BASE44_API = `https://api.base44.com/api/apps/${BASE44_APP_ID}/entities`;

async function dbFilter(entity, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.append(k, v);
  const res = await fetch(`${BASE44_API}/${entity}?${params.toString()}`, {
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' }
  });
  return await res.json();
}

async function dbCreate(entity, data) {
  const res = await fetch(`${BASE44_API}/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function dbUpdate(entity, id, data) {
  const res = await fetch(`${BASE44_API}/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function buscarClientePorTelefone(phone) {
  const url = `${RECEITANET_BASE}/clientes?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&phone=${phone}`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function buscarClientePorCpf(cpfcnpj) {
  const cpf = cpfcnpj.replace(/\D/g, '');
  const url = `${RECEITANET_BASE}/clientes?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&cpfcnpj=${cpf}`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function buscarBoletos(idCliente, contato) {
  const url = `${RECEITANET_BASE}/boletos?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&idCliente=${idCliente}&contato=${contato}&tipo=whatsapp`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function abrirChamado(idCliente, contato) {
  const url = `${RECEITANET_BASE}/abertura-chamado?token=${RECEITANET_CHATBOT_TOKEN}&app=chatbot&idCliente=${idCliente}&contato=${contato}&ocorrenciatipo=1&motivoos=1`;
  const res = await fetch(url, { method: 'POST' });
  return await res.json();
}

async function enviarMensagem(telefone, mensagem) {
  let numero = telefone.replace(/\D/g, '');
  if (!numero.startsWith('55')) numero = '55' + numero;
  const res = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numero, message: mensagem })
  });
  const data = await res.json();
  console.log('Z-API envio:', JSON.stringify(data).substring(0, 200));
  return data;
}

function classificarIntencao(mensagem) {
  const msg = mensagem.toLowerCase();
  if (msg.match(/boleto|fatura|pagar|pagamento|pix|segunda via/)) return 'boleto';
  if (msg.match(/internet|conexao|conexão|sem sinal|caiu|lento|travando|rompimento|fibra/)) return 'suporte';
  if (msg.match(/cancelar|cancelamento/)) return 'cancelamento';
  if (msg.match(/oi|olá|ola|bom dia|boa tarde|boa noite|menu|ajuda|help|opções|1|2|3/)) return 'menu';
  return 'outro';
}

function extrairDados(body) {
  if (body.isGroupMsg === true) return { telefone: '', mensagem: '' };
  if (body.fromMe === true) return { telefone: '', mensagem: '' };

  const phone = String(body.phone || body.from || '').replace(/\D/g, '');
  let mensagem = '';
  if (body.text && typeof body.text === 'object') {
    mensagem = String(body.text.message || '');
  } else {
    mensagem = String(body.message || body.content || body.body || '');
  }
  return { telefone: phone, mensagem };
}

// ── Webhook principal ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('PSIU TELECOM Webhook - OK'));
app.get('/webhook', (req, res) => res.send('PSIU TELECOM Webhook - OK'));

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook recebido:', JSON.stringify(body).substring(0, 500));

    const { telefone, mensagem: mensagemRecebida } = extrairDados(body);
    if (!telefone || !mensagemRecebida) {
      return res.json({ ok: true, msg: 'sem dados relevantes' });
    }

    // Buscar cliente local no Base44
    const clientesLocal = await dbFilter('ClienteWhatsapp', { telefone });
    let clienteLocal = Array.isArray(clientesLocal) && clientesLocal.length > 0 ? clientesLocal[0] : null;

    // ── Cliente não identificado ──────────────────────────────────────────────
    if (!clienteLocal || !clienteLocal.identificado) {
      const resultadoBusca = await buscarClientePorTelefone(telefone);

      if (resultadoBusca.success && resultadoBusca.id) {
        const dadosCliente = {
          telefone, id_cliente_receitanet: String(resultadoBusca.id),
          nome: resultadoBusca.nome || '', cpf_cnpj: resultadoBusca.cpfcnpj || '',
          identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'menu'
        };
        if (clienteLocal) { await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente); clienteLocal = { ...clienteLocal, ...dadosCliente }; }
        else { clienteLocal = await dbCreate('ClienteWhatsapp', dadosCliente); }
        await dbCreate('Atendimento', { telefone, nome_cliente: resultadoBusca.nome || '', id_cliente_receitanet: String(resultadoBusca.id), motivo: 'menu', mensagem_original: mensagemRecebida, estado_final: 'em_andamento', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `Olá, *${resultadoBusca.nome}*! 👋\n\nSou o assistente virtual da *PSIU TELECOM*. Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
        return res.json({ ok: true });
      }

      if (clienteLocal?.estado_conversa === 'aguardando_cpf') {
        const resultadoCpf = await buscarClientePorCpf(mensagemRecebida);
        if (resultadoCpf.success && resultadoCpf.id) {
          const dadosCliente = { telefone, id_cliente_receitanet: String(resultadoCpf.id), nome: resultadoCpf.nome || '', cpf_cnpj: resultadoCpf.cpfcnpj || '', identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'menu' };
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
          await enviarMensagem(telefone, `Ótimo, *${resultadoCpf.nome}*! ✅\n\nComo posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente`);
          return res.json({ ok: true });
        } else {
          await enviarMensagem(telefone, `Não consegui localizar seu cadastro. 😕\n\nTente novamente com seu CPF ou CNPJ, ou digite *0* para falar com um atendente.`);
          return res.json({ ok: true });
        }
      }

      // Não encontrou por telefone — pedir CPF
      if (!clienteLocal) { await dbCreate('ClienteWhatsapp', { telefone, identificado: false, ultimo_contato: new Date().toISOString(), estado_conversa: 'aguardando_cpf' }); }
      else { await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_cpf', ultimo_contato: new Date().toISOString() }); }
      await enviarMensagem(telefone, `Olá! 👋 Sou o assistente virtual da *PSIU TELECOM*.\n\nNão encontrei seu cadastro pelo número. Por favor, informe seu *CPF ou CNPJ* para continuar.`);
      return res.json({ ok: true });
    }

    // ── Cliente identificado — processar intenção ─────────────────────────────
    await dbUpdate('ClienteWhatsapp', clienteLocal.id, { ultimo_contato: new Date().toISOString() });
    const intencao = classificarIntencao(mensagemRecebida);
    const idCliente = clienteLocal.id_cliente_receitanet;
    const nome = clienteLocal.nome || 'Cliente';

    if (mensagemRecebida.trim() === '1' || intencao === 'boleto' || clienteLocal.estado_conversa === 'aguardando_boleto') {
      const boletos = await buscarBoletos(idCliente, telefone);
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'boleto', mensagem_original: mensagemRecebida, estado_final: 'resolvido', data_atendimento: new Date().toISOString(), resolvido: true });
      if (boletos.success && boletos.boletos && boletos.boletos.length > 0) {
        let msg = `📄 *${nome}*, aqui estão seus boletos em aberto:\n\n`;
        for (const b of boletos.boletos.slice(0, 3)) {
          msg += `📅 Vencimento: *${b.vencimento}*\n💰 Valor: *R$ ${b.valor}*\n`;
          if (b.link) msg += `🔗 ${b.link}\n`;
          if (b.pix) msg += `📱 PIX: ${b.pix}\n`;
          msg += '\n';
        }
        await enviarMensagem(telefone, msg);
      } else {
        await enviarMensagem(telefone, `✅ *${nome}*, não encontrei boletos em aberto! Sua conta está em dia. 🎉`);
      }
      return res.json({ ok: true });
    }

    if (mensagemRecebida.trim() === '2' || intencao === 'suporte') {
      const chamado = await abrirChamado(idCliente, telefone);
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
      if (chamado.success) {
        await enviarMensagem(telefone, `🔧 *${nome}*, chamado de suporte aberto com sucesso!\n\n📋 Número: *${chamado.numero || chamado.id || 'gerado'}*\n\nNossa equipe técnica foi notificada e entrará em contato em breve. ⏱️`);
      } else {
        await enviarMensagem(telefone, `🔧 Vou acionar nossa equipe técnica para você, *${nome}*!\n\nUm técnico entrará em contato em breve. Se preferir falar agora, ligue: *0800-xxx-xxxx*`);
      }
      return res.json({ ok: true });
    }

    if (mensagemRecebida.trim() === '3' || intencao === 'cancelamento') {
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'atendente' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: intencao === 'cancelamento' ? 'cancelamento' : 'atendente', mensagem_original: mensagemRecebida, estado_final: 'encaminhado_atendente', data_atendimento: new Date().toISOString(), resolvido: false });
      await enviarMensagem(telefone, `👤 *${nome}*, vou te transferir para um atendente humano.\n\nNosso horário de atendimento é *seg-sex das 8h às 18h*.\n\nAguarde, alguém entrará em contato em breve! 🙏`);
      return res.json({ ok: true });
    }

    // Menu padrão
    await enviarMensagem(telefone, `Olá, *${nome}*! 😊 Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção.`);
    return res.json({ ok: true });

  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
