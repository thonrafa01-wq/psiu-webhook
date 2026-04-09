'use strict';
const express = require('express');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Configurações ─────────────────────────────────────────────────────────────
const RECEITANET_TOKEN  = process.env.RECEITANET_CHATBOT_TOKEN || '';
const RECEITANET_BASE   = 'https://sistema.receitanet.net/api/novo/chatbot';
const BASE44_APP_ID     = '69d55fd1a341508858f11d46';
const BASE44_API        = `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities`;
const ZAPI_INSTANCE     = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN        = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const ZAPI_BASE         = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;
const RAFA_PHONE        = '5519999619605';

const getServiceToken = () => process.env.BASE44_SERVICE_TOKEN || '';

// ── DB helpers ────────────────────────────────────────────────────────────────
async function dbFilter(entity, query) {
  const params = new URLSearchParams(query).toString();
  const url = `${BASE44_API}/${entity}?${params}`;
  console.log('[DB] GET', url.substring(0, 120));
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}

async function dbCreate(entity, data) {
  const res = await fetch(`${BASE44_API}/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function dbUpdate(entity, id, data) {
  const res = await fetch(`${BASE44_API}/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

// ── Receitanet helpers ────────────────────────────────────────────────────────
async function receitanetPost(endpoint, extraBody) {
  const res = await fetch(`${RECEITANET_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_TOKEN, app: 'chatbot', ...extraBody })
  });
  return res.json();
}

const buscarClientePorTelefone = (phone)    => receitanetPost('clientes', { phone });
const buscarClientePorCpf      = (cpfcnpj)  => receitanetPost('clientes', { cpfcnpj: cpfcnpj.replace(/\D/g, '') });
const buscarClientePorId       = (idCliente) => receitanetPost('clientes', { idCliente });
const buscarBoletos            = (idCliente, contato) => receitanetPost('boletos', { idCliente, contato, tipo: 'sms' });
const abrirChamado             = (idCliente, contato) => receitanetPost('abertura-chamado', { idCliente, contato, ocorrenciatipo: 1, motivoos: 1 });

// ── Z-API ─────────────────────────────────────────────────────────────────────
async function enviarMensagem(telefone, mensagem) {
  const numero = telefone.startsWith('55') ? telefone : '55' + telefone;
  const res = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numero, message: mensagem })
  });
  const data = await res.json();
  console.log('[Z-API] envio:', JSON.stringify(data).substring(0, 150));
  return data;
}

// ── Transcrição de áudio via Groq ─────────────────────────────────────────────
async function transcreverAudio(audioUrl) {
  try {
    console.log('[GROQ] Baixando áudio:', audioUrl);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Erro ao baixar áudio: ' + audioRes.status);
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    const form = new FormData();
    form.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, ...form.getHeaders() },
      body: form
    });
    const data = await groqRes.json();
    console.log('[GROQ] Transcrição:', JSON.stringify(data).substring(0, 200));
    return data.text || null;
  } catch (e) {
    console.error('[GROQ] Erro:', e.message);
    return null;
  }
}

// ── Extrair dados do webhook Z-API ────────────────────────────────────────────
function extrairDados(body) {
  // Ignorar mensagens de grupos e enviadas pelo bot
  if (body.isGroupMsg === true || body.fromMe === true) {
    return { telefone: '', mensagem: '', audioUrl: null };
  }

  // Normalizar telefone
  let phone = String(body.phone || body.from || '').replace(/\D/g, '').replace(/@.*$/, '');
  if (phone.length === 11) phone = '55' + phone;
  if (phone.length === 10) phone = '55' + phone;

  // Extrair texto
  let mensagem = '';
  if (body.text && typeof body.text === 'object') {
    mensagem = String(body.text.message || '');
  } else {
    mensagem = String(body.message || body.content || body.body || '');
  }

  // Extrair URL de áudio
  let audioUrl = body.audio?.audioUrl || body.audio?.url || body.audioUrl || null;
  if (!audioUrl && body.type === 'AudioMessage' && body.audio) audioUrl = body.audio;
  if (!audioUrl && mensagem === '' && body.type === 'ReceivedCallback') {
    const match = JSON.stringify(body).match(/"(https?:[^"]*\.(?:ogg|mp3|mp4|wav|opus|m4a|aac)[^"]*)"/i);
    if (match) audioUrl = match[1];
  }

  if (audioUrl) console.log('[AUDIO] URL detectada:', audioUrl);
  console.log('[EXTRACT]', { phone, mensagem: mensagem.substring(0, 50), audioUrl: !!audioUrl, type: body.type });

  return { telefone: phone, mensagem, audioUrl };
}

// ── Classificação de intenção ─────────────────────────────────────────────────
function classificarIntencao(msg) {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (m.match(/boleto|fatura|pagar|pagamento|pix|segunda via|vencimento|debito|cobranca|conta/))
    return 'boleto';
  if (m.match(/sem internet|sem sinal|caiu|lento|travando|sem conexao|fibra|rompimento|nao funciona|parou|reinici|modem|roteador|luz vermelha|luz piscando|vermelho|offline|caiu a net|net caiu|sem net|sem wifi|wifi|signal/))
    return 'suporte';
  if (m.match(/cancelar|cancelamento|quero cancelar|desistir|nao quero mais/))
    return 'cancelamento';
  if (m.match(/falar com|atendente|humano|pessoa|responsavel|gerente|contrato|plano|instalar|instalacao|mudanca|mudei|novo cliente|quero assinar|quero contratar/))
    return 'atendente';
  return 'outro';
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function primeiroNome(nomeCompleto) {
  return (nomeCompleto || 'cliente').split(' ')[0];
}

function atendenteDisponivel() {
  const horaBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dia  = horaBR.getDay();
  const hora = horaBR.getHours();
  return dia >= 1 && dia <= 5 && hora >= 9 && hora < 20;
}

function horaAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

async function alertarRafa(emoji, titulo, nome, telefone, extra) {
  const msg = `${emoji} *${titulo}*\n\n⏰ ${horaAtual()}\n👤 Cliente: *${nome}*\n📞 Fone: ${telefone.replace(/^55/, '')}\n${extra}`;
  await enviarMensagem(RAFA_PHONE, msg);
}

function registrarAtendimento(telefone, nomeCompleto, idCliente, motivo, mensagem, estado, resolvido) {
  return dbCreate('Atendimento', {
    telefone,
    nome_cliente: nomeCompleto,
    id_cliente_receitanet: idCliente,
    motivo,
    mensagem_original: mensagem,
    estado_final: estado,
    data_atendimento: new Date().toISOString(),
    resolvido
  });
}

// ── Endpoints de saúde ────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('PSIU TELECOM Webhook - OK'));
app.get('/webhook', (_req, res) => res.send('PSIU TELECOM Webhook - OK'));

// ── Webhook principal ─────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Responde imediatamente ao Z-API para evitar retentativas
  res.json({ ok: true });

  try {
    const { telefone, mensagem: mensagemTexto, audioUrl } = extrairDados(req.body);

    // Transcrever áudio (se houver)
    let mensagemRecebida = mensagemTexto;
    if (audioUrl && !mensagemTexto) {
      const transcricao = await transcreverAudio(audioUrl);
      if (transcricao) {
        mensagemRecebida = transcricao;
        console.log('[AUDIO] Transcrição:', transcricao);
      } else {
        await enviarMensagem(telefone, `Recebi seu áudio mas não consegui entender. Pode digitar sua mensagem? 😊`);
        return;
      }
    }

    if (!telefone || !mensagemRecebida) return;

    console.log('[WEBHOOK]', { telefone, msg: mensagemRecebida.substring(0, 100) });

    // ── Buscar cliente no banco ───────────────────────────────────────────────
    let lista = await dbFilter('ClienteWhatsapp', { telefone });

    // Tentar sem prefixo 55 se não achou
    if (!Array.isArray(lista) || lista.length === 0) {
      const telSem55 = telefone.startsWith('55') ? telefone.slice(2) : telefone;
      lista = await dbFilter('ClienteWhatsapp', { telefone: telSem55 });
      if (Array.isArray(lista) && lista.length > 0) {
        await dbUpdate('ClienteWhatsapp', lista[0].id, { telefone }); // Normalizar telefone
      }
    }

    let cliente = Array.isArray(lista) && lista.length > 0 ? lista[0] : null;

    // ── Correção automática de estado inconsistente ───────────────────────────
    // Se cliente já tem ID no Receitanet mas estado ficou travado, corrige
    if (cliente?.id_cliente_receitanet && !cliente.identificado) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { identificado: true, estado_conversa: 'identificado' });
      cliente = { ...cliente, identificado: true, estado_conversa: 'identificado' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCO 1 — CLIENTE NÃO IDENTIFICADO
    // ═══════════════════════════════════════════════════════════════════════════
    if (!cliente?.identificado) {
      await handleNaoIdentificado(cliente, telefone, mensagemRecebida);
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCO 2 — CLIENTE IDENTIFICADO
    // ═══════════════════════════════════════════════════════════════════════════
    await dbUpdate('ClienteWhatsapp', cliente.id, { ultimo_contato: new Date().toISOString() });
    await handleIdentificado(cliente, telefone, mensagemRecebida);

  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message, err.stack);
  }
});

// ── Fluxo: cliente não identificado ──────────────────────────────────────────
async function handleNaoIdentificado(cliente, telefone, mensagem) {
  // Tentar identificar automaticamente pelo telefone
  const resultado = await buscarClientePorTelefone(telefone);
  if (resultado.success && resultado.contratos?.idCliente) {
    const dados = {
      telefone,
      id_cliente_receitanet: String(resultado.contratos.idCliente),
      nome: resultado.contratos.razaoSocial || '',
      cpf_cnpj: resultado.contratos.cpfCnpj || '',
      identificado: true,
      ultimo_contato: new Date().toISOString(),
      estado_conversa: 'identificado'
    };
    if (cliente) {
      await dbUpdate('ClienteWhatsapp', cliente.id, dados);
      cliente = { ...cliente, ...dados };
    } else {
      cliente = await dbCreate('ClienteWhatsapp', dados);
    }
    // Identificado — seguir para o fluxo principal
    return handleIdentificado(cliente, telefone, mensagem);
  }

  // Não encontrou pelo telefone — analisar estado da conversa
  const estado = cliente?.estado_conversa || null;

  if (estado === 'aguardando_cpf') {
    return handleAguardandoCpf(cliente, telefone, mensagem);
  }

  if (estado === 'aguardando_eh_cliente') {
    return handleAguardandoEhCliente(cliente, telefone, mensagem);
  }

  // Primeiro contato ou estado desconhecido
  if (!cliente) {
    await dbCreate('ClienteWhatsapp', {
      telefone, identificado: false,
      ultimo_contato: new Date().toISOString(),
      estado_conversa: 'aguardando_eh_cliente'
    });
  } else {
    await dbUpdate('ClienteWhatsapp', cliente.id, {
      estado_conversa: 'aguardando_eh_cliente',
      ultimo_contato: new Date().toISOString()
    });
  }
  await enviarMensagem(telefone, `Olá! 👋 Bem-vindo(a) à *PSIU TELECOM*!\n\nVocê já é nosso cliente?`);
}

async function handleAguardandoEhCliente(cliente, telefone, mensagem) {
  const m = mensagem.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (m.match(/^(sim|s|yes|sou|ja|já|cliente|sou cliente|claro|confirmo)/)) {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_cpf' });
    await enviarMensagem(telefone, `Tudo bem! Me informa seu *CPF ou CNPJ* pra eu localizar seu cadastro 😊`);
  } else if (m.match(/^(nao|n|no|não|novo|quero ser|quero contratar|me tornar)/)) {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente_novo_cliente' });
    await registrarAtendimento(telefone, 'Novo Cliente', null, 'novo_cliente', mensagem, 'encaminhado_atendente', false);
    const msgBV = atendenteDisponivel()
      ? `Que ótimo, seja bem-vindo(a)! 🎉\n\nVou te conectar com nosso time de vendas agora. Um atendente entrará em contato em breve!`
      : `Que ótimo, seja bem-vindo(a)! 🎉\n\nNosso horário de atendimento é *seg-sex das 9h às 20h*. Um atendente entrará em contato para te apresentar nossos planos! 😊`;
    await enviarMensagem(telefone, msgBV);
    await alertarRafa('🆕', 'NOVO CLIENTE INTERESSADO', 'Novo Cliente', telefone, `📲 Quer contratar a PSIU! Entre em contato.`);
  } else {
    await enviarMensagem(telefone, `Desculpe, não entendi. Você já é *cliente da PSIU*?\n\nResponda *sim* ou *não* 😊`);
  }
}

async function handleAguardandoCpf(cliente, telefone, mensagem) {
  const cpf = mensagem.replace(/\D/g, '');
  if (cpf.length < 11) {
    await enviarMensagem(telefone, `Me passa o *CPF ou CNPJ* (só os números) pra eu localizar seu cadastro 😊`);
    return;
  }
  const resultado = await buscarClientePorCpf(cpf);
  if (resultado.success && resultado.contratos?.idCliente) {
    const dados = {
      telefone,
      id_cliente_receitanet: String(resultado.contratos.idCliente),
      nome: resultado.contratos.razaoSocial || '',
      cpf_cnpj: cpf,
      identificado: true,
      ultimo_contato: new Date().toISOString(),
      estado_conversa: 'identificado'
    };
    await dbUpdate('ClienteWhatsapp', cliente.id, dados);
    cliente = { ...cliente, ...dados };
    return handleIdentificado(cliente, telefone, mensagem);
  }
  await enviarMensagem(telefone, `Hmm, não encontrei nenhum cadastro com esse CPF. 😕\n\nVerifica se digitou certo ou fala com nosso time: *(19) 3167-2161*`);
}

// ── Fluxo: cliente identificado ───────────────────────────────────────────────
async function handleIdentificado(cliente, telefone, mensagem) {
  const idCliente   = cliente.id_cliente_receitanet;
  const nome        = primeiroNome(cliente.nome);
  const nomeCompleto = cliente.nome || 'cliente';
  const estado      = cliente.estado_conversa;
  const intencao    = classificarIntencao(mensagem);

  console.log('[INTENCAO]', intencao, '| estado:', estado);

  // ── Verificar massiva ANTES de outros fluxos de suporte ──────────────────
  if (intencao === 'suporte') {
    const trintaMinAtras = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const todosChamados  = await dbFilter('Atendimento', { motivo: 'suporte' });
    const recentes = Array.isArray(todosChamados)
      ? todosChamados.filter(c => c.data_atendimento > trintaMinAtras).length
      : 0;

    if (recentes >= 3) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'massiva' });
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'massiva', false);
      await enviarMensagem(telefone, `Oi, *${nome}*! 😔 Identificamos uma instabilidade na rede que pode estar afetando sua região.\n\nNossa equipe já foi acionada e está trabalhando na resolução.\n\n⏱️ *Previsão: até 5 horas* — te avisamos assim que normalizar. Pedimos desculpas! 🙏`);
      if (recentes === 3) {
        await alertarRafa('🚨🚨🚨', 'MASSIVA DETECTADA!', nomeCompleto, telefone, `👥 Clientes afetados: *${recentes + 1}*\n\nVários clientes estão sem internet! Verifique o roteador/fibra com URGÊNCIA.\n⚡ Clientes já sendo avisados automaticamente.`);
      }
      return;
    }
  }

  // ── Estado: chamado aberto (aguardando feedback do cliente) ──────────────
  if (estado === 'chamado_aberto' && intencao !== 'suporte' && intencao !== 'boleto') {
    const m = mensagem.toLowerCase();
    if (m.match(/funcionou|resolveu|voltou|ta ok|tá ok|ok|certo|funcionando|obrigad/)) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
      await enviarMensagem(telefone, `Ótimo, *${nome}*! Fico feliz que resolveu! 😄\n\nSe precisar de mais alguma coisa, é só falar. Estou aqui! 🙌`);
    } else {
      await enviarMensagem(telefone, `Entendi, *${nome}*. Nossa equipe técnica já está ciente e vai entrar em contato em breve! 🔧\n\nSe quiser falar com um atendente, é só dizer.`);
    }
    return;
  }

  // ── Estado: retenção de cancelamento ─────────────────────────────────────
  if (estado === 'cancelamento_retencao' && intencao !== 'boleto' && intencao !== 'suporte') {
    return handleRetencao(cliente, telefone, mensagem, nome);
  }

  // ── Intenções principais ──────────────────────────────────────────────────
  if (intencao === 'boleto')       return handleBoleto(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'suporte')      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'cancelamento') return handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'atendente')    return handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);

  // ── Mensagem não reconhecida ──────────────────────────────────────────────
  await enviarMensagem(telefone, `Oi, *${nome}*! 😊 Como posso te ajudar?\n\n💰 *Boleto* — segunda via e PIX\n🔧 *Suporte* — problemas com internet\n👤 *Atendente* — falar com nossa equipe`);
}

// ── Handler: boleto ───────────────────────────────────────────────────────────
async function handleBoleto(cliente, telefone, _mensagem, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });

  // Buscar dados atualizados (faturas)
  const cpf = cliente.cpf_cnpj ? cliente.cpf_cnpj.replace(/\D/g, '') : null;
  const dados = cpf ? await buscarClientePorCpf(cpf) : await buscarClientePorTelefone(telefone);

  console.log('[BOLETO] Resposta Receitanet:', JSON.stringify(dados).substring(0, 400));

  const faturas = dados?.contratos?.faturasEmAberto;

  if (!dados.success) {
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'erro_api', false);
    await enviarMensagem(telefone, `*${nome}*, não consegui carregar sua fatura agora. Tenta em alguns minutos ou fala com nosso time: *(19) 3167-2161* 😊`);
    return;
  }

  if (!faturas || faturas.length === 0) {
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'resolvido', true);
    await enviarMensagem(telefone, `Boa notícia, *${nome}*! ✅ Não há nenhuma fatura em aberto. Tudo em dia!`);
    return;
  }

  let msg = `Olá, *${nome}*! Aqui estão suas faturas em aberto:\n\n`;
  for (const f of faturas.slice(0, 3)) {
    const dataVenc = f.vencimento
      ? new Date(f.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')
      : '—';
    msg += `📅 *Vencimento:* ${dataVenc}\n💰 *Valor:* R$ ${parseFloat(f.valor).toFixed(2).replace('.', ',')}\n`;
    if (f.url)               msg += `\n🔗 *Link do Boleto:*\n${f.url}\n`;
    if (f.urlPixCopiaCola)   msg += `\n💳 *PIX Copia e Cola:*\n${f.urlPixCopiaCola}\n`;
    if (f.urlBoletoCopiaCola) msg += `\n🔢 *Linha Digitável:*\n${f.urlBoletoCopiaCola}\n`;
    msg += '\n';
  }

  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'resolvido', true);
  await enviarMensagem(telefone, msg.trim());
}

// ── Handler: suporte técnico ──────────────────────────────────────────────────
async function handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  const luzVermelha = mensagem.toLowerCase().match(/luz vermelha|vermelho|piscando/);

  // Verificar status do equipamento
  const dadosEquip = await buscarClientePorId(idCliente);
  const equipOnline = dadosEquip.success && dadosEquip.contratos && !dadosEquip.contratos.servidor?.isManutencao;

  const chamado = await abrirChamado(idCliente, telefone);
  const protocolo = chamado.protocolo || chamado.idSuporte || 'gerado';

  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'chamado_aberto' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, luzVermelha ? 'suporte_campo' : 'suporte', mensagem, 'chamado_aberto', false);

  if (luzVermelha) {
    await enviarMensagem(telefone, `*${nome}*, luz vermelha indica um problema na fibra que precisamos verificar presencialmente. 🔴\n\nJá abri um chamado técnico para visita! Nossa equipe entrará em contato em breve.\n\n📋 Protocolo: ${protocolo}`);
    await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `⚠️ Luz vermelha — falha na fibra!\n📋 Protocolo: ${protocolo}`);
  } else if (equipOnline) {
    await enviarMensagem(telefone, `*${nome}*, seu equipamento aparece *online* no nosso sistema. Pode ser instabilidade momentânea. 🔄\n\nTenta reiniciar o roteador: *desliga da tomada por 30 segundos e liga novamente.*\n\nJá abri um chamado (protocolo: ${protocolo}). Nossa equipe vai verificar remotamente! 🔧`);
    await alertarRafa('🟡', 'CHAMADO TÉCNICO', nomeCompleto, telefone, `Equipamento *online* mas cliente sem internet.\n📋 Protocolo: ${protocolo}`);
  } else {
    await enviarMensagem(telefone, `*${nome}*, seu equipamento está *offline* no nosso sistema. 📡\n\nTenta reiniciar: *desliga o roteador da tomada por 30 segundos e liga novamente.*\n\nJá abri um chamado (protocolo: ${protocolo}). Se não resolver, nossa equipe entra em contato! 🔧`);
    await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `Equipamento *offline*.\n📋 Protocolo: ${protocolo}`);
  }
}

// ── Handler: cancelamento ─────────────────────────────────────────────────────
async function handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'cancelamento_retencao' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'cancelamento', mensagem, 'em_andamento', false);
  await enviarMensagem(telefone, `*${nome}*, ficamos tristes em saber disso. 😔\n\nAntes de tomar essa decisão, qual o motivo? Às vezes conseguimos resolver!\n\n💰 Valor\n🔧 Problema técnico\n📦 Mudança de endereço\n💬 Outro motivo\n\nMe conta que vejo o que posso fazer por você 😊`);
  await alertarRafa('⚠️', 'SOLICITAÇÃO DE CANCELAMENTO', nomeCompleto, telefone, `O bot está tentando reter. Acompanhe!`);
}

// ── Handler: retenção ─────────────────────────────────────────────────────────
async function handleRetencao(cliente, telefone, mensagem, nome) {
  const m = mensagem.toLowerCase();
  let resposta = '';

  if (m.match(/valor|caro|preco|preço|dinheiro|financeiro/)) {
    resposta = `Entendo, *${nome}*! 💙 Temos algumas opções:\n\n🎁 *Carência especial* — pausar sua conta por até 30 dias\n💳 *Renegociação* — parcelar débitos\n📦 *Ajuste de plano* — planos mais acessíveis\n\nUm atendente vai entrar em contato para te apresentar as opções. Aguarda? 😊`;
  } else if (m.match(/tecnico|internet|sinal|lento|problema|nao funciona/)) {
    resposta = `*${nome}*, se o motivo é técnico, a gente quer resolver! 🔧\n\nAbri um chamado prioritário para nossa equipe entrar em contato hoje. Não precisa cancelar por isso!\n\nAguarda que um técnico vai te chamar em breve 😊`;
  } else if (m.match(/mudanca|mudança|mudei|endereço|endereco|outra cidade/)) {
    resposta = `*${nome}*, dependendo do novo endereço conseguimos levar a PSIU até você! 🏠\n\nUm atendente vai verificar se temos cobertura na nova região. Tudo bem? 😊`;
  } else {
    resposta = `Entendido, *${nome}*! Vou passar para um atendente que pode conversar melhor sobre sua situação.\n\nAguarda, alguém entra em contato em breve! 🙏`;
  }

  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente' });
  await enviarMensagem(telefone, resposta);
}

// ── Handler: encaminhar para atendente ────────────────────────────────────────
async function handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'atendente', mensagem, 'encaminhado_atendente', false);
  const msg = atendenteDisponivel()
    ? `*${nome}*, vou te transferir para um atendente agora! 👤\n\nAguarda um momento 😊`
    : `*${nome}*, registrei sua solicitação! 📋\n\nNosso horário de atendimento é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, entraremos em contato 😊`;
  await enviarMensagem(telefone, msg);
  await alertarRafa('👤', 'CLIENTE QUER ATENDENTE', nomeCompleto, telefone, `Solicitou atendimento humano.`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
