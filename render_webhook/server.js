'use strict';
const express = require('express');
const FormData = require('form-data');
const fetch = require('node-fetch');

// ── Fetch com timeout global (evita travamento por APIs lentas) ──────────────
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── JSON seguro (evita crash quando API retorna HTML em erro 502/504) ─────────
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn('[safeJson] Resposta não-JSON (status', res.status, '):', text.substring(0, 200));
    return { _error: true, _status: res.status, _raw: text.substring(0, 200) };
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — apenas painel Base44 e Render
const ALLOWED_ORIGINS = [
  'https://untitled-app-f813ec8a.base44.app',
  'https://app.base44.com',
  'https://psiu-webhook.onrender.com'
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-service-key, client-token');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Configurações ─────────────────────────────────────────────────────────────
const RECEITANET_TOKEN  = process.env.RECEITANET_CHATBOT_TOKEN || '';
const RECEITANET_BASE   = 'https://sistema.receitanet.net/api/novo/chatbot';
const BASE44_APP_ID     = '69d55fd1a341508858f11d46';
const BASE44_API        = `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities`;
const ZAPI_INSTANCE     = process.env.ZAPI_INSTANCE     || '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN        || '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || 'Fe4e0f41827564db0813cd79b7c5f6e96S';
// Alertar no boot se variáveis críticas estiverem faltando
if (!process.env.ZAPI_TOKEN) console.warn('[BOOT] ⚠️  ZAPI_TOKEN usando fallback hardcoded — configure no Render!');
if (!process.env.BASE44_SERVICE_TOKEN) console.warn('[BOOT] ⚠️  BASE44_SERVICE_TOKEN não configurado!');
if (!process.env.GROQ_API_KEY) console.warn('[BOOT] ⚠️  GROQ_API_KEY não configurado!');
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
  const res = await fetchWithTimeout(url, {
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' }
  }, 8000);
  return safeJson(res);
}

async function dbCreate(entity, data) {
  const res = await fetchWithTimeout(`${BASE44_API}/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }, 8000);
  return safeJson(res);
}

async function dbUpdate(entity, id, data) {
  const res = await fetchWithTimeout(`${BASE44_API}/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${getServiceToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }, 8000);
  return safeJson(res);
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 2 — RECEITANET
// ═════════════════════════════════════════════════════════════════════════════
async function receitanetPost(endpoint, extraBody) {
  const res = await fetchWithTimeout(`${RECEITANET_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_TOKEN, app: 'chatbot', ...extraBody })
  }, 10000);
  return safeJson(res);
}

const buscarClientePorTelefone = (phone) => { const phoneSem55 = phone.startsWith('55') ? phone.slice(2) : phone; return receitanetPost('clientes', { phone: phoneSem55 }); };
const buscarClientePorCpf      = (cpfcnpj)   => receitanetPost('clientes', { cpfcnpj: cpfcnpj.replace(/\D/g, '') });
const buscarClientePorId       = (idCliente) => receitanetPost('clientes', { idCliente });
const abrirChamado             = (idCliente, contato) => receitanetPost('abertura-chamado', { idCliente, contato, ocorrenciatipo: 1, motivoos: 1 });
const verificarAcesso          = (idCliente, contato) => receitanetPost('verificar-acesso', { idCliente, contato });
const notificacaoPagamento     = (idCliente, contato) => receitanetPost('notificacao-pagamento', { idCliente, contato });

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 3 — AGENTE DE IA (Groq)
// ═════════════════════════════════════════════════════════════════════════════

// 3a. Transcrição de áudio
async function transcreverAudio(audioUrl) {
  try {
    console.log('[GROQ] Baixando áudio:', audioUrl);
    const audioRes = await fetchWithTimeout(audioUrl, {}, 15000);
    if (!audioRes.ok) throw new Error('Erro ao baixar áudio: ' + audioRes.status);
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    const form = new FormData();
    form.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const groqRes = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, ...form.getHeaders() },
      body: form
    });
    if (!groqRes.ok) throw new Error('Groq transcricao HTTP ' + groqRes.status);
    const data = await safeJson(groqRes);
    console.log('[GROQ] Transcrição:', JSON.stringify(data).substring(0, 200));
    return data.text || null;
  } catch (e) {
    console.error('[GROQ] Erro transcrição:', e.message);
    return null;
  }
}

// 3b. Analisar imagem com IA (OpenAI GPT-4o vision)
async function analisarImagem(imageUrl) {
  try {
    console.log('[IMG] Analisando imagem:', imageUrl.substring(0, 100));
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Você é um assistente técnico para uma empresa de internet de fibra óptica chamada PSIU Telecom.
Analise esta imagem e classifique em UMA das categorias abaixo. Responda SOMENTE com um JSON válido.

Categorias:
- "comprovante_pagamento": comprovante de transferência, PIX, TED, DOC, recibo de pagamento, extrato bancário mostrando pagamento
- "equipamento_problema": foto de roteador, modem, ONT, ONU, caixa de fibra com luz vermelha, equipamento com problema visível
- "cabo_rompido": cabo de fibra óptica partido, rompido, danificado, no chão, caído, cabo na rua, poste com problema
- "outro": qualquer outra coisa que não se encaixa acima

Responda neste formato:
{"tipo": "comprovante_pagamento", "descricao": "resumo do que viu na imagem em 1 frase"}`
            },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
        temperature: 0,
        max_tokens: 150
      })
    });
    if (!res.ok) throw new Error('Groq vision HTTP ' + res.status);
    const data = await safeJson(res);
    const texto = data.choices?.[0]?.message?.content?.trim() || '{}';
    console.log('[IMG] Resultado:', texto);
    try {
      const jsonStart = texto.indexOf('{');
      const jsonEnd   = texto.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) return JSON.parse(texto.slice(jsonStart, jsonEnd + 1));
    } catch {}
    return { tipo: 'outro', descricao: 'imagem não identificada' };
  } catch (e) {
    console.error('[IMG] Erro análise:', e.message);
    return { tipo: 'outro', descricao: 'erro ao analisar' };
  }
}

// 3c. Classificador de intenção via Groq LLM
async function classificarIntencao(mensagem) {
  try {
    const prompt = `Você é um classificador de intenções para um provedor de internet chamado PSIU Telecom.

Analise a mensagem do cliente e responda SOMENTE com um JSON válido, sem explicações.

REGRA PRINCIPAL: Classifique pela INTENÇÃO real, não por palavras soltas.

Intenções possíveis:
- "duvida": cliente quer entender algo, fazer uma pergunta geral (ex: "como funciona fibra", "o que é ONU", "quais planos vocês têm", "qual a velocidade")
- "comercial": cliente quer contratar, instalar, conhecer preços, mudar de plano, indicar alguém (ex: "quero assinar", "quanto custa", "tem plano de 200mb")
- "boleto": cliente quer segunda via, boleto, fatura, PIX para pagar, OU quer saber se tem dívida/fatura em aberto (ex: "preciso do boleto", "manda minha fatura", "quero pagar", "tenho faturas em aberto?", "tenho alguma pendência?", "estou devendo?", "tem alguma fatura?", "minha conta está em dia?")
- "pagou": cliente diz que JÁ pagou (ex: "já paguei", "fiz o pix", "efetuei pagamento")
- "suporte": cliente relata problema ATUAL com internet (ex: "sem internet", "caiu", "lento", "luz vermelha", "sem sinal")
- "resolvido": cliente diz que o problema foi resolvido (ex: "voltou", "funcionou", "tá ok")
- "verificar_conexao": cliente quer saber o status da conexão DELE (ex: "tô online?", "verifica minha conexão", "estou conectado?"). ATENÇÃO: reclamações sobre o bot não conseguir verificar algo NÃO são verificar_conexao — classifique pelo contexto real da mensagem anterior
- "cancelamento": cliente quer cancelar o serviço
- "atendente": cliente quer falar com humano explicitamente (ex: "quero falar com atendente", "me passa pra um humano")
- "outro": saudações, agradecimentos, conversa geral sem intenção clara

IMPORTANTE:
- "Boa noite tudo bem vocês sabe me dizer se a internet está com problema" → "suporte"
- "Sim estamos sem internet" → "suporte"
- "Estou sem sinal" / "Caiu a internet" / "Sem conexão" → "suporte"
- "Tenho faturas em aberto?" / "Estou devendo?" / "Tem alguma fatura?" → "boleto"
- "Minha conta está em dia?" / "Tenho alguma pendência?" / "Devo alguma coisa?" → "boleto"
- "Já paguei" / "Fiz o PIX" / "Pagamento efetuado" → "pagou"
- Se menciona SEM internet / CAIU / OFFLINE = sempre "suporte"
- Se pergunta sobre status financeiro/conta/fatura = sempre "boleto"
- Saudações puras ("oi", "boa tarde", "bom dia") = "outro"
- "tudo bem" sozinho = "outro"
- Se a mensagem é uma PERGUNTA TÉCNICA GERAL (como funciona X), use "duvida"
- Afirmação confirmando problema ("sim", "é isso", "pode") = "suporte" se há contexto de internet
- "Vc nao consegue verificar" / "você não consegue fazer isso?" → classifique pelo CONTEXTO ANTERIOR, use "outro" se ambíguo
- Mensagens curtas de frustração com o bot ("não entendeu", "errou", "não consegue") → "atendente" 

Mensagem: "${mensagem}"

Responda exatamente neste formato JSON:
{"intent": "duvida", "descricao": "resumo curto da mensagem"}`;

    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0,
        max_tokens: 100
      })
    });

    if (!res.ok) throw new Error('Groq classificador HTTP ' + res.status);
    const data = await safeJson(res);
    const texto = data.choices?.[0]?.message?.content?.trim() || '{}';
    console.log('[GROQ] Classificação:', texto);

    // Extrair JSON da resposta
    try {
      const jsonStart = texto.indexOf('{');
      const jsonEnd   = texto.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed = JSON.parse(texto.slice(jsonStart, jsonEnd + 1));
        return parsed.intent || 'outro';
      }
    } catch {}
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
  if (m.match(/j[aá] paguei|j[aá] pago|efetuei|realizei|fiz o pix|paguei hoje|paguei ontem|efetuou|realizou|confirmei pagamento/)) return 'pagou';
  if (m.match(/quero pagar|preciso do boleto|manda.*(fatura|boleto)|segunda via|2.?via|boleto|fatura|vencimento|faturas em aberto|tenho debito|tenho divida|estou devendo|pendenci|em atraso|minha conta.*dia|conta em dia|alguma fatura|devo algo/)) return 'boleto';
  if (m.match(/sem internet|sem sinal|caiu|lento|travando|sem conexao|rompimento|nao funciona|parou|reinici|modem|roteador|luz vermelha|luz piscando|vermelho|offline|net caiu|sem net|sem wifi|wifi caiu/)) return 'suporte';
  if (m.match(/cancelar|cancelamento|quero cancelar|desistir|nao quero mais/)) return 'cancelamento';
  if (m.match(/quero assinar|quero contratar|quero instalar|quanto custa|qual.*(plano|valor|preco)|tem plano|planos disponiveis|novo cliente/)) return 'comercial';
  if (m.match(/como funciona|o que e|me explica|me fala sobre|o que sao|diferenca entre|duvida|pergunta|entender/)) return 'duvida';
  if (m.match(/falar com|atendente|humano|pessoa|responsavel|gerente|instalacao|mudanca|mudei/)) return 'atendente';
  return 'outro';
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 4 — GATEWAY (Z-API)
// ═════════════════════════════════════════════════════════════════════════════
async function enviarMensagem(telefone, mensagem) {
  const numero = telefone.startsWith('55') ? telefone : '55' + telefone;

  // Delay humanizado: ~40 chars/segundo de "digitação", entre 2 e 12 segundos
  const chars = mensagem.replace(/\s+/g, '').length;
  const delaySegundos = Math.min(12, Math.max(2, Math.round(chars / 40)));

  const res = await fetchWithTimeout(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numero, message: mensagem, delay: delaySegundos })
  }, 12000);
  const data = await safeJson(res);
  console.log('[Z-API] envio (delay:', delaySegundos, 's):', JSON.stringify(data).substring(0, 150));
  return data;
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 5 — PROCESSADOR DE ENTRADA (extrai dados do webhook Z-API)
// ═════════════════════════════════════════════════════════════════════════════
function extrairDados(body) {
  if (body.isGroupMsg === true) {
    return { telefone: '', mensagem: '', audioUrl: null, fromMe: false };
  }

  // Mensagens enviadas pelo próprio número (fromMe=true) só passam se forem comandos do Rafa (#fechar)
  const isFromMe = body.fromMe === true;

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

  // Capturar URL de imagem
  let imageUrl = body.image?.imageUrl || body.image?.url || body.imageUrl || null;
  if (!imageUrl && body.type === 'ImageMessage' && body.image) imageUrl = body.image.imageUrl || body.image.url || body.image;
  if (!imageUrl && body.type === 'ReceivedCallback') {
    const matchImg = JSON.stringify(body).match(/"(https?:[^"]*\.(?:jpg|jpeg|png|webp|gif)[^"]*)"/i);
    if (matchImg) imageUrl = matchImg[1];
  }
  // Caption da imagem (texto junto com a foto)
  const imageCaption = body.image?.caption || body.caption || '';

  // Detectar documento/PDF
  let isDocument = false;
  if (body.type === 'DocumentMessage' || body.document || body.document?.documentUrl) {
    isDocument = true;
  }
  if (!isDocument) {
    const bodyStr = JSON.stringify(body);
    if (bodyStr.includes('.pdf') || bodyStr.includes('DocumentMessage') || bodyStr.includes('"document"')) {
      isDocument = true;
    }
  }

  if (audioUrl) console.log('[AUDIO] URL detectada:', audioUrl);
  if (imageUrl) console.log('[IMAGE] URL detectada:', imageUrl);
  if (isDocument) console.log('[DOC] Documento/PDF detectado');
  console.log('[EXTRACT]', { phone, mensagem: mensagem.substring(0, 50), audioUrl: !!audioUrl, imageUrl: !!imageUrl, isDocument, type: body.type });

  return { telefone: phone, mensagem, audioUrl, imageUrl, imageCaption, isDocument, fromMe: isFromMe || false };
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
  // Validar client-token para rejeitar requisições externas
  const incomingToken = req.headers['client-token'];
  if (incomingToken && incomingToken !== ZAPI_CLIENT_TOKEN) {
    console.warn('[WEBHOOK] Token inválido rejeitado:', incomingToken?.substring(0, 10));
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ ok: true }); // Responde imediatamente ao Z-API

  try {
    const { telefone, mensagem: mensagemTexto, audioUrl, imageUrl, imageCaption, isDocument, fromMe } = extrairDados(req.body);

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

    // Ignorar documentos/PDFs silenciosamente (não confundir com texto)
    if (isDocument) {
      console.log('[DOC] Documento ignorado — não processa como mensagem de texto');
      return;
    }

    // Processar imagem se houver
    if (imageUrl && !mensagemRecebida) {
      // Buscar cliente para ter nome disponível
      const clienteImg = await (async () => {
        try {
          const lista = await dbFilter('ClienteWhatsapp', { telefone });
          return Array.isArray(lista) && lista.length > 0 ? lista[0] : null;
        } catch { return null; }
      })();
      const nomeImg = clienteImg?.nome ? clienteImg.nome.split(' ')[0].charAt(0).toUpperCase() + clienteImg.nome.split(' ')[0].slice(1).toLowerCase() : 'cliente';

      const analise = await analisarImagem(imageUrl);
      console.log('[IMG] Tipo detectado:', analise.tipo, '| desc:', analise.descricao);

      if (analise.tipo === 'comprovante_pagamento') {
        await enviarMensagem(telefone,
          `Recebi seu comprovante, *${nomeImg}*! ✅\n\n` +
          `O processamento do pagamento segue estes prazos:\n\n` +
          `💳 *PIX:* reconhecimento em até *15 minutos* — sua internet volta automaticamente assim que compensar!\n` +
          `🏦 *Boleto / código de barras:* compensação em até *1 dia útil* após o pagamento.`
        );
        if (clienteImg?.id_cliente_receitanet) {
          await registrarAtendimento(telefone, clienteImg.nome || '', clienteImg.id_cliente_receitanet, 'comprovante_enviado', 'Cliente enviou foto de comprovante', 'resolvido', true);
        }
        return;
      }

      if (analise.tipo === 'cabo_rompido') {
        await enviarMensagem(telefone,
          `Obrigado por nos avisar, *${nomeImg}*! 🙏\n\n` +
          `Encaminhei *urgentemente* para nossa equipe técnica. Cabo rompido é prioridade máxima — nosso time irá até o local o mais rápido possível! 🚨\n\n` +
          `Se souber a localização exata (rua, bairro, perto de qual número), pode me informar que ajuda muito! 📍`
        );
        await alertarRafa('🚨', 'CABO ROMPIDO REPORTADO', nomeImg, telefone, `Cliente enviou foto de cabo rompido/danificado na rua!\nVerificar localização e enviar técnico!\nDescrição: ${analise.descricao}`);
        if (clienteImg?.id_cliente_receitanet) {
          await registrarAtendimento(telefone, clienteImg.nome || '', clienteImg.id_cliente_receitanet, 'cabo_rompido', 'Cliente enviou foto de cabo rompido', 'em_andamento', false);
        }
        return;
      }

      if (analise.tipo === 'equipamento_problema') {
        await enviarMensagem(telefone,
          `Recebi a foto do seu equipamento, *${nomeImg}*! 📸\n\n` +
          `Vou verificar o status da sua conexão agora... aguarda um instante! ⏳`
        );
        // Tratar como suporte técnico para verificar equipamento
        mensagemRecebida = 'equipamento com problema luz vermelha';
      } else {
        // Imagem não reconhecida — tratar legenda ou pedir texto
        if (imageCaption) {
          mensagemRecebida = imageCaption;
        } else {
          await enviarMensagem(telefone, `Recebi sua imagem, *${nomeImg}*! 📸 Como posso te ajudar? Me conta o que precisa 😊`);
          return;
        }
      }
    }

    if (!telefone || !mensagemRecebida) { console.warn('[WEBHOOK] Mensagem inválida descartada — telefone:', telefone || 'vazio', '| msg:', mensagemRecebida?.substring(0,30) || 'vazio'); return; }

    console.log('[WEBHOOK]', { telefone, msg: mensagemRecebida.substring(0, 100) });
    console.log('[TELEFONE_BRUTO]', JSON.stringify({ phone: req.body.phone, from: req.body.from, telefoneNormalizado: telefone }));

    // ── Ignorar mensagens do número do Rafa (quando ele manda pelo próprio celular, não fromMe) ──
    if (telefone === RAFA_PHONE || telefone === RAFA_PHONE.replace('55','')) {
      console.log('[WEBHOOK] Mensagem do Rafa ignorada (não é fromMe, mas é o número dele)');
      return;
    }

    // ── GATILHO DO RAFA: mensagens enviadas pelo próprio número ──────────────
    // Só processa se vier do número da PSIU (fromMe=true) E for um comando #fechar
    if (fromMe) {
      const cmd = mensagemRecebida.trim().toLowerCase();

      // #fechar todos — libera TODOS os clientes em atendimento humano
      if (cmd === '#fechar todos') {
        const emAtendimento = await dbFilter('ClienteWhatsapp', { estado_conversa: 'atendente' });
        const emAtendimentoNovo = await dbFilter('ClienteWhatsapp', { estado_conversa: 'atendente_novo_cliente' });
        const todos = [
          ...(Array.isArray(emAtendimento) ? emAtendimento : []),
          ...(Array.isArray(emAtendimentoNovo) ? emAtendimentoNovo : [])
        ];
        for (const c of todos) {
          await dbUpdate('ClienteWhatsapp', c.id, { estado_conversa: 'identificado' });
          await enviarMensagem(c.telefone, `Atendimento encerrado! Se precisar de mais alguma coisa, é só chamar 😊`);
        }
        console.log('[GATILHO] #fechar todos — liberados:', todos.length);
        return;
      }

      // #fechar NUMERO — libera cliente específico
      const matchFechar = cmd.match(/^#fechar\s+([\d]+)/);
      if (matchFechar) {
        const numFechar = matchFechar[1].replace(/\D/g, '');
        const telFechar = numFechar.startsWith('55') ? numFechar : '55' + numFechar;
        let listaFechar = await dbFilter('ClienteWhatsapp', { telefone: telFechar });
        if (!Array.isArray(listaFechar) || listaFechar.length === 0) {
          listaFechar = await dbFilter('ClienteWhatsapp', { telefone: numFechar });
        }
        if (Array.isArray(listaFechar) && listaFechar.length > 0) {
          const clienteFechar = listaFechar[0];
          await dbUpdate('ClienteWhatsapp', clienteFechar.id, { estado_conversa: 'identificado' });
          await enviarMensagem(telFechar, `Atendimento encerrado! Se precisar de mais alguma coisa, é só chamar 😊`);
          console.log('[GATILHO] #fechar', telFechar, '— liberado');
        } else {
          console.log('[GATILHO] #fechar', telFechar, '— não encontrado');
        }
        return;
      }

      // Outros fromMe (Rafa conversando normalmente) — ignorar
      return;
    }

    // ── Buscar cliente no banco local (múltiplos formatos de telefone) ──────────
    let cliente = null;

    // Tentar com telefone completo (55...)
    let lista = await dbFilter('ClienteWhatsapp', { telefone });
    console.log('[DB_BUSCA1]', `telefone=${telefone} resultado=`, Array.isArray(lista) ? lista.length : lista);
    if (Array.isArray(lista) && lista.length > 0) cliente = lista[0];

    // Tentar sem prefixo 55
    if (!cliente) {
      const telSem55 = telefone.startsWith('55') ? telefone.slice(2) : telefone;
      lista = await dbFilter('ClienteWhatsapp', { telefone: telSem55 });
      console.log('[DB_BUSCA2]', `telSem55=${telSem55} resultado=`, Array.isArray(lista) ? lista.length : lista);
      if (Array.isArray(lista) && lista.length > 0) {
        cliente = lista[0];
        await dbUpdate('ClienteWhatsapp', cliente.id, { telefone });
        cliente.telefone = telefone;
      }
    }

    console.log('[SESSAO] cliente encontrado no banco:', cliente ? `id=${cliente.id} identificado=${cliente.identificado} id_receitanet=${cliente.id_cliente_receitanet} telefone_banco=${cliente.telefone}` : 'NÃO ENCONTRADO');

    // ── ROTA 1: cliente JÁ identificado no banco → atender direto ─────────────
    // Esta é a rota principal. Se temos id_cliente_receitanet, NUNCA pedimos CPF.
    if (cliente?.id_cliente_receitanet) {
      if (!cliente.identificado) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { identificado: true, estado_conversa: 'identificado' });
        cliente = { ...cliente, identificado: true, estado_conversa: 'identificado' };
      }
      await dbUpdate('ClienteWhatsapp', cliente.id, { ultimo_contato: new Date().toISOString() });
      await handleClienteIdentificado(cliente, telefone, mensagemRecebida);
      return;
    }

    // ── ROTA 2: cliente no banco mas SEM id_receitanet → tentar pelo telefone ──
    if (cliente && !cliente.id_cliente_receitanet) {
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
        await dbUpdate('ClienteWhatsapp', cliente.id, dados);
        cliente = { ...cliente, ...dados };
        await handleClienteIdentificado(cliente, telefone, mensagemRecebida);
        return;
      }
      // Telefone ainda não bate — salvar mensagem original se ainda não tiver, e pedir CPF
      if (!cliente.mensagem_original_pre_cpf) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { mensagem_original_pre_cpf: mensagemRecebida });
        cliente = { ...cliente, mensagem_original_pre_cpf: mensagemRecebida };
      }
      await handleIdentificacaoPorCpf(cliente, telefone, mensagemRecebida);
      return;
    }

    // ── ROTA 3: cliente NOVO (nunca visto) → tentar telefone, depois CPF ──────
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
      cliente = await dbCreate('ClienteWhatsapp', dados);
      await handleClienteIdentificado(cliente, telefone, mensagemRecebida);
      return;
    }

    // Última tentativa: buscar no banco com variações do número (9 dígito vs 8 dígito)
    // Ex: 5519974193785 vs 551974193785 ou 19974193785 vs 1974193785
    const numBase = telefone.replace(/^55/, '');
    const variacoes = [
      numBase,
      numBase.startsWith('0') ? numBase.slice(1) : '0' + numBase,
      // com 9 dígito/sem 9 dígito (celular SP)
      numBase.length === 11 ? '55' + numBase : null,
      numBase.length === 10 ? '55' + numBase : null,
    ].filter(Boolean);

    let clienteVariacao = null;
    for (const v of variacoes) {
      const tentativa = await dbFilter('ClienteWhatsapp', { telefone: v });
      if (Array.isArray(tentativa) && tentativa.length > 0 && tentativa[0].id_cliente_receitanet) {
        clienteVariacao = tentativa[0];
        console.log('[DB_VARIACAO] Encontrado com telefone variação:', v, '| id:', clienteVariacao.id);
        // Atualizar para o telefone atual
        await dbUpdate('ClienteWhatsapp', clienteVariacao.id, { telefone, ultimo_contato: new Date().toISOString() });
        clienteVariacao.telefone = telefone;
        break;
      }
    }

    if (clienteVariacao) {
      await handleClienteIdentificado(clienteVariacao, telefone, mensagemRecebida);
      return;
    }

    // Nenhuma variação encontrada — criar registro e pedir CPF
    cliente = await dbCreate('ClienteWhatsapp', {
      telefone, identificado: false,
      ultimo_contato: new Date().toISOString(),
      estado_conversa: 'aguardando_cpf',
      mensagem_original_pre_cpf: mensagemRecebida
    });
    await handleIdentificacaoPorCpf(cliente, telefone, mensagemRecebida);

  } catch (err) {
    console.error('[WEBHOOK] Erro fatal:', err.message, err.stack);
    try {
      await enviarMensagem(RAFA_PHONE, `🚨 *Erro fatal no bot*\n\n${err.message}\n\nVerifique os logs no Render.`);
    } catch (_) {}
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 8 — IDENTIFICAÇÃO POR CPF
// ═════════════════════════════════════════════════════════════════════════════
async function handleIdentificacaoPorCpf(cliente, telefone, mensagem) {
  const intencao = await classificarIntencao(mensagem);
  const cpf = mensagem.replace(/\D/g, '');

  // Atualizar mensagem original se nova mensagem não for CPF (cliente ainda explorando)
  const cpfCheck = mensagem.replace(/\D/g, '');
  if (cpfCheck.length < 11 && cliente.estado_conversa === 'aguardando_cpf') {
    // Mensagem não parece CPF — atualizar mensagem original se fizer sentido
    const naoEhCPF = mensagem.length > 5 && !/^\d/.test(mensagem.trim());
    if (naoEhCPF && (!cliente.mensagem_original_pre_cpf || cliente.mensagem_original_pre_cpf.length < mensagem.length)) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { mensagem_original_pre_cpf: mensagem });
      cliente = { ...cliente, mensagem_original_pre_cpf: mensagem };
      console.log('[CPF] Mensagem original atualizada:', mensagem.substring(0, 60));
    }
  }

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
        estado_conversa: 'identificado',
        mensagem_original_pre_cpf: null  // limpar contexto de identificação
      };
      const msgOriginal = cliente.mensagem_original_pre_cpf || mensagem;
      await dbUpdate('ClienteWhatsapp', cliente.id, dados);
      cliente = { ...cliente, ...dados };
      console.log('[CPF] mensagem original para orquestrador:', msgOriginal.substring(0, 80));
      await handleClienteIdentificado(cliente, telefone, msgOriginal);
      return;
    } else {
      await enviarMensagem(telefone, `Não encontrei cadastro com esse CPF/CNPJ. 😕\n\nVerifica se está correto. Se preferir, nossa equipe pode te ajudar por aqui mesmo!`);
      return;
    }
  }

  // Dúvida geral — responder sem pedir CPF
  if (intencao === 'duvida') {
    return handleDuvida(cliente, telefone, mensagem, null);
  }

  // Interesse comercial — encaminhar para equipe sem pedir CPF
  if (intencao === 'comercial') {
    return handleComercial(cliente, telefone, mensagem, null);
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
// MÓDULO 9 — ORQUESTRADOR IA CONVERSACIONAL (cliente identificado)
// ═════════════════════════════════════════════════════════════════════════════
async function handleClienteIdentificado(cliente, telefone, mensagem) {
  const idCliente    = cliente.id_cliente_receitanet;
  const nome         = primeiroNome(cliente.nome);
  const nomeCompleto = cliente.nome || 'cliente';
  let estado         = cliente.estado_conversa;

  // ── Normalizar estado residual ─────────────────────────────────────────────
  if (estado === 'aguardando_cpf' && idCliente) {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    cliente = { ...cliente, estado_conversa: 'identificado' };
    estado = 'identificado';
  }

  // ── MODO SILÊNCIO: atendimento humano ativo ────────────────────────────────
  if (estado === 'atendente' || estado === 'atendente_novo_cliente') {
    console.log('[SILENCIO] Cliente em atendimento humano:', telefone);
    return;
  }

  // ── Estado aguardando_liberacao: cliente respondendo se quer liberar ───────
  if (estado === 'aguardando_liberacao') {
    const respostaNorm = mensagem.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const confirmou = respostaNorm.match(/^(sim|s|yes|quero|pode|ok|claro|vai|tá|ta|bora|libera|confirmo|confirma|isso|afirmativo|com certeza|por favor|pfv|plz|yep|yep|yap)/);
    const recusou   = respostaNorm.match(/^(nao|n|no|nope|nã|cancelar|desistir|nada|deixa|para|pare|tchau|agora nao|depois)/);
    if (confirmou) {
      return handleLiberacaoConfirmada(cliente, telefone, nome, nomeCompleto, idCliente);
    } else if (recusou) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
      await enviarMensagem(telefone, `Tudo bem, *${nome}*! Quando o pagamento compensar, sua internet volta automaticamente. 😊

Se precisar de mais alguma coisa é só chamar!`);
      return;
    } else {
      // Resposta ambígua — perguntar de novo
      await enviarMensagem(telefone, `*${nome}*, desculpa, não entendi. Deseja que eu libere sua conexão agora?

Responda *Sim* ou *Não* 😊`);
      return;
    }
  }

  // ── Classificar intenção para ações que precisam de lógica especial ─────────
  const intencao = await classificarIntencao(mensagem);
  console.log('[INTENCAO]', intencao, '| estado:', estado, '| telefone:', telefone);

  // ── Detecção de massiva ───────────────────────────────────────────────────
  if (intencao === 'suporte') {
    const trintaMinAtras = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    const todosChamados  = await dbFilter('Atendimento', { motivo: 'suporte' });
    const clientesRecentes = Array.isArray(todosChamados)
      ? [...new Set(
          todosChamados
            .filter(c => c.data_atendimento > trintaMinAtras
                      && c.telefone !== telefone
                      && c.telefone !== RAFA_PHONE)
            .map(c => c.telefone)
        )]
      : [];

    if (clientesRecentes.length >= 3) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'massiva' });
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'massiva', false);
      await enviarMensagem(telefone, `Oi, *${nome}*! 😔 Identificamos uma instabilidade na rede que pode estar afetando sua região.

Nossa equipe já foi acionada e está trabalhando na resolução.

⏱️ *Previsão: até 5 horas* — te avisamos assim que normalizar. Pedimos desculpas! 🙏`);
      if (clientesRecentes.length === 3) {
        await alertarRafa('🚨🚨🚨', 'MASSIVA DETECTADA!', nomeCompleto, telefone, '🚨 Clientes afetados: ' + (clientesRecentes.length + 1) + '\n\nVários clientes estão sem internet! Verifique com URGÊNCIA.');
      }
      return;
    }
  }

  // ── Chamado duplicado ─────────────────────────────────────────────────────
  if (estado === 'chamado_aberto' && intencao === 'suporte') {
    await enviarMensagem(telefone, `*${nome}*, já tenho um chamado aberto pra você! 🔧 Nossa equipe técnica já está ciente. Assim que houver atualização, te aviso. Se quiser, posso te passar para um atendente.`);
    return;
  }

  // ── Ações que precisam de integração (boleto, pagamento, suporte) ──────────
  if (intencao === 'boleto')            return handleBoleto(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'pagou')             return handlePagou(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'suporte')           return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'cancelamento')      return handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'atendente')         return handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'resolvido') {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    // Dar baixa automática em todos os atendimentos abertos deste cliente
    try {
      const abertos = await dbFilter('Atendimento', { telefone, limit: 50 });
      const lista = Array.isArray(abertos) ? abertos : [];
      const pendentes = lista.filter(a => ['chamado_aberto','em_andamento','encaminhado_atendente'].includes(a.estado_final) && !a.resolvido);
      for (const at of pendentes) {
        await dbUpdate('Atendimento', at.id, { estado_final: 'resolvido', resolvido: true });
        console.log('[RESOLVIDO] Baixa automática no atendimento', at.id, 'de', nomeCompleto);
      }
      if (pendentes.length > 0) console.log(`[RESOLVIDO] ${pendentes.length} atendimento(s) fechado(s) para ${telefone}`);
    } catch(e) { console.error('[RESOLVIDO] Erro ao fechar atendimentos:', e.message); }
    await enviarMensagem(telefone, `Que ótimo, *${nome}*! 😄 Fico feliz que resolveu! Se precisar de mais alguma coisa é só chamar 🙌`);
    return;
  }
  if (intencao === 'verificar_conexao') {
    const acesso = await verificarAcesso(idCliente, telefone);
    if (acesso?.status === 1) {
      await enviarMensagem(telefone, `*${nome}*, acabei de verificar: seu equipamento está *online* ✅\n\nSe ainda estiver com lentidão, tenta reiniciar o roteador: desliga da tomada por 30 segundos e liga de novo. Se persistir, abro um chamado! 🔧`);
    } else if (acesso?.status === 2) {
      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
    } else {
      await enviarMensagem(telefone, `*${nome}*, não consegui verificar o status agora. Se estiver com problema de internet me diga que abro um chamado técnico! 🔧`);
    }
    return;
  }

  // ── Para tudo mais (dúvidas, saudações, comercial, conversa) → IA conversacional ──
  return handleIAConversacional(cliente, telefone, mensagem, nome, nomeCompleto, idCliente, intencao, cliente.mensagem_original_pre_cpf);
}

// ─────────────────────────────────────────────────────────────────────────────
// IA CONVERSACIONAL — responde dúvidas, saudações e qualquer outra coisa
// ─────────────────────────────────────────────────────────────────────────────
async function handleIAConversacional(cliente, telefone, mensagem, nome, nomeCompleto, idCliente, intencao) {
  console.log('[IA-CONV] Respondendo via IA para', telefone, '| intent:', intencao);

  // Segurança: se classificador mandou boleto/pagou aqui por engano, redirecionar
  if (intencao === 'boleto') return handleBoleto(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'pagou')  return handlePagou(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'suporte') return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);

  try {
    const prompt = `Você é um atendente virtual da PSIU TELECOM, empresa de internet por fibra óptica em Mogi Mirim e região (SP).

PERSONALIDADE: Educado, natural, humano — como um atendente real no WhatsApp. Warm, direto, sem formalidades excessivas.

CONTEXTO DO CLIENTE:
- Nome: ${nomeCompleto}
- É cliente cadastrado: sim
- ID interno: ${idCliente || 'não localizado'}

REGRAS:
1. Se for saudação (oi, olá, bom dia, boa tarde): responda com calor e pergunte como pode ajudar, de forma natural. NÃO liste menus, NÃO use bullets/números com opções.
2. Se for dúvida técnica (fibra, modem, velocidade, etc.): explique de forma simples e didática.
3. Se for pergunta sobre planos ou preços: diga que temos planos de fibra óptica e que um atendente pode passar os valores atualizados — ofereça conectar.
4. Seja SEMPRE conciso: máximo 4 linhas por resposta.
5. Se o cliente perguntar sobre conta, fatura ou pagamento, diga que vai verificar agora mesmo (o sistema vai buscar automaticamente).
6. NÃO use listas numeradas ou bullet points com opções de menu.
7. Use o nome do cliente naturalmente, mas não em toda frase.
8. Responda em português informal e caloroso.

Mensagem do cliente: "${mensagem}"`;

    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 250
      })
    });
    if (!res.ok) throw new Error('Groq duvida HTTP ' + res.status);
    const data = await safeJson(res);
    const resposta = data.choices?.[0]?.message?.content?.trim();
    if (resposta) {
      await enviarMensagem(telefone, resposta);
    } else {
      throw new Error('Resposta vazia');
    }
  } catch (e) {
    console.error('[IA-CONV] Erro:', e.message);
    await enviarMensagem(telefone, `Oi, *${nome}*! 😊 Como posso te ajudar hoje?`);
  }
}
// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 10 — AÇÕES (handlers de intenção)
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER: Dúvidas e informações gerais
// ─────────────────────────────────────────────────────────────────────────────
async function handleDuvida(cliente, telefone, mensagem, nome) {
  console.log('[DUVIDA] Respondendo dúvida para', telefone, ':', mensagem.substring(0, 60));
  try {
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `Você é um atendente virtual da PSIU TELECOM, empresa de internet por fibra óptica em Mogi Mirim e região (interior de SP). Seja educado, natural e humano — como um atendente real de WhatsApp.

REGRAS:
- Se a mensagem for uma saudação (oi, olá, bom dia, etc): responda com saudação calorosa e pergunte como pode ajudar de forma natural, SEM listar menus ou opções com emojis/bullets
- Se for dúvida técnica: explique de forma simples e didática
- Se for pergunta geral: responda naturalmente
- Nunca mencione valores sem certeza. Se não souber algo específico, diga que pode passar para um atendente
- Responda em português, de forma curta (máximo 4 linhas)
- NÃO mencione fatura, boleto ou cobrança a menos que o cliente pergunte
- NÃO use listas com bullet points ou emojis excessivos — pareça humano` },
          { role: 'user', content: mensagem }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (!res.ok) throw new Error('Groq duvida HTTP ' + res.status);
    const data = await safeJson(res);
    const resposta = data.choices?.[0]?.message?.content?.trim();
    if (resposta) {
      const saudacao = nome && nome !== 'cliente' ? `*${nome}*, ` : '';
      await enviarMensagem(telefone, `${saudacao}${resposta}

Se precisar de mais alguma coisa, é só perguntar! 😊`);
    } else {
      throw new Error('Resposta vazia do Groq');
    }
  } catch (e) {
    console.error('[DUVIDA] Erro ao gerar resposta:', e.message);
    await enviarMensagem(telefone, `Oi${nome && nome !== 'cliente' ? ', *' + nome + '*' : ''}! 😊 Essa é uma ótima pergunta! Para te explicar melhor, vou te passar para um dos nossos atendentes. Um momento! 🙏`);
    if (cliente?.id) await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente_novo_cliente' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER: Interesse comercial (querer contratar, preços, planos)
// ─────────────────────────────────────────────────────────────────────────────
async function handleComercial(cliente, telefone, mensagem, nome) {
  console.log('[COMERCIAL] Interesse comercial para', telefone);
  const saudacao = nome && nome !== 'cliente' ? `*${nome}*` : 'olá';
  await enviarMensagem(telefone,
    `Oi, ${saudacao}! 😊 Que ótimo que você tem interesse na PSIU TELECOM!

` +
    `🌐 Somos especializados em *internet por fibra óptica* com alta velocidade e estabilidade para Mogi Mirim e região.

` +
    `Para te apresentar os planos disponíveis para o seu endereço e verificar cobertura, vou conectar você com nossa equipe comercial! 👇`
  );
  const msg = atendenteDisponivel()
    ? `Um atendente entrará em contato em breve! 🚀`
    : `Nosso horário de atendimento é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, entraremos em contato! 😊`;
  await enviarMensagem(telefone, msg);
  if (cliente?.id) await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente_novo_cliente' });
  await registrarAtendimento(telefone, nome || 'cliente', cliente?.id_cliente_receitanet || null, 'comercial', mensagem, 'encaminhado_atendente', false);
  await alertarRafa('💼', 'INTERESSE COMERCIAL', nome || 'cliente', telefone, `📲 Cliente interessado em contratar ou conhecer planos!`);
}

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

  // Usar endpoint /verificar-acesso — retorna status: 1=online, 2=offline
  const acesso = await verificarAcesso(idCliente, telefone);
  const statusAcesso = acesso?.status; // 1=online, 2=offline, undefined=erro
  const equipOnline  = statusAcesso === 1;
  const equipOffline = statusAcesso === 2;
  console.log('[EQUIP] idCliente:', idCliente, '| status:', statusAcesso, '| msg:', acesso?.msg, '| online:', equipOnline);

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
  } else if (equipOffline) {
    await enviarMensagem(telefone, `*${nome}*, seu equipamento está *offline* no nosso sistema. 📡\n\nTenta reiniciar: *desliga o roteador da tomada por 30 segundos e liga novamente.*\n\nJá abri um chamado (protocolo: ${protocolo}). Se não resolver, nossa equipe entra em contato! 🔧`);
    await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `Equipamento *offline*.\n📋 Protocolo: ${protocolo}`);
  } else {
    // Não foi possível verificar status — mensagem neutra
    await enviarMensagem(telefone, `*${nome}*, já abri um chamado técnico para nossa equipe verificar! 🔧\n\nEnquanto isso, tenta reiniciar o roteador: *desliga da tomada por 30 segundos e liga novamente.*\n\n📋 Protocolo: ${protocolo}`);
    await alertarRafa('🟡', 'CHAMADO TÉCNICO', nomeCompleto, telefone, `Status do equipamento não disponível.\n📋 Protocolo: ${protocolo}`);
  }
}

async function handlePagou(cliente, telefone, nome, nomeCompleto, idCliente) {
  const cpf = cliente.cpf_cnpj ? cliente.cpf_cnpj.replace(/\D/g, '') : null;
  const dados = cpf ? await buscarClientePorCpf(cpf) : await buscarClientePorId(idCliente);
  const contrato = dados.success
    ? (Array.isArray(dados.contratos) ? dados.contratos[0] : dados.contratos)
    : null;

  // Verificar se o cliente usa liberação em confiança e se ainda pode usar
  const podeLiberar = contrato?.clienteLiberadoConfianca === 0 && contrato?.usouLiberacaoConfianca === 0;
  const jaLiberado  = contrato?.clienteLiberadoConfianca === 1;
  const jaUsou      = contrato?.usouLiberacaoConfianca === 1;
  const valorAberto = parseFloat(contrato?.contratoValorAberto || 0);
  const temDebito   = valorAberto > 0;

  console.log('[PAGOU] podeLiberar:', podeLiberar, '| jaLiberado:', jaLiberado, '| jaUsou:', jaUsou, '| valorAberto:', valorAberto);

  if (!contrato || !temDebito) {
    // Sem débito — já está pago
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    await enviarMensagem(telefone, `*${nome}*, não encontrei nenhum débito em aberto no seu cadastro. Tudo certo por aqui! ✅\n\nSe a conexão não voltou, pode ser processamento do banco. Tenta reiniciar o roteador 😊`);
    return;
  }

  if (jaLiberado) {
    // Já está em liberação
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    await enviarMensagem(telefone, `*${nome}*, sua liberação em confiança já está ativa! Quando o pagamento compensar o sistema atualiza automaticamente. ✅`);
    return;
  }

  if (jaUsou && !podeLiberar) {
    // Já usou a liberação antes
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    await enviarMensagem(telefone, `*${nome}*, infelizmente você já utilizou a liberação em confiança anteriormente. Nossa equipe vai verificar o pagamento manualmente e liberar assim que confirmado! ⏳\n\nSe tiver comprovante, pode enviar aqui 😊`);
    await alertarRafa('💰', 'CLIENTE DISSE QUE PAGOU', nomeCompleto, telefone, `Débito: R$ ${valorAberto.toFixed(2)}\nJÁ USOU liberação em confiança antes — verificar manualmente!`);
    return;
  }

  // Pode liberar — perguntar se quer
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_liberacao' });
  await enviarMensagem(telefone, `Que ótimo, *${nome}*! 🎉\n\nAinda identifico um valor de *R$ ${valorAberto.toFixed(2).replace('.', ',')}* em aberto no sistema. Enquanto o pagamento não compensa, posso fazer uma *liberação em confiança* para sua internet voltar agora mesmo.\n\nDeseja que eu libere sua conexão? (Sim / Não)`);
}

async function handleLiberacaoConfirmada(cliente, telefone, nome, nomeCompleto, idCliente) {
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
  await enviarMensagem(telefone, `Perfeito, *${nome}*! Aguarda um momento enquanto processo a liberação... ⚙️`);

  try {
    // Chamar endpoint oficial de notificação de pagamento / liberação em confiança
    const libData = await notificacaoPagamento(idCliente, telefone);
    console.log('[LIBERACAO] Resposta:', JSON.stringify(libData));

    if (libData?.liberado || libData?.status === 1) {
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'liberacao_confianca', '', 'resolvido', true);
      await enviarMensagem(telefone, `✅ *${nome}*, sua conexão foi liberada em confiança!\n\nSua internet deve voltar em alguns minutos. Reinicia o roteador se ainda não voltar.\n\nObrigado por ser nosso cliente! 💙`);
    } else {
      throw new Error(libData?.msg || 'Falha na liberação');
    }
  } catch (err) {
    console.error('[LIBERACAO] Erro:', err.message);
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'liberacao_confianca', '', 'erro_api', false);
    await enviarMensagem(telefone, `*${nome}*, não consegui processar a liberação automaticamente agora. Nossa equipe vai verificar manualmente e te liberar em breve! 🙏`);
    await alertarRafa('💰', 'LIBERAÇÃO EM CONFIANÇA SOLICITADA', nomeCompleto, telefone, `Cliente confirmou pagamento e pediu liberação em confiança.\nLIBERAR MANUALMENTE no painel do Receitanet!`);
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
// ENDPOINT /encerrar — chamado pelo painel para encerrar atendimento humano
// ═════════════════════════════════════════════════════════════════════════════
// ─── Endpoint: health/ping ─────────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Endpoint: dados do dashboard (acesso service role) ────────────────────
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';
function authMiddleware(req, res, next) {
  const key = req.headers['x-service-key'];
  if (DASHBOARD_SECRET && key !== DASHBOARD_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/dashboard-data', authMiddleware, async (req, res) => {
  try {
    const [atendimentos, clientes] = await Promise.all([
      dbFilter('Atendimento', { limit: 500, sort: '-data_atendimento' }),
      dbFilter('ClienteWhatsapp', { limit: 500 })
    ]);
    res.json({
      success: true,
      atendimentos: Array.isArray(atendimentos) ? atendimentos : [],
      clientes: Array.isArray(clientes) ? clientes : []
    });
  } catch (e) {
    console.error('[dashboard-data] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/encerrar', authMiddleware, async (req, res) => {
  try {
    const { telefone } = req.body;
    if (!telefone) return res.json({ ok: false, error: 'telefone obrigatório' });

    const tel = telefone.startsWith('55') ? telefone : '55' + telefone;
    await enviarMensagem(tel, `Atendimento encerrado! Se precisar de mais alguma coisa, é só chamar 😊`);
    console.log('[ENCERRAR] Mensagem enviada para', tel);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ENCERRAR] Erro:', err.message);
    res.json({ ok: false, error: err.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO — RELATÓRIO DIÁRIO AUTOMÁTICO
// ═════════════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');

const RELATORIOS_DIR = path.join(__dirname, 'relatorios');
if (!fs.existsSync(RELATORIOS_DIR)) fs.mkdirSync(RELATORIOS_DIR, { recursive: true });

async function gerarRelatorioDiario(dataAlvo) {
  // dataAlvo: 'YYYY-MM-DD' (default: ontem)
  const hoje     = new Date();
  const ontem    = dataAlvo ? new Date(dataAlvo + 'T00:00:00-03:00') : new Date(hoje.getTime() - 86400000);
  const inicio   = new Date(ontem); inicio.setHours(0,0,0,0);
  const fim      = new Date(ontem); fim.setHours(23,59,59,999);
  const dataStr  = ontem.toISOString().slice(0,10);
  const diaSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][ontem.getDay()];

  console.log(`[RELATORIO] Gerando relatório de ${dataStr}...`);

  // Buscar dados
  const [atendimentos, clientes] = await Promise.all([
    dbFilter('Atendimento', { limit: 500, sort: '-data_atendimento' }),
    dbFilter('ClienteWhatsapp', { limit: 500 })
  ]);

  const ats = Array.isArray(atendimentos) ? atendimentos : [];
  const cls = Array.isArray(clientes)     ? clientes     : [];

  // Filtrar por período
  const doDia = ats.filter(a => {
    const d = new Date(a.data_atendimento || a.created_date);
    return d >= inicio && d <= fim;
  });

  // Métricas
  const total           = doDia.length;
  const resolvidos      = doDia.filter(a => a.resolvido === true || a.estado_final === 'resolvido').length;
  const encaminhados    = doDia.filter(a => a.estado_final === 'encaminhado_atendente').length;
  const emAberto        = doDia.filter(a => ['em_andamento','encaminhado_atendente'].includes(a.estado_final)).length;
  const taxaResolucao   = total > 0 ? Math.round((resolvidos / total) * 100) : 0;

  // Motivos
  const motivoMap = {};
  for (const a of doDia) {
    const m = a.motivo || 'não_identificado';
    motivoMap[m] = (motivoMap[m] || 0) + 1;
  }
  const motivosOrdenados = Object.entries(motivoMap).sort((a,b) => b[1]-a[1]);

  // Clientes únicos
  const telefonesUnicos = [...new Set(doDia.map(a => a.telefone))];
  const clientesNovos   = cls.filter(c => {
    const d = new Date(c.created_date);
    return d >= inicio && d <= fim;
  }).length;

  // Horários de pico
  const horarios = {};
  for (const a of doDia) {
    const h = new Date(a.data_atendimento || a.created_date).getHours();
    const faixa = `${String(h).padStart(2,'0')}:00`;
    horarios[faixa] = (horarios[faixa] || 0) + 1;
  }
  const picoHorario = Object.entries(horarios).sort((a,b)=>b[1]-a[1])[0];

  // Atendimentos sem resolução (pendentes)
  const pendentes = doDia.filter(a => emAberto && ['em_andamento','encaminhado_atendente'].includes(a.estado_final));

  // ─── Montar relatório em texto ────────────────────────────────────────────
  const linhas = [
    `╔══════════════════════════════════════════════════════════╗`,
    `║        RELATÓRIO DIÁRIO — PSIU TELECOM                  ║`,
    `║        ${diaSemana}, ${dataStr}                                  ║`.slice(0,65) + '║',
    `╚══════════════════════════════════════════════════════════╝`,
    ``,
    `📊 RESUMO GERAL`,
    `─────────────────────────────────────────`,
    `  Total de atendimentos : ${total}`,
    `  Clientes únicos       : ${telefonesUnicos.length}`,
    `  Clientes novos        : ${clientesNovos}`,
    `  Resolvidos pelo bot   : ${resolvidos} (${taxaResolucao}%)`,
    `  Encaminhados (humano) : ${encaminhados}`,
    `  Em aberto ao final    : ${emAberto}`,
    `  Horário de pico       : ${picoHorario ? picoHorario[0] + ' (' + picoHorario[1] + ' msgs)' : 'n/a'}`,
    ``,
    `📋 MOTIVOS DOS ATENDIMENTOS`,
    `─────────────────────────────────────────`,
    ...motivosOrdenados.map(([m, qtd]) => {
      const barra = '█'.repeat(Math.min(Math.round(qtd/total*20),20));
      return `  ${m.padEnd(25)} ${String(qtd).padStart(3)}  ${barra}`;
    }),
    ``,
    `⏰ DISTRIBUIÇÃO POR HORA`,
    `─────────────────────────────────────────`,
    ...Object.entries(horarios).sort().map(([h, qtd]) => {
      const barra = '█'.repeat(Math.min(qtd, 30));
      return `  ${h}  ${barra} (${qtd})`;
    }),
  ];

  if (pendentes.length > 0) {
    linhas.push(``, `⚠️  ATENDIMENTOS PENDENTES (${pendentes.length})`);
    linhas.push(`─────────────────────────────────────────`);
    for (const p of pendentes.slice(0,10)) {
      linhas.push(`  • ${p.nome_cliente || p.telefone} — ${p.motivo || '?'} (${p.estado_final})`);
    }
  }

  linhas.push(``, `─────────────────────────────────────────`);
  linhas.push(`Gerado automaticamente às ${new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})}`);
  linhas.push(`Para análise: envie este arquivo ao agente IA no painel PSIU.`);

  const conteudo = linhas.join('\n');
  const nomeArquivo = `relatorio_${dataStr}.txt`;
  const caminhoArquivo = path.join(RELATORIOS_DIR, nomeArquivo);
  fs.writeFileSync(caminhoArquivo, conteudo, 'utf8');

  console.log(`[RELATORIO] ✅ Salvo em: ${caminhoArquivo}`);
  return { conteudo, nomeArquivo, caminhoArquivo, dataStr, total, resolvidos, encaminhados, emAberto, taxaResolucao };
}

// ─── Cron interno: todo dia à meia-noite (horário de Brasília = 03:00 UTC) ──
function agendarRelatorioDiario() {
  const agora   = new Date();
  const brasilia = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const amanha  = new Date(brasilia);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(0, 0, 30, 0); // 00:00:30 de Brasília
  const diffMs  = amanha.getTime() - brasilia.getTime();
  console.log(`[RELATORIO] Próximo relatório em ${Math.round(diffMs/60000)} minutos.`);
  setTimeout(async () => {
    try { await gerarRelatorioDiario(); } catch(e) { console.error('[RELATORIO] Erro:', e.message); }
    agendarRelatorioDiario(); // reagendar para o próximo dia
  }, diffMs);
}
agendarRelatorioDiario();

// ─── Endpoint: baixar relatório do dia (ou de uma data específica) ──────────
app.get('/relatorio', authMiddleware, async (req, res) => {
  try {
    const data = req.query.data; // ex: ?data=2026-04-10
    const hoje  = new Date();
    const ontem = new Date(hoje.getTime() - 86400000);
    const dataStr = data || ontem.toISOString().slice(0,10);
    const arquivo  = path.join(RELATORIOS_DIR, `relatorio_${dataStr}.txt`);

    if (!fs.existsSync(arquivo)) {
      // Gerar agora se não existir
      const r = await gerarRelatorioDiario(dataStr);
      res.setHeader('Content-Disposition', `attachment; filename="${r.nomeArquivo}"`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(r.conteudo);
    }

    res.setHeader('Content-Disposition', `attachment; filename="relatorio_${dataStr}.txt"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(fs.readFileSync(arquivo, 'utf8'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Endpoint: forçar geração de relatório agora (útil p/ teste) ─────────────
app.post('/relatorio/gerar', authMiddleware, async (req, res) => {
  try {
    const data = req.body.data; // opcional
    const r = await gerarRelatorioDiario(data);
    res.json({ ok: true, arquivo: r.nomeArquivo, total: r.total, resolvidos: r.resolvidos, encaminhados: r.encaminhados, emAberto: r.emAberto, taxaResolucao: r.taxaResolucao });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// START
// ═════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
