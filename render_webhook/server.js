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
const GROQ_API_KEY      = process.env.GROQ_API_KEY || '';

const getServiceToken = () => process.env.BASE44_SERVICE_TOKEN || '';

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — DB (Base44)
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 2 — RECEITANET
// ═════════════════════════════════════════════════════════════════════════════
async function receitanetPost(endpoint, extraBody) {
  const res = await fetch(`${RECEITANET_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_TOKEN, app: 'chatbot', ...extraBody })
  });
  return res.json();
}

const buscarClientePorTelefone = (phone)     => receitanetPost('clientes', { phone });
const buscarClientePorCpf      = (cpfcnpj)   => receitanetPost('clientes', { cpfcnpj: cpfcnpj.replace(/\D/g, '') });
const buscarClientePorId       = (idCliente) => receitanetPost('clientes', { idCliente });
const abrirChamado             = (idCliente, contato) => receitanetPost('abertura-chamado', { idCliente, contato, ocorrenciatipo: 1, motivoos: 1 });

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — AGENTE DE IA (Groq)
// ═════════════════════════════════════════════════════════════════════════════

// 3a. Transcrição de áudio
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
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...form.getHeaders() },
      body: form
    });
    const data = await groqRes.json();
    console.log('[GROQ] Transcrição:', JSON.stringify(data).substring(0, 200));
    return data.text || null;
  } catch (e) {
    console.error('[GROQ] Erro transcrição:', e.message);
    return null;
  }
}

// 3b. Classificador de intenção via Groq LLM
async function classificarIntencao(mensagem) {
  try {
    const prompt = `Você é um classificador de intenções para um provedor de internet chamado PSIU Telecom.

Analise a mensagem do cliente e responda SOMENTE com um JSON válido, sem explicações.

Intenções possíveis:
- "boleto": cliente quer segunda via, boleto, fatura, pagamento ou PIX
- "suporte": cliente relata problema com internet, sem sinal, lento, caiu, equipamento, luz vermelha
- "cancelamento": cliente quer cancelar o serviço
- "atendente": cliente quer falar com humano, contratar novo plano, instalar, mudança de endereço
- "outro": qualquer outra coisa

Mensagem: "${mensagem}"

Responda exatamente neste formato JSON:
{"intent": "boleto", "descricao": "resumo curto da mensagem"}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 100
      })
    });

    const data = await res.json();
    const texto = data.choices?.[0]?.message?.content?.trim() || '{}';
    console.log('[GROQ] Classificação:', texto);

    // Extrair JSON da resposta
    const match = texto.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.intent || 'outro';
    }
    return 'outro';
  } catch (e) {
    console.error('[GROQ] Erro classificação:', e.message);
    // Fallback para regex simples se Groq falhar
    return classificarIntencaoFallback(mensagem);
  }
}

// Fallback regex caso Groq esteja indisponível
function classificarIntencaoFallback(msg) {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (m.match(/boleto|fatura|pagar|pagamento|pix|segunda via|vencimento|debito|cobranca|conta/)) return 'boleto';
  if (m.match(/sem internet|sem sinal|caiu|lento|travando|sem conexao|fibra|rompimento|nao funciona|parou|reinici|modem|roteador|luz vermelha|luz piscando|vermelho|offline|net caiu|sem net|sem wifi|wifi/)) return 'suporte';
  if (m.match(/cancelar|cancelamento|quero cancelar|desistir|nao quero mais/)) return 'cancelamento';
  if (m.match(/falar com|atendente|humano|pessoa|responsavel|gerente|contrato|plano|instalar|instalacao|mudanca|mudei|quero assinar|quero contratar|novo cliente|contratar/)) return 'atendente';
  return 'outro';
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 4 — GATEWAY (Z-API)
// ═════════════════════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 5 — PROCESSADOR DE ENTRADA (extrai dados do webhook Z-API)
// ═════════════════════════════════════════════════════════════════════════════
function extrairDados(body) {
  if (body.isGroupMsg === true || body.fromMe === true) {
    return { telefone: '', mensagem: '', audioUrl: null };
  }

  let phone = String(body.phone || body.from || '').replace(/\D/g, '').replace(/@.*$/, '');
  if (phone.length === 11) phone = '55' + phone;
  if (phone.length === 10) phone = '55' + phone;

  let mensagem = '';
  if (body.text && typeof body.text === 'object') {
    mensagem = String(body.text.message || '');
  } else {
    mensagem = String(body.message || body.content || body.body || '');
  }

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

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 6 — ESTADO E UTILITÁRIOS
// ═════════════════════════════════════════════════════════════════════════════
function primeiroNome(nomeCompleto) {
  return (nomeCompleto || 'cliente').split(' ')[0];
}

function atendenteDisponivel() {
  const horaBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return horaBR.getDay() >= 1 && horaBR.getDay() <= 5 && horaBR.getHours() >= 9 && horaBR.getHours() < 20;
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
    telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente,
    motivo, mensagem_original: mensagem, estado_final: estado,
    data_atendimento: new Date().toISOString(), resolvido
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 7 — WEBHOOK PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
app.get('/', (_req, res) => res.send('PSIU TELECOM Webhook - OK'));
app.get('/webhook', (_req, res) => res.send('PSIU TELECOM Webhook - OK'));

app.post('/webhook', async (req, res) => {
  res.json({ ok: true }); // Responde imediatamente ao Z-API

  try {
    const { telefone, mensagem: mensagemTexto, audioUrl } = extrairDados(req.body);

    // Transcrever áudio se necessário
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

    // ── Buscar cliente no banco local ─────────────────────────────────────────
    let lista = await dbFilter('ClienteWhatsapp', { telefone });

    // Fallback: sem prefixo 55
    if (!Array.isArray(lista) || lista.length === 0) {
      const telSem55 = telefone.startsWith('55') ? telefone.slice(2) : telefone;
      lista = await dbFilter('ClienteWhatsapp', { telefone: telSem55 });
      if (Array.isArray(lista) && lista.length > 0) {
        await dbUpdate('ClienteWhatsapp', lista[0].id, { telefone });
      }
    }

    let cliente = Array.isArray(lista) && lista.length > 0 ? lista[0] : null;

    // ── Rota 1: cliente já identificado no banco ───────────────────────────────
    if (cliente?.id_cliente_receitanet) {
      // Garantir flags corretas
      if (!cliente.identificado) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { identificado: true, estado_conversa: 'identificado' });
        cliente = { ...cliente, identificado: true, estado_conversa: 'identificado' };
      }
      await dbUpdate('ClienteWhatsapp', cliente.id, { ultimo_contato: new Date().toISOString() });
      await handleClienteIdentificado(cliente, telefone, mensagemRecebida);
      return;
    }

    // ── Rota 2: tentar identificar pelo telefone no Receitanet ────────────────
    const resultadoTel = await buscarClientePorTelefone(telefone);
    if (resultadoTel.success && resultadoTel.contratos?.idCliente) {
      const dados = {
        telefone,
        id_cliente_receitanet: String(resultadoTel.contratos.idCliente),
        nome: resultadoTel.contratos.razaoSocial || '',
        cpf_cnpj: resultadoTel.contratos.cpfCnpj || '',
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
      await handleClienteIdentificado(cliente, telefone, mensagemRecebida);
      return;
    }

    // ── Rota 3: telefone não encontrado — fluxo de identificação por CPF ──────
    if (!cliente) {
      cliente = await dbCreate('ClienteWhatsapp', {
        telefone, identificado: false,
        ultimo_contato: new Date().toISOString(),
        estado_conversa: 'aguardando_cpf'
      });
    }
    await handleIdentificacaoPorCpf(cliente, telefone, mensagemRecebida);

  } catch (err) {
    console.error('[WEBHOOK] Erro:', err.message, err.stack);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 8 — IDENTIFICAÇÃO POR CPF
// ═════════════════════════════════════════════════════════════════════════════
async function handleIdentificacaoPorCpf(cliente, telefone, mensagem) {
  const intencao = await classificarIntencao(mensagem);
  const cpf = mensagem.replace(/\D/g, '');

  // Se veio um CPF/CNPJ válido — tentar identificar
  if (cpf.length >= 11 && cpf.length <= 14) {
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
      // Identificado com sucesso — processar como cliente normal
      await handleClienteIdentificado(cliente, telefone, mensagem);
      return;
    } else {
      await enviarMensagem(telefone, `Não encontrei cadastro com esse CPF/CNPJ. 😕\n\nVerifica se está correto. Se preferir, nossa equipe pode te ajudar por aqui mesmo!`);
      return;
    }
  }

  // Quer contratar — encaminhar direto para atendente
  if (intencao === 'atendente') {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente_novo_cliente' });
    await registrarAtendimento(telefone, 'Novo Cliente', null, 'novo_cliente', mensagem, 'encaminhado_atendente', false);
    const msg = atendenteDisponivel()
      ? `Olá! 👋 Que ótimo que você quer conhecer a PSIU!\n\nVou te conectar com nosso time agora. Um atendente entrará em contato em breve! 😊`
      : `Olá! 👋 Que ótimo que você quer conhecer a PSIU!\n\nNosso horário de atendimento é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, entraremos em contato! 😊`;
    await enviarMensagem(telefone, msg);
    await alertarRafa('🆕', 'NOVO CLIENTE INTERESSADO', 'Novo Cliente', telefone, `📲 Quer contratar a PSIU! Entre em contato.`);
    return;
  }

  // Qualquer outra mensagem (inclusive "já sou cliente", "boleto", "suporte")
  // → pedir CPF para identificar
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_cpf', ultimo_contato: new Date().toISOString() });
  await enviarMensagem(telefone, `Olá! 👋 Bem-vindo(a) à *PSIU TELECOM*!\n\nNão encontrei seu número no cadastro. Me passa seu *CPF ou CNPJ* para eu te localizar 😊\n\nSe quiser contratar nossos serviços, é só dizer!`);
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 9 — ORQUESTRADOR (cliente identificado)
// ═════════════════════════════════════════════════════════════════════════════
async function handleClienteIdentificado(cliente, telefone, mensagem) {
  const idCliente    = cliente.id_cliente_receitanet;
  const nome         = primeiroNome(cliente.nome);
  const nomeCompleto = cliente.nome || 'cliente';
  const estado       = cliente.estado_conversa;

  // Classificar intenção via Groq
  const intencao = await classificarIntencao(mensagem);
  console.log('[INTENCAO]', intencao, '| estado:', estado);

  // ── Detecção de massiva ───────────────────────────────────────────────────
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
        await alertarRafa('🚨🚨🚨', 'MASSIVA DETECTADA!', nomeCompleto, telefone, `👥 Clientes afetados: *${recentes + 1}*\n\nVários clientes estão sem internet! Verifique com URGÊNCIA.\n⚡ Clientes já sendo avisados automaticamente.`);
      }
      return;
    }
  }

  // ── Estado: chamado aberto — aguardando feedback ──────────────────────────
  if (estado === 'chamado_aberto' && intencao !== 'suporte' && intencao !== 'boleto') {
    const m = mensagem.toLowerCase();
    if (m.match(/funcionou|resolveu|voltou|ta ok|tá ok|ok|certo|funcionando|obrigad/)) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
      await enviarMensagem(telefone, `Ótimo, *${nome}*! Fico feliz que resolveu! 😄\n\nSe precisar de mais alguma coisa, é só falar! 🙌`);
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
  if (intencao === 'boleto')       return handleBoleto(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'suporte')      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'cancelamento') return handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'atendente')    return handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);

  // ── Mensagem não reconhecida ──────────────────────────────────────────────
  await enviarMensagem(telefone, `Oi, *${nome}*! 😊 Como posso te ajudar?\n\n💰 *Boleto* — segunda via e PIX\n🔧 *Suporte* — problemas com internet\n👤 *Atendente* — falar com nossa equipe`);
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 10 — AÇÕES (handlers de intenção)
// ═════════════════════════════════════════════════════════════════════════════

async function handleBoleto(cliente, telefone, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });

  const cpf = cliente.cpf_cnpj ? cliente.cpf_cnpj.replace(/\D/g, '') : null;
  const dados = cpf ? await buscarClientePorCpf(cpf) : await buscarClientePorTelefone(telefone);

  console.log('[BOLETO] Resposta Receitanet:', JSON.stringify(dados).substring(0, 400));

  if (!dados.success) {
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'erro_api', false);
    await enviarMensagem(telefone, `*${nome}*, não consegui carregar sua fatura agora. Tenta em alguns minutos ou fala com nossa equipe por aqui mesmo 😊`);
    return;
  }

  const faturas = dados?.contratos?.faturasEmAberto;

  if (!faturas || faturas.length === 0) {
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'resolvido', true);
    await enviarMensagem(telefone, `Boa notícia, *${nome}*! ✅ Não há nenhuma fatura em aberto. Tudo em dia!`);
    return;
  }

  let msg = `Olá, *${nome}*! Aqui estão suas faturas em aberto:\n\n`;
  for (const f of faturas.slice(0, 3)) {
    const dataVenc = f.vencimento ? new Date(f.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    msg += `📅 *Vencimento:* ${dataVenc}\n💰 *Valor:* R$ ${parseFloat(f.valor).toFixed(2).replace('.', ',')}\n`;
    if (f.url)                msg += `\n🔗 *Link do Boleto:*\n${f.url}\n`;
    if (f.urlPixCopiaCola)    msg += `\n💳 *PIX Copia e Cola:*\n${f.urlPixCopiaCola}\n`;
    if (f.urlBoletoCopiaCola) msg += `\n🔢 *Linha Digitável:*\n${f.urlBoletoCopiaCola}\n`;
    msg += '\n';
  }

  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'boleto', '', 'resolvido', true);
  await enviarMensagem(telefone, msg.trim());
}

async function handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  const luzVermelha = mensagem.toLowerCase().match(/luz vermelha|vermelho|piscando/);
  const dadosEquip  = await buscarClientePorId(idCliente);
  const equipOnline = dadosEquip.success && dadosEquip.contratos && !dadosEquip.contratos.servidor?.isManutencao;

  const chamado   = await abrirChamado(idCliente, telefone);
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

async function handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'cancelamento_retencao' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'cancelamento', mensagem, 'em_andamento', false);
  await enviarMensagem(telefone, `*${nome}*, ficamos tristes em saber disso. 😔\n\nAntes de tomar essa decisão, qual o motivo? Às vezes conseguimos resolver!\n\n💰 Valor\n🔧 Problema técnico\n📦 Mudança de endereço\n💬 Outro motivo\n\nMe conta que vejo o que posso fazer por você 😊`);
  await alertarRafa('⚠️', 'SOLICITAÇÃO DE CANCELAMENTO', nomeCompleto, telefone, `O bot está tentando reter. Acompanhe!`);
}

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

async function handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'atendente', mensagem, 'encaminhado_atendente', false);
  const msg = atendenteDisponivel()
    ? `*${nome}*, vou te transferir para um atendente agora! 👤\n\nAguarda um momento 😊`
    : `*${nome}*, registrei sua solicitação! 📋\n\nNosso horário de atendimento é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, entraremos em contato 😊`;
  await enviarMensagem(telefone, msg);
  await alertarRafa('👤', 'CLIENTE QUER ATENDENTE', nomeCompleto, telefone, `Solicitou atendimento humano.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// START
// ═════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
