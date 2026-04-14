// ═══════════════════════════════════════════════════════════════
// PSIU TELECOM — Bot WhatsApp (versão enxuta)
// Fluxo: identifica pelo telefone → consulta Receitanet → responde
// Se não achar → pede CPF → cadastra → responde
// Qualquer erro → manda pro atendente
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const fetch = require('node-fetch');

const app  = express();
app.use(cors());
app.use(express.json());

// ── Variáveis de ambiente ────────────────────────────────────────
const PORT              = process.env.PORT || 3000;
const ZAPI_BASE         = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || '';
const BASE44_URL        = process.env.BASE44_API_URL    || 'https://api.base44.com/api/apps/69d55fd1a341508858f11d46/entities';
const RECEITANET_BASE   = process.env.RECEITANET_BASE_URL || 'https://api.receitanet.com.br/api/v1';
const NUMERO_RAFA       = process.env.NUMERO_RAFA || '5519999619605';

function getBase44Token() { return process.env.BASE44_SERVICE_TOKEN || ''; }
function getReceitanetToken() { return process.env.RECEITANET_TOKEN || ''; }

// ── Utilitários ──────────────────────────────────────────────────
function normalizarTelefone(tel) {
  // Remove tudo que não é número
  let n = String(tel).replace(/\D/g, '');
  // Remove código do país 55 se tiver mais de 12 dígitos
  if (n.length > 12 && n.startsWith('55')) n = n.slice(2);
  // Remover nono dígito para busca (alguns cadastros têm, outros não)
  return n;
}

function ehCpfCnpj(texto) {
  const nums = texto.replace(/\D/g, '');
  return nums.length === 11 || nums.length === 14;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch com timeout ────────────────────────────────────────────
async function fetchTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Z-API: enviar mensagem ───────────────────────────────────────
async function enviar(telefone, texto) {
  try {
    const tel = normalizarTelefone(telefone);
    await fetchTimeout(`${ZAPI_BASE}/send-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CLIENT_TOKEN
      },
      body: JSON.stringify({ phone: tel, message: texto })
    }, 10000);
    console.log('[ZAPI] Enviado para', tel);
  } catch (e) {
    console.error('[ZAPI] Erro ao enviar:', e.message);
  }
}

// ── Base44: buscar cliente pelo telefone ─────────────────────────
async function buscarPorTelefone(telefone) {
  try {
    const tel = normalizarTelefone(telefone);
    // Tentar com e sem nono dígito
    const variantes = new Set([tel]);
    if (tel.length === 11) variantes.add(tel.slice(0,2) + tel.slice(3)); // sem nono
    if (tel.length === 10) variantes.add(tel.slice(0,2) + '9' + tel.slice(2)); // com nono

    for (const v of variantes) {
      const res = await fetchTimeout(`${BASE44_URL}/ClienteWhatsapp?telefone=${encodeURIComponent(v)}`, {
        headers: { 'x-service-token': getBase44Token() }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const lista = Array.isArray(data) ? data : (data.items || []);
      if (lista.length > 0) return lista[0];
    }
    return null;
  } catch (e) {
    console.error('[BASE44] Erro buscarPorTelefone:', e.message);
    return null;
  }
}

// ── Base44: buscar cliente por CPF/CNPJ ─────────────────────────
async function buscarPorCpf(cpf) {
  try {
    const nums = cpf.replace(/\D/g, '');
    const res = await fetchTimeout(`${BASE44_URL}/ClienteWhatsapp?cpf_cnpj=${encodeURIComponent(nums)}`, {
      headers: { 'x-service-token': getBase44Token() }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const lista = Array.isArray(data) ? data : (data.items || []);
    return lista.length > 0 ? lista[0] : null;
  } catch (e) {
    console.error('[BASE44] Erro buscarPorCpf:', e.message);
    return null;
  }
}

// ── Base44: criar cliente ────────────────────────────────────────
async function criarCliente(telefone, cpf) {
  try {
    const tel = normalizarTelefone(telefone);
    const res = await fetchTimeout(`${BASE44_URL}/ClienteWhatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': getBase44Token() },
      body: JSON.stringify({
        telefone: tel,
        cpf_cnpj: cpf.replace(/\D/g,''),
        identificado: false,
        estado_conversa: 'identificando',
        ultimo_contato: new Date().toISOString()
      })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[BASE44] Erro criarCliente:', e.message);
    return null;
  }
}

// ── Base44: atualizar cliente ────────────────────────────────────
async function atualizarCliente(id, dados) {
  try {
    await fetchTimeout(`${BASE44_URL}/ClienteWhatsapp/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-service-token': getBase44Token() },
      body: JSON.stringify({ ...dados, ultimo_contato: new Date().toISOString() })
    });
  } catch (e) {
    console.error('[BASE44] Erro atualizarCliente:', e.message);
  }
}

// ── Base44: registrar atendimento ────────────────────────────────
async function registrarAtendimento(dados) {
  try {
    await fetchTimeout(`${BASE44_URL}/Atendimento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': getBase44Token() },
      body: JSON.stringify({ ...dados, data_atendimento: new Date().toISOString() })
    });
  } catch (e) {
    console.error('[BASE44] Erro registrarAtendimento:', e.message);
  }
}

// ── Receitanet: buscar cliente por CPF ───────────────────────────
async function receitanetBuscarCpf(cpf) {
  try {
    const nums = cpf.replace(/\D/g, '');
    const res = await fetchTimeout(`${RECEITANET_BASE}/clientes/buscar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getReceitanetToken(), cpfCnpj: nums })
    }, 12000);
    if (!res.ok) return { erro: true, status: res.status };
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('[RECEITANET] Erro buscarCpf:', e.message);
    return { erro: true, timeout: e.name === 'AbortError' };
  }
}

// ── Receitanet: verificar status de acesso ───────────────────────
async function receitanetStatusAcesso(idCliente) {
  try {
    const res = await fetchTimeout(`${RECEITANET_BASE}/verificar-acesso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getReceitanetToken(), idCliente })
    }, 12000);
    if (!res.ok) return { erro: true, status: res.status };
    return await res.json();
  } catch (e) {
    console.error('[RECEITANET] Erro statusAcesso:', e.message);
    return { erro: true, timeout: e.name === 'AbortError' };
  }
}

// ── Receitanet: buscar boleto ────────────────────────────────────
async function receitanetBoleto(idCliente) {
  try {
    const res = await fetchTimeout(`${RECEITANET_BASE}/financeiro/boleto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getReceitanetToken(), idCliente })
    }, 12000);
    if (!res.ok) return { erro: true };
    return await res.json();
  } catch (e) {
    console.error('[RECEITANET] Erro boleto:', e.message);
    return { erro: true };
  }
}

// ── Avisar Rafa (urgente) ────────────────────────────────────────
async function avisarRafa(texto) {
  try {
    await enviar(NUMERO_RAFA, texto);
  } catch(e) {}
}

// ── Encaminhar para atendente ────────────────────────────────────
async function encaminharAtendente(telefone, clienteId, nome, motivo) {
  await enviar(telefone,
    `Vou te passar para um atendente agora! 👋\n\nEm breve alguém da nossa equipe vai te ajudar. Se preferir ligar: *(19) 3167-2161* 📞`
  );
  if (clienteId) {
    await atualizarCliente(clienteId, { estado_conversa: 'aguardando_atendente' });
  }
  await registrarAtendimento({
    telefone: normalizarTelefone(telefone),
    nome_cliente: nome || 'Desconhecido',
    id_cliente_receitanet: null,
    motivo: motivo || 'Encaminhado para atendente',
    mensagem_original: motivo || '',
    estado_final: 'encaminhado_atendente',
    resolvido: false
  });
  await avisarRafa(
    `🔔 *Atendimento Humano*\n\nCliente: ${nome || telefone}\nTelefone: ${telefone}\nMotivo: ${motivo || 'não especificado'}`
  );
}

// ════════════════════════════════════════════════════════════════
// LÓGICA PRINCIPAL
// ════════════════════════════════════════════════════════════════

async function processarMensagem(telefone, mensagem) {
  const tel = normalizarTelefone(telefone);
  const msg = (mensagem || '').trim();

  console.log(`[BOT] Mensagem de ${tel}: "${msg.substring(0,80)}"`);

  // ── PASSO 1: buscar cliente pelo telefone ──────────────────────
  let cliente = await buscarPorTelefone(tel);

  // ── PASSO 2: cliente não encontrado → verificar se mandou CPF ─
  if (!cliente) {
    if (ehCpfCnpj(msg)) {
      // Tentou mandar CPF antes de ser cadastrado
      return await processarCpf(telefone, msg, null);
    }
    // Não tem cadastro e não mandou CPF → pedir CPF
    await enviar(telefone,
      `Olá! 👋 Seja bem-vindo à *PSIU Telecom*!\n\nPara te ajudar, preciso te localizar no sistema. Me passa seu *CPF ou CNPJ* (só os números)?`
    );
    // Criar registro provisório
    await criarCliente(tel, '00000000000');
    return;
  }

  // ── PASSO 3: cliente existe mas ainda não tem ID Receitanet ───
  if (!cliente.id_cliente_receitanet) {
    if (cliente.estado_conversa === 'aguardando_cpf' || ehCpfCnpj(msg)) {
      if (ehCpfCnpj(msg)) {
        return await processarCpf(telefone, msg, cliente);
      }
      // Ainda aguardando CPF
      await enviar(telefone,
        `Para te ajudar preciso do seu *CPF ou CNPJ* (só os números). 😊`
      );
      return;
    }
    // Primeira mensagem de novo contato sem cadastro completo
    await atualizarCliente(cliente.id, { estado_conversa: 'aguardando_cpf', ultima_mensagem: msg.substring(0,200) });
    await enviar(telefone,
      `Olá! 👋 Para te ajudar, preciso te localizar no sistema.\n\nMe passa seu *CPF ou CNPJ* (só os números)?`
    );
    return;
  }

  // ── PASSO 4: cliente identificado → processar pedido ──────────
  await atualizarCliente(cliente.id, { ultima_mensagem: msg.substring(0,200) });
  return await processarPedido(telefone, msg, cliente);
}

// ── Processar CPF enviado ────────────────────────────────────────
async function processarCpf(telefone, msg, cliente) {
  const cpf = msg.replace(/\D/g,'');
  console.log(`[CPF] Processando CPF ${cpf.substring(0,6)}*** de ${normalizarTelefone(telefone)}`);

  // Buscar no Receitanet
  const resultado = await receitanetBuscarCpf(cpf);

  if (resultado?.erro) {
    await enviar(telefone,
      `Estou com uma instabilidade no sistema agora. 😕\n\nPode tentar em instantes? Se preferir, nosso telefone é *(19) 3167-2161* 📞`
    );
    return;
  }

  // CPF não encontrado no Receitanet
  if (!resultado?.idCliente && !resultado?.contratos?.idCliente) {
    await enviar(telefone,
      `Não encontrei nenhum contrato com esse CPF/CNPJ em nosso sistema. 🤔\n\nVerifique se digitou corretamente, ou fale com um atendente:\n📞 *(19) 3167-2161*`
    );
    if (cliente) {
      await atualizarCliente(cliente.id, { estado_conversa: 'aguardando_cpf' });
    }
    return;
  }

  // Extrair dados do cliente
  const idCliente = resultado.idCliente || resultado.contratos?.idCliente;
  const nome      = resultado.nome || resultado.contratos?.nome || 'Cliente';
  const plano     = resultado.plano || resultado.contratos?.plano || '';

  // Atualizar/criar no banco
  const tel = normalizarTelefone(telefone);
  if (cliente) {
    await atualizarCliente(cliente.id, {
      id_cliente_receitanet: String(idCliente),
      cpf_cnpj: cpf,
      nome: nome,
      identificado: true,
      estado_conversa: 'identificado'
    });
    cliente = { ...cliente, id_cliente_receitanet: String(idCliente), nome };
  } else {
    cliente = await criarCliente(tel, cpf);
    if (cliente) {
      await atualizarCliente(cliente.id, {
        id_cliente_receitanet: String(idCliente),
        nome: nome,
        identificado: true,
        estado_conversa: 'identificado'
      });
      cliente = { ...cliente, id_cliente_receitanet: String(idCliente), nome };
    }
  }

  await enviar(telefone, `Oi, *${nome}*! 😊 Te encontrei aqui.\n\nComo posso te ajudar hoje?\n\n1️⃣ Minha internet está sem sinal / lenta\n2️⃣ Quero ver meu boleto ou pix\n3️⃣ Falar com um atendente`);

  // Atualizar estado para aguardando escolha
  if (cliente) {
    await atualizarCliente(cliente.id, { estado_conversa: 'aguardando_opcao' });
  }
}

// ── Processar pedido do cliente identificado ─────────────────────
async function processarPedido(telefone, msg, cliente) {
  const msgLower = msg.toLowerCase();
  const idCliente = cliente.id_cliente_receitanet;
  const nome = cliente.nome || 'Cliente';

  // ── Palavras-chave para boleto/financeiro ──────────────────────
  const eBoleto = /boleto|pix|pagar|pagamento|vencimento|fatura|financeiro|2|dois/i.test(msgLower);

  // ── Palavras-chave para problema técnico ──────────────────────
  const eTecnico = /sem (sinal|internet|acesso)|caindo|lento|lenta|oscila|reiniciar|travando|luz vermelha|não (funciona|conecta)|suporte|técnico|problema|falha|1|um\b/i.test(msgLower);

  // ── Palavras-chave para atendente ─────────────────────────────
  const eAtendente = /atendente|humano|pessoa|falar com|3|três|ajuda|cancelar|cancelamento/i.test(msgLower);

  // ── Opção: boleto ──────────────────────────────────────────────
  if (eBoleto && !eTecnico) {
    await enviar(telefone, `Buscando seu boleto... 🔍`);
    const boleto = await receitanetBoleto(idCliente);

    if (boleto?.erro) {
      await encaminharAtendente(telefone, cliente.id, nome, 'Solicitou boleto — erro ao buscar');
      return;
    }

    const link = boleto?.linkBoleto || boleto?.link || boleto?.url || boleto?.pix;
    if (link) {
      await enviar(telefone, `Aqui está seu boleto/pix, *${nome}*! 💙\n\n${link}\n\nQualquer dúvida é só chamar! 😊`);
      await atualizarCliente(cliente.id, { estado_conversa: 'resolvido' });
      await registrarAtendimento({
        telefone: normalizarTelefone(telefone),
        nome_cliente: nome,
        id_cliente_receitanet: idCliente,
        motivo: 'Solicitou boleto',
        mensagem_original: msg,
        estado_final: 'resolvido',
        resolvido: true
      });
    } else {
      await encaminharAtendente(telefone, cliente.id, nome, 'Solicitou boleto — link não disponível');
    }
    return;
  }

  // ── Opção: problema técnico ────────────────────────────────────
  if (eTecnico && !eBoleto) {
    await enviar(telefone, `Verificando sua conexão... ⏳`);
    const status = await receitanetStatusAcesso(idCliente);

    if (status?.erro) {
      // API falhou → encaminhar para humano
      await encaminharAtendente(telefone, cliente.id, nome, 'Suporte técnico — sistema indisponível');
      return;
    }

    const online = status?.status === 1 || status?.online === true || status?.acesso === 'liberado';

    if (online) {
      await enviar(telefone,
        `Sua conexão está *ativa* no sistema! ✅\n\nAlgumas dicas rápidas:\n\n• Desligue o roteador da tomada por 30 segundos e ligue novamente\n• Se o problema continuar, pode ser algo no seu dispositivo\n\nIsso resolveu? Se não, é só falar que chamo um técnico! 🔧`
      );
      await atualizarCliente(cliente.id, { estado_conversa: 'suporte_ativo' });
    } else {
      // Conexão offline → abrir chamado e avisar Rafa
      await enviar(telefone,
        `Identifiquei que sua conexão está *offline* no sistema. 😕\n\nVou registrar um chamado técnico agora para nossa equipe verificar. Em breve entraremos em contato!\n\nSe precisar de atendimento imediato: 📞 *(19) 3167-2161*`
      );
      await atualizarCliente(cliente.id, { estado_conversa: 'chamado_aberto' });
      await registrarAtendimento({
        telefone: normalizarTelefone(telefone),
        nome_cliente: nome,
        id_cliente_receitanet: idCliente,
        motivo: 'Sem sinal — conexão offline',
        mensagem_original: msg,
        estado_final: 'chamado_aberto',
        resolvido: false
      });
      await avisarRafa(
        `🔴 *Chamado Técnico*\n\nCliente: *${nome}*\nTelefone: ${telefone}\nStatus: Offline no sistema\nMensagem: ${msg.substring(0,100)}`
      );
    }
    return;
  }

  // ── Opção: atendente / outros ──────────────────────────────────
  if (eAtendente) {
    await encaminharAtendente(telefone, cliente.id, nome, msg.substring(0,100));
    return;
  }

  // ── Mensagem não reconhecida → menu simples ────────────────────
  // Se estava aguardando opção, reapresentar o menu
  await enviar(telefone,
    `Oi, *${nome}*! Como posso te ajudar? 😊\n\n1️⃣ Minha internet está sem sinal / lenta\n2️⃣ Quero ver meu boleto ou pix\n3️⃣ Falar com um atendente`
  );
  await atualizarCliente(cliente.id, { estado_conversa: 'aguardando_opcao' });
}

// ════════════════════════════════════════════════════════════════
// ROTAS
// ════════════════════════════════════════════════════════════════

// Webhook Z-API
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder imediatamente
  try {
    const body = req.body;

    // Ignorar mensagens próprias / status
    if (body.fromMe || body.isStatusReply || !body.text?.message) return;

    const telefone = body.phone || body.from || '';
    const mensagem = body.text?.message || '';

    if (!telefone || !mensagem) return;

    await processarMensagem(telefone, mensagem);
  } catch (e) {
    console.error('[WEBHOOK] Erro não tratado:', e.message, e.stack);
  }
});

// Dashboard data
app.get('/dashboard-data', async (req, res) => {
  try {
    const [resAt, resCl] = await Promise.all([
      fetchTimeout(`${BASE44_URL}/Atendimento?limit=200`, {
        headers: { 'x-service-token': getBase44Token() }
      }),
      fetchTimeout(`${BASE44_URL}/ClienteWhatsapp?limit=200`, {
        headers: { 'x-service-token': getBase44Token() }
      })
    ]);

    const atendimentos = resAt.ok  ? (await resAt.json())  : [];
    const clientes     = resCl.ok  ? (await resCl.json())  : [];

    const lista = Array.isArray(atendimentos) ? atendimentos : (atendimentos.items || []);
    const listaCl = Array.isArray(clientes) ? clientes : (clientes.items || []);

    const hoje = new Date().toISOString().slice(0,10);
    const deHoje = lista.filter(a => (a.data_atendimento||'').startsWith(hoje));

    res.json({
      total: lista.length,
      hoje: deHoje.length,
      resolvidos: lista.filter(a => a.resolvido).length,
      em_andamento: lista.filter(a => !a.resolvido).length,
      aguardando_atendente: listaCl.filter(c => c.estado_conversa === 'aguardando_atendente').length,
      por_estado: lista.reduce((acc, a) => {
        acc[a.estado_final || 'sem_estado'] = (acc[a.estado_final || 'sem_estado'] || 0) + 1;
        return acc;
      }, {}),
      recentes: lista.slice(-20).reverse()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ping
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Update token (sem redeploy)
app.post('/update-token', (req, res) => {
  const { secret, token } = req.body || {};
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' });
  if (!token) return res.status(400).json({ error: 'token required' });
  process.env.RECEITANET_TOKEN = token;
  console.log('[TOKEN] Token Receitanet atualizado em runtime');
  res.json({ ok: true });
});

// ── Iniciar servidor ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] PSIU Bot rodando na porta ${PORT}`);
  console.log(`[SERVER] BASE44_URL: ${BASE44_URL}`);
  console.log(`[SERVER] RECEITANET_BASE: ${RECEITANET_BASE}`);
  console.log(`[SERVER] Token Base44: ${getBase44Token() ? 'ok' : 'FALTANDO!'}`);
  console.log(`[SERVER] Token Receitanet: ${getReceitanetToken() ? 'ok' : 'FALTANDO!'}`);
});
