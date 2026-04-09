const express = require('express');
const app = express();
app.use(express.json());

// Configurações
const RECEITANET_CHATBOT_TOKEN = process.env.RECEITANET_CHATBOT_TOKEN || '';
const RECEITANET_BASE = 'https://sistema.receitanet.net/api/novo/chatbot';

const ZAPI_INSTANCE = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

const BASE44_APP_ID = '69d55fd1a341508858f11d46';
const BASE44_SERVICE_TOKEN = process.env.BASE44_SERVICE_TOKEN || '';
const BASE44_API = `https://api.base44.com/api/apps/${BASE44_APP_ID}`;

// ── Funções Base44 Entities ────────────────────────────────────────────────────
async function dbFilter(entity, query) {
  const params = new URLSearchParams(query).toString();
  const res = await fetch(`${BASE44_API}/entities/${entity}?${params}`, {
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' }
  });
  return await res.json();
}

async function dbCreate(entity, data) {
  const res = await fetch(`${BASE44_API}/entities/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function dbUpdate(entity, id, data) {
  const res = await fetch(`${BASE44_API}/entities/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

// ── Receitanet ─────────────────────────────────────────────────────────────────
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

// ── Z-API ──────────────────────────────────────────────────────────────────────
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

// ── Classificação de intenção ──────────────────────────────────────────────────
function classificarIntencao(mensagem) {
  const msg = mensagem.toLowerCase();
  if (msg.match(/boleto|fatura|pagar|pagamento|pix|segunda via/)) return 'boleto';
  if (msg.match(/internet|conexao|conexão|sem sinal|caiu|lento|travando|rompimento|fibra/)) return 'suporte';
  if (msg.match(/cancelar|cancelamento/)) return 'cancelamento';
  if (msg.match(/^[1]$|boleto/)) return 'boleto';
  if (msg.match(/^[2]$|suporte/)) return 'suporte';
  if (msg.match(/^[3]$|atendente|humano/)) return 'atendente';
  if (msg.match(/oi|olá|ola|bom dia|boa tarde|boa noite|menu|ajuda|help|opções/)) return 'menu';
  return 'outro';
}

// ── Extrair dados do payload Z-API ─────────────────────────────────────────────
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

// ── Webhook principal ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('WhatsApp Webhook PSIU TELECOM - OK'));

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook recebido:', JSON.stringify(body).substring(0, 500));

    const { telefone, mensagem: mensagemRecebida } = extrairDados(body);
    if (!telefone || !mensagemRecebida) {
      return res.json({ ok: true, msg: 'sem dados relevantes' });
    }

    // Buscar cliente no Base44
    const clientesResult = await dbFilter('ClienteWhatsapp', { telefone });
    let clienteLocal = Array.isArray(clientesResult) && clientesResult.length > 0 ? clientesResult[0] : null;

    // ── Cliente não identificado ──
    if (!clienteLocal || !clienteLocal.identificado) {
      const resultadoBusca = await buscarClientePorTelefone(telefone);

      if (resultadoBusca.success && resultadoBusca.id) {
        const dadosCliente = {
          telefone, id_cliente_receitanet: String(resultadoBusca.id),
          nome: resultadoBusca.nome || '', cpf_cnpj: resultadoBusca.cpfcnpj || '',
          identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'identificado',
        };
        if (clienteLocal) {
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
        } else {
          clienteLocal = await dbCreate('ClienteWhatsapp', dadosCliente);
        }
        await dbCreate('Atendimento', {
          telefone, nome_cliente: resultadoBusca.nome || '',
          id_cliente_receitanet: String(resultadoBusca.id), motivo: 'menu',
          mensagem_original: mensagemRecebida, estado_final: 'em_andamento',
          data_atendimento: new Date().toISOString(), resolvido: false,
        });
        await enviarMensagem(telefone, `Olá, *${resultadoBusca.nome}*! 👋\n\nSou o assistente virtual da *PSIU TELECOM*. Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
        return res.json({ ok: true });
      }

      if (clienteLocal?.estado_conversa === 'aguardando_cpf') {
        const resultadoCpf = await buscarClientePorCpf(mensagemRecebida);
        if (resultadoCpf.success && resultadoCpf.id) {
          const dadosCliente = {
            telefone, id_cliente_receitanet: String(resultadoCpf.id),
            nome: resultadoCpf.nome || '', cpf_cnpj: resultadoCpf.cpfcnpj || '',
            identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'identificado',
          };
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
          await enviarMensagem(telefone, `Ótimo, *${resultadoCpf.nome}*! ✅ Cadastro localizado!\n\nComo posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente`);
          return res.json({ ok: true });
        } else {
          await enviarMensagem(telefone, `Não consegui localizar seu cadastro com esse CPF/CNPJ. 😕\n\nPode verificar e tentar novamente?\n\nDigite seu *CPF ou CNPJ* (só os números):`);
          return res.json({ ok: true });
        }
      }

      // Não achou por telefone, pedir CPF
      if (!clienteLocal) {
        await dbCreate('ClienteWhatsapp', {
          telefone, identificado: false,
          ultimo_contato: new Date().toISOString(), estado_conversa: 'aguardando_cpf',
        });
      } else {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_cpf', ultimo_contato: new Date().toISOString() });
      }
      await enviarMensagem(telefone, `Olá! 👋 Seja bem-vindo à *PSIU TELECOM*!\n\nPara te ajudar, preciso te identificar. Digite seu *CPF ou CNPJ* (só os números):`);
      return res.json({ ok: true });
    }

    // ── Cliente identificado ──
    await dbUpdate('ClienteWhatsapp', clienteLocal.id, { ultimo_contato: new Date().toISOString() });
    const intencao = classificarIntencao(mensagemRecebida);

    if (intencao === 'boleto') {
      const boletos = await buscarBoletos(clienteLocal.id_cliente_receitanet, telefone);
      if (boletos.success && boletos.boletos && boletos.boletos.length > 0) {
        let msg = `📄 *Segunda via de boleto* - ${clienteLocal.nome}\n\n`;
        for (const b of boletos.boletos.slice(0, 3)) {
          msg += `*Vencimento:* ${b.vencimento || 'N/A'}\n*Valor:* R$ ${b.valor || 'N/A'}\n`;
          if (b.link_boleto) msg += `*Boleto:* ${b.link_boleto}\n`;
          if (b.pix) msg += `*PIX:* ${b.pix}\n`;
          msg += '\n';
        }
        await enviarMensagem(telefone, msg);
      } else {
        await enviarMensagem(telefone, `✅ *${clienteLocal.nome}*, não encontrei boletos em aberto no momento!\n\nSe precisar de mais alguma coisa, é só falar. 😊`);
      }
      await dbCreate('Atendimento', {
        telefone, nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet || '',
        motivo: 'boleto', mensagem_original: mensagemRecebida,
        estado_final: 'resolvido', data_atendimento: new Date().toISOString(), resolvido: true,
      });
    } else if (intencao === 'suporte') {
      const chamado = await abrirChamado(clienteLocal.id_cliente_receitanet, telefone);
      if (chamado.success) {
        await enviarMensagem(telefone, `🔧 *Chamado aberto com sucesso*, ${clienteLocal.nome}!\n\n*Protocolo:* ${chamado.protocolo || chamado.id || 'N/A'}\n\nNossa equipe técnica já foi notificada e entrará em contato em breve. O prazo médio é de *2 horas*.\n\nQualquer dúvida, é só falar! 😊`);
      } else {
        await enviarMensagem(telefone, `🔧 Olá, *${clienteLocal.nome}*! Registrei sua solicitação de suporte.\n\nNossa equipe técnica será notificada e entrará em contato em breve.\n\nSe a situação for urgente, ligue: *📞 (XX) XXXX-XXXX*`);
      }
      await dbCreate('Atendimento', {
        telefone, nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet || '',
        motivo: 'suporte', mensagem_original: mensagemRecebida,
        estado_final: 'resolvido', data_atendimento: new Date().toISOString(), resolvido: true,
      });
    } else if (intencao === 'cancelamento') {
      await enviarMensagem(telefone, `😢 Que pena, *${clienteLocal.nome}*!\n\nPara solicitar o cancelamento, preciso te transferir para um de nossos atendentes.\n\nAguarde um momento...`);
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_atendente' });
      await dbCreate('Atendimento', {
        telefone, nome_cliente: clienteLocal.nome || '',
        id_cliente_receitanet: clienteLocal.id_cliente_receitanet || '',
        motivo: 'cancelamento', mensagem_original: mensagemRecebida,
        estado_final: 'transferido', data_atendimento: new Date().toISOString(), resolvido: false,
      });
    } else if (intencao === 'atendente') {
      await enviarMensagem(telefone, `👤 Certo, *${clienteLocal.nome}*! Vou te transferir para um atendente humano.\n\nAguarde um momento, alguém entrará em contato em breve! 😊`);
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_atendente' });
    } else {
      await enviarMensagem(telefone, `Olá, *${clienteLocal.nome}*! 😊\n\nComo posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção.`);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
