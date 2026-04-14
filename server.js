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

// ── Auto-renovação de token Base44 ──────────────────────────────────────────
let _cachedToken = process.env.BASE44_SERVICE_TOKEN || '';
let _tokenExpAt  = 0;  // timestamp Unix de expiração

function _parseTokenExp(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return decoded.exp || 0;
  } catch { return 0; }
}

// Inicializar com token do boot
if (_cachedToken) _tokenExpAt = _parseTokenExp(_cachedToken);

async function _renovarToken() {
  // Token é renovado via automação externa (Base44 agent) que chama POST /update-token
  // Esta função é placeholder — a renovação real vem de fora
  console.warn('[TOKEN] Token expirado — aguardando renovação via automação externa...');
  return false;
}

async function getServiceToken() {
  const agora = Date.now() / 1000;
  // Renovar se faltar menos de 10 minutos ou já expirou
  if (_tokenExpAt && (_tokenExpAt - agora) < 600) {
    console.log('[TOKEN] Expira em breve, renovando...');
    await _renovarToken();
  }
  return _cachedToken || process.env.BASE44_SERVICE_TOKEN || '';
}

// ═════════════════════════════════════════════════════════════════════════════
// MÓDULO 1 — DB (Base44)
// ═════════════════════════════════════════════════════════════════════════════
async function dbFilter(entity, query) {
  const params = new URLSearchParams(query).toString();
  const url = `${BASE44_API}/${entity}?${params}`;
  console.log('[DB] GET', url.substring(0, 120));
  const res = await fetchWithTimeout(url, {
    headers: { 'Authorization': `Bearer ${await getServiceToken()}`, 'Content-Type': 'application/json' }
  }, 8000);
  return safeJson(res);
}

async function dbCreate(entity, data) {
  const res = await fetchWithTimeout(`${BASE44_API}/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await getServiceToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }, 8000);
  return safeJson(res);
}

async function dbUpdate(entity, id, data) {
  const res = await fetchWithTimeout(`${BASE44_API}/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${await getServiceToken()}`, 'Content-Type': 'application/json' },
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

function ehCpfOuCnpj(texto) {
  const numeros = texto.replace(/\D/g, '');
  return numeros.length === 11 || numeros.length === 14;
}

const buscarClientePorTelefone = (phone) => { const phoneSem55 = phone.startsWith('55') ? phone.slice(2) : phone; return receitanetPost('clientes', { phone: phoneSem55 }); };
const buscarClientePorCpf      = (cpfcnpj)   => receitanetPost('clientes', { cpfcnpj: cpfcnpj.replace(/\D/g, '') });
const buscarClientePorId       = (idCliente) => receitanetPost('clientes', { idCliente });
const abrirChamado             = (idCliente, contato, descricao) => {
  const desc = descricao || 'Chamado aberto via chatbot';
  return receitanetPost('abertura-chamado', {
    idCliente,
    contato,
    ocorrenciatipo: 1,
    motivoos: 1,
    servicos: desc,
    obs: desc,
    descricao: desc,
    observacao: desc
  });
};
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
function respostaHumana(tipo, nome) {
  const n = nome || 'cliente';
  const r = {
    aguarde: [
      `Só um instante que já estou verificando pra você... 👀`,
      `Aguarda um pouquinho, já vejo isso aqui 🔍`,
      `Deixa comigo, já estou checando... ⚙️`,
      `Um momento, deixa eu verificar aqui pra você! 🔧`,
      `Já estou olhando isso aqui... um segundo! 👨‍💻`
    ],
    saudacao: [
      `Oi, *${n}*! Tudo bem? 😊`,
      `Olá, *${n}*! Como posso te ajudar hoje? 🤝`,
      `Fala, *${n}*! Vamos resolver isso! 👍`,
      `Oi, *${n}*! O que posso fazer por você? 😊`
    ],
    chamado_aberto: [
      `Já abri o chamado pra você, *${n}*! Nossa equipe vai verificar 🔧`,
      `Chamado registrado, *${n}*! A equipe técnica já foi acionada 🛠️`,
      `Pronto, *${n}*! Equipe notificada e já está de olho 📋`
    ],
    verificando_equip: [
      `Estou verificando o status do seu equipamento agora, *${n}*... ⏳`,
      `Deixa eu checar sua conexão aqui no sistema, *${n}*! 🔍`,
      `Um segundo, *${n}*! Estou olhando o status da sua rede... 📡`
    ],
    empatia: [
      `Entendo, *${n}*! Isso é bem chato mesmo. Deixa comigo 🙏`,
      `Puxa, *${n}*, sinto muito por isso. Vamos resolver agora! 💪`,
      `Entendido, *${n}*! Vou priorizar isso pra você agora 🔥`
    ]
  };
  const lista = r[tipo] || [];
  return lista.length ? lista[Math.floor(Math.random() * lista.length)] : '';
}

function detectarIrritacao(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Palavras fortes (alta irritação)
  if (m.match(/merda|porra|caralho|lixo|pessimo|horrivel|ridiculo|inferno|droga|desgraça|idiota|incompetente/)) return 'alta';

  // Frustração com atendimento
  if (m.match(/nao resolve|nao adianta|ninguem responde|so enrola|nao ajuda|nao funciona esse atendimento|cancelar|quero cancelar|vou cancelar/)) return 'alta';

  // Reclamações diretas
  if (m.match(/nao funciona|nao presta|internet ruim|toda hora cai|vive caindo|so cai|instavel|lento demais|horrivel|nao aguento/)) return 'media';

  // CAPS LOCK (raiva) — mais de 10 chars em maiúsculo
  if (msg === msg.toUpperCase() && msg.replace(/[^A-Za-z]/g,'').length > 8) return 'media';

  // Exclamações/interrogações excessivas
  if (msg.includes('!!!') || msg.includes('???') || (msg.match(/!/g)||[]).length >= 3) return 'media';

  return false;
}

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

    // ── DETECTAR IRRITAÇÃO DO CLIENTE ─────────────────────────────────────────
    const nivelIrritacao = detectarIrritacao(mensagemRecebida);
    if (nivelIrritacao) {
      console.log('[HUMOR] Cliente irritado nível:', nivelIrritacao, '| msg:', mensagemRecebida.substring(0, 60));

      // Buscar cliente se já existir (para ter o nome)
      let clienteTemp = null;
      try {
        const listaTemp = await dbFilter('ClienteWhatsapp', { telefone });
        if (Array.isArray(listaTemp) && listaTemp.length > 0) clienteTemp = listaTemp[0];
      } catch {}
      const nomeTemp = clienteTemp?.nome ? primeiroNome(clienteTemp.nome) : 'cliente';

      if (nivelIrritacao === 'alta') {
        // Prioridade máxima — encaminhar para atendente humano imediatamente
        await enviarMensagem(telefone,
          `Entendo sua frustração, *${nomeTemp}* 😕

Vou te colocar em *prioridade máxima* com um atendente agora para resolver isso o mais rápido possível. Aguarda um instante! 🙏`
        );
        await alertarRafa('🔥', 'CLIENTE IRRITADO — PRIORIDADE', nomeTemp, telefone, `Mensagem: "${mensagemRecebida}"`);
        if (clienteTemp?.id) {
          await dbUpdate('ClienteWhatsapp', clienteTemp.id, { estado_conversa: 'atendente', ultimo_contato: new Date().toISOString() });
          await registrarAtendimento(telefone, clienteTemp.nome || nomeTemp, clienteTemp.id_cliente_receitanet || null, 'irritacao_alta', mensagemRecebida, 'encaminhado_atendente', false);
        }
        return;
      }

      // Irritação média — suavizar, mas continuar o fluxo normalmente
      // Não retorna — deixa o fluxo normal tratar a mensagem
      // O contexto de irritação será capturado pelo fluxo abaixo
    }

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

    // ── INTERCEPTOR CPF: detectar CPF/CNPJ ANTES de qualquer rota ─────────────
    // Se o cliente NÃO está identificado e enviou algo que parece CPF/CNPJ → buscar direto
    if (!cliente?.id_cliente_receitanet && ehCpfOuCnpj(mensagemRecebida)) {
      console.log('[CPF_INTERCEPT] Detectado CPF/CNPJ na entrada:', mensagemRecebida.replace(/\D/g,'').substring(0,14));
      const resultadoCpf = await buscarClientePorCpf(mensagemRecebida);
      if (resultadoCpf.success && resultadoCpf.contratos?.idCliente) {
        const msgOriginal = cliente?.mensagem_original_pre_cpf || null;
        const dados = {
          telefone,
          id_cliente_receitanet: String(resultadoCpf.contratos.idCliente),
          nome: resultadoCpf.contratos.razaoSocial || '',
          cpf_cnpj: mensagemRecebida.replace(/\D/g,''),
          identificado: true,
          ultimo_contato: new Date().toISOString(),
          estado_conversa: 'identificado',
          mensagem_original_pre_cpf: null
        };
        if (cliente) {
          await dbUpdate('ClienteWhatsapp', cliente.id, dados);
          cliente = { ...cliente, ...dados };
        } else {
          cliente = await dbCreate('ClienteWhatsapp', dados);
        }
        console.log('[CPF_INTERCEPT] Cliente identificado:', dados.nome, '| id:', dados.id_cliente_receitanet);
        // Usar mensagem original (antes do CPF) para dar continuidade ao atendimento
        await handleClienteIdentificado(cliente, telefone, msgOriginal || mensagemRecebida);
        return;
      } else {
        // CPF não encontrado no Receitanet — contar tentativas
        const tentativas = (cliente?.cpf_tentativas || 0) + 1;
        if (!cliente) {
          cliente = await dbCreate('ClienteWhatsapp', {
            telefone, identificado: false,
            ultimo_contato: new Date().toISOString(),
            estado_conversa: 'aguardando_cpf',
            cpf_tentativas: 1
          });
        } else {
          await dbUpdate('ClienteWhatsapp', cliente.id, {
            estado_conversa: 'aguardando_cpf',
            ultimo_contato: new Date().toISOString(),
            cpf_tentativas: tentativas
          });
          cliente = { ...cliente, estado_conversa: 'aguardando_cpf', cpf_tentativas: tentativas };
        }
        console.log('[CPF_INTERCEPTOR] CPF não encontrado | tentativa:', tentativas);
        if (tentativas >= 2) {
          // Após 2 tentativas falhas → encaminhar para atendente
          await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_atendente', cpf_tentativas: 0 });
          await enviarMensagem(telefone,
            `Não consegui localizar esse CPF/CNPJ. 😕\n\n` +
            `Não se preocupe! Vou chamar um atendente da nossa equipe para te ajudar. Aguarda um momento... 🙏`
          );
          await alertarRafa('⚠️', 'CPF NÃO LOCALIZADO', telefone, telefone,
            `Cliente enviou CPF/CNPJ 2x mas não foi encontrado no Receitanet.\nNúmero tentado: ${mensagemRecebida.replace(/\D/g,'').substring(0,14)}\nAtender manualmente!`
          );
        } else {
          await enviarMensagem(telefone, `Não encontrei nenhum cadastro com esse CPF/CNPJ. 😕

Pode ter acontecido um errinho de digitação — tenta mandar só os números novamente.

Ou se preferir, é só digitar *atendente* que a nossa equipe te ajuda na hora! 👋`);
        }
        return;
      }
    }

    // ── ROTA 1: cliente JÁ identificado no banco → atender direto ─────────────
    // Esta é a rota principal. Se temos id_cliente_receitanet, NUNCA pedimos CPF.
    if (cliente?.id_cliente_receitanet) {
      if (!cliente.identificado) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { identificado: true, estado_conversa: 'identificado' });
        cliente = { ...cliente, identificado: true, estado_conversa: 'identificado' };
      }
      await dbUpdate('ClienteWhatsapp', cliente.id, { ultimo_contato: new Date().toISOString(), ultima_mensagem: mensagemRecebida.substring(0, 200) });
      cliente = { ...cliente, ultima_mensagem: mensagemRecebida };
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
        dados.ultima_mensagem = mensagemRecebida.substring(0, 200);
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
// MÓDULO 8 — IDENTIFICAÇÃO POR CPF (com contexto de intenção)
// ═════════════════════════════════════════════════════════════════════════════
async function handleIdentificacaoPorCpf(cliente, telefone, mensagem) {
  const cpf = mensagem.replace(/\D/g, '');

  // ── 1. Detectar se a mensagem É um CPF/CNPJ ───────────────────────────────
  if (cpf.length >= 11 && cpf.length <= 14) {
    console.log('[CPF] Recebido CPF/CNPJ:', cpf.substring(0, 14));
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
        mensagem_original_pre_cpf: null
      };
      const msgOriginal = cliente.mensagem_original_pre_cpf || mensagem;
      await dbUpdate('ClienteWhatsapp', cliente.id, dados);
      cliente = { ...cliente, ...dados };
      console.log('[CPF] Identificado! Redirecionando para intenção original:', msgOriginal.substring(0, 80));
      await handleClienteIdentificado(cliente, telefone, msgOriginal);
      return;
    } else {
      // CPF não encontrado — contar tentativas
      const tentativas2 = (cliente?.cpf_tentativas || 0) + 1;
      await dbUpdate('ClienteWhatsapp', cliente.id, { cpf_tentativas: tentativas2 });
      console.log('[CPF_HANDLER] CPF não encontrado | tentativa:', tentativas2);
      if (tentativas2 >= 2) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_atendente', cpf_tentativas: 0 });
        await enviarMensagem(telefone,
          `Não consegui localizar esse CPF/CNPJ. 😕\n\n` +
          `Não se preocupe! Vou chamar um atendente da nossa equipe para te ajudar. Aguarda um momento... 🙏`
        );
        await alertarRafa('⚠️', 'CPF NÃO LOCALIZADO', telefone, telefone,
          `Cliente enviou CPF/CNPJ 2x mas não foi encontrado no Receitanet.\nNúmero tentado: ${mensagem.replace(/\D/g,'').substring(0,14)}\nAtender manualmente!`
        );
      } else {
        await enviarMensagem(telefone,
          `Não encontrei cadastro com esse CPF/CNPJ. 😕\n\n` +
          `Verifica se está correto. Se preferir, nossa equipe pode te ajudar: basta digitar *atendente*!`
        );
      }
      return;
    }
  }

  // ── 2. Mensagem NÃO é CPF → classificar intenção primeiro ─────────────────
  const intencao = await classificarIntencao(mensagem);
  console.log('[CPF_INTENT]', intencao, '| estado:', cliente.estado_conversa, '| msg:', mensagem.substring(0, 50));

  // Salvar mensagem original para usar depois que identificar
  const jaTemMsgOriginal = !!cliente.mensagem_original_pre_cpf;
  if (!jaTemMsgOriginal) {
    await dbUpdate('ClienteWhatsapp', cliente.id, { mensagem_original_pre_cpf: mensagem });
    cliente = { ...cliente, mensagem_original_pre_cpf: mensagem };
  }

  // ── Quer falar com atendente ───────────────────────────────────────────────
  if (intencao === 'atendente' || /atendente|humano|pessoa real|falar com/i.test(mensagem)) {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'atendente_novo_cliente' });
    await enviarMensagem(telefone,
      `Tudo bem! 😊 Vou te passar para um atendente.\n\n` +
      `Nosso horário é *seg-sex das 9h às 20h*. Em breve alguém te responde!`
    );
    await registrarAtendimento(telefone, 'Cliente não identificado', null, 'novo_cliente', mensagem, 'encaminhado_atendente', false);
    return;
  }

  // ── Dúvida geral (sem precisar de cadastro) ───────────────────────────────
  if (intencao === 'duvida') {
    return handleDuvida(cliente, telefone, mensagem, null);
  }

  // ── Interesse comercial (quer contratar) ──────────────────────────────────
  if (intencao === 'comercial') {
    return handleComercial(cliente, telefone, mensagem, null);
  }

  // ── INTENÇÃO ESPECÍFICA → pedir CPF de forma CONTEXTUAL (não genérica) ────
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_cpf', ultimo_contato: new Date().toISOString() });

  // Mensagem personalizada por intenção — humanizada e direta
  if (intencao === 'pagou') {
    await enviarMensagem(telefone,
      `Entendi! 👍 Se você já realizou o pagamento, pode ser que ainda esteja em processamento.\n\n` +
      `Para eu verificar certinho pra você, pode me informar seu *CPF ou CNPJ*? 😊`
    );
    return;
  }

  if (intencao === 'boleto') {
    await enviarMensagem(telefone,
      `Claro, vou te ajudar com isso! 💰\n\n` +
      `Para localizar sua fatura, preciso do seu *CPF ou CNPJ* (só os números). Pode mandar? 😊`
    );
    return;
  }

  if (intencao === 'suporte') {
    await enviarMensagem(telefone,
      `Que chato, vou te ajudar agora! 🔧\n\n` +
      `Só preciso te localizar no sistema primeiro. Me passa seu *CPF ou CNPJ*? (pode ser só os números)`
    );
    return;
  }

  if (intencao === 'cancelamento') {
    await enviarMensagem(telefone,
      `Entendido. 😔 Para eu verificar seu cadastro e te ajudar com isso, preciso do seu *CPF ou CNPJ*.\n\n` +
      `Pode me passar?`
    );
    return;
  }

  // Já está esperando CPF (segunda mensagem sem CPF) → mensagem mais direta
  if (cliente.estado_conversa === 'aguardando_cpf') {
    await enviarMensagem(telefone,
      `Pode me enviar seu *CPF ou CNPJ* (só os números) para eu te localizar no sistema? 😊`
    );
    return;
  }

  // Primeiro contato genérico
  await enviarMensagem(telefone,
    `Olá! 👋 Aqui é a *PSIU TELECOM*.\n\n` +
    `Para te ajudar, preciso localizar seu cadastro. Pode me passar seu *CPF ou CNPJ*? 😊\n\n` +
    `Se quiser falar com um atendente, é só digitar *atendente*!`
  );
}

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

  // ── AGUARDANDO REINÍCIO: cliente pediu para reiniciar e está esperando resposta ──
  if (estado === 'aguardando_reinicio') {
    const msgNorm = mensagem.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const voltou  = msgNorm.match(/voltei|voltou|reiniciei|reinicializei|liguei|funcionou|ta funcionando|voltou a internet|voltou internet|sim|ok|pronto|feito|ja fiz|fiz isso/);
    const naoVoltou = msgNorm.match(/nao voltou|nao funcionou|ainda nao|continua|mesmo problema|nao resolveu|nada|nao|n$/);

    if (voltou) {
      await enviarMensagem(telefone, `Perfeito, *${nome}*! Vou verificar novamente sua conexão... 🔄`);
      const acesso2 = await verificarAcesso(idCliente, telefone);

      if (acesso2?.status === 1) {
        // ✅ Voltou! Fechar sem abrir chamado
        await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
        await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'resolvido', true);
        await enviarMensagem(telefone, `Ótimo, *${nome}*! ✅ Sua conexão está *online* e normalizada!

Se precisar de mais alguma coisa é só chamar 😊`);
        console.log('[REINICIO] Resolvido sem chamado para', telefone);
        return;
      } else {
        // ❌ Ainda offline → agora sim abre chamado
        const descricaoOS = `Equipamento offline após reinicialização. Cliente confirmou reinício mas conexão não voltou.`;
        const chamado2 = await abrirChamado(idCliente, telefone, descricaoOS);
        const protocolo2 = chamado2.protocolo || chamado2.idSuporte || 'gerado';
        await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'chamado_aberto' });
        await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'chamado_aberto', false);
        await enviarMensagem(telefone, `*${nome}*, ainda não normalizou 😕

Abri um chamado técnico para nossa equipe verificar presencialmente.

📋 *Protocolo: ${protocolo2}*

Guarde esse número! Nossa equipe entrará em contato em breve.`);
        await alertarRafa('🔴', 'NÃO VOLTOU APÓS REINÍCIO', nomeCompleto, telefone, `Reiniciou mas não voltou. Chamado aberto.
📋 Protocolo: ${protocolo2}`);
        return;
      }
    }

    if (naoVoltou) {
      // Não tentou reiniciar ou confirmou que não voltou → chamado imediato
      const descricaoOS2 = `Equipamento offline. Cliente informou que não voltou após tentativa de reinicialização.`;
      const chamado3 = await abrirChamado(idCliente, telefone, descricaoOS2);
      const protocolo3 = chamado3.protocolo || chamado3.idSuporte || 'gerado';
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'chamado_aberto' });
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'chamado_aberto', false);
      await enviarMensagem(telefone, `Entendido, *${nome}* 😕

Abri um chamado técnico com prioridade para nossa equipe ir até você!

📋 *Protocolo: ${protocolo3}*

Guarde esse número. Nossa equipe entrará em contato em breve!`);
      await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `Cliente confirmou que não voltou após reinício.
📋 Protocolo: ${protocolo3}`);
      return;
    }

    // Mensagem ambígua no estado aguardando_reinicio → lembrar de reiniciar
    await enviarMensagem(telefone, `*${nome}*, conseguiu reiniciar o roteador? Basta desligar da tomada por 30 segundos e ligar de volta 🔌

Me avisa quando fizer! 😊`);
    return;
  }

  // ── CONFIRMAR REINICIALIZAÇÃO: cliente voltou após chamado ─────────────────
  if (estado === 'chamado_aberto') {
    const msgNorm = mensagem.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const voltou   = msgNorm.match(/voltou|voltei|reiniciei|reinicializei|liguei|desliguei|funcionou|ta funcionando|voltou internet|voltou a internet|sim|ok|pronto|feito|feito isso|fiz isso|desliguei|ja fiz|ja reiniciei/);
    const naoVoltou = msgNorm.match(/nao voltou|nao funcionou|ainda nao|continua|mesmo problema|nao resolveu|nada/);

    if (voltou) {
      // Verificar se realmente voltou via API
      const acesso = await verificarAcesso(idCliente, telefone);
      if (acesso?.status === 1) {
        await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
        // Baixa automática no chamado aberto
        try {
          const abertos = await dbFilter('Atendimento', { telefone, limit: 10 });
          const lista = Array.isArray(abertos) ? abertos : [];
          for (const at of lista.filter(a => a.estado_final === 'chamado_aberto' && !a.resolvido)) {
            await dbUpdate('Atendimento', at.id, { estado_final: 'resolvido', resolvido: true });
          }
        } catch {}
        await enviarMensagem(telefone, `Ótimo, *${nome}*! Confirmei aqui que sua conexão está online novamente ✅

Qualquer coisa é só chamar! 😊`);
        return;
      } else {
        await enviarMensagem(telefone, `*${nome}*, ainda estou vendo instabilidade aqui no sistema 😕

Nossa equipe já está verificando. Te aviso assim que resolver! Se piorar, manda mensagem.`);
        return;
      }
    }

    if (naoVoltou) {
      await enviarMensagem(telefone, `Entendido, *${nome}* 😕 Nossa equipe técnica está no caso. Já alertei como prioritário!

Se não resolver em breve, você quer que eu agende uma visita técnica?`);
      await alertarRafa('⚡', 'CHAMADO SEM RESOLUÇÃO', nomeCompleto, telefone, `Cliente diz que não resolveu após chamado aberto.`);
      return;
    }

    // Qualquer outra coisa com chamado aberto → IA conversacional
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

  // ── Resolver contexto antes de classificar — 'sim/ok' ambíguo ──────────────
  let mensagemEfetiva = mensagem;
  const ultimaMsgCtx = cliente?.ultima_mensagem || '';
  if (/^(sim|ok|s|yes|claro|pode|vai|pronto|feito)$/i.test(mensagem.trim()) && ultimaMsgCtx) {
    // Transformar em mensagem descritiva baseada no contexto
    if (ultimaMsgCtx.match(/reinici|deslig|roteador|tomada/i)) {
      mensagemEfetiva = 'cliente confirmou que reiniciou o roteador';
      console.log('[CTX] Resolvendo sim → confirmação reinicialização');
    } else if (ultimaMsgCtx.match(/boleto|fatura|pagar|pix/i)) {
      mensagemEfetiva = 'cliente confirma que quer o boleto';
      console.log('[CTX] Resolvendo sim → boleto confirmado');
    } else if (ultimaMsgCtx.match(/chamado|tecnico|equipe|visita/i)) {
      mensagemEfetiva = 'cliente confirmou chamado técnico';
      console.log('[CTX] Resolvendo sim → chamado confirmado');
    }
  }

  // ── Classificar intenção para ações que precisam de lógica especial ─────────
  const intencao = await classificarIntencao(mensagemEfetiva);
  console.log('[INTENCAO]', intencao, '| estado:', estado, '| telefone:', telefone, '| msgEfetiva:', mensagemEfetiva.substring(0,40));

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
  if (intencao === 'suporte')           return handleSuporte(cliente, telefone, mensagemEfetiva, nome, nomeCompleto, idCliente);

  // Se irritação média detectada e chegou até aqui → enriquecer resposta da IA com empatia
  if (detectarIrritacao(mensagem) === 'media' && intencao === 'duvida') {
    await enviarMensagem(telefone, `Entendi, *${nome}* 🙏 Deixa eu te ajudar agora mesmo!`);
    // continua para IA conversacional normalmente
  }
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
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'verificar_conexao', mensagemEfetiva, 'resolvido', true);
      await enviarMensagem(telefone, `*${nome}*, acabei de verificar: seu equipamento está *online* ✅\n\nSe ainda estiver com lentidão, tenta reiniciar o roteador: desliga da tomada por 30 segundos e liga de novo. Se persistir, abro um chamado! 🔧`);
    } else if (acesso?.status === 2) {
      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
    } else {
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'verificar_conexao', mensagemEfetiva, 'em_andamento', false);
      await enviarMensagem(telefone, `*${nome}*, não consegui verificar o status agora. Se estiver com problema de internet me diga que abro um chamado técnico! 🔧`);
    }
    return;
  }

  // ── Para tudo mais (dúvidas, saudações, comercial, conversa) → IA conversacional ──
  return handleIAConversacional(cliente, telefone, mensagemEfetiva, nome, nomeCompleto, idCliente, intencao, cliente.mensagem_original_pre_cpf);
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

  // Registrar atendimento para qualquer interação via IA conversacional
  await registrarAtendimento(telefone, nomeCompleto, idCliente, intencao || 'duvida', mensagem, 'resolvido', true);

  // Contexto de conversa: usar última_mensagem para resolver "sim/não" ambíguos
  const ultimaMensagem = cliente?.ultima_mensagem || '';
  const contextoConv = ultimaMensagem && ultimaMensagem !== mensagem
    ? `
Última mensagem do cliente (para contexto): "${ultimaMensagem}"`
    : '';

  try {
    const prompt = `Você é um atendente virtual da PSIU TELECOM, empresa de internet por fibra óptica em Mogi Mirim e região (SP).

PERSONALIDADE: Educado, natural, humano — como um atendente real no WhatsApp. Warm, direto, sem formalidades excessivas. Nunca robótico. Sempre que possível, use o nome do cliente de forma natural.

CONTEXTO DO CLIENTE:
- Nome: ${nomeCompleto}
- É cliente cadastrado: sim${contextoConv}

REGRAS ABSOLUTAS (NUNCA QUEBRE):
1. NUNCA mencione IDs, números internos, sistemas, banco de dados, código ou processos técnicos internos.
2. NUNCA diga "vou verificar seu ID", "buscando no sistema", "localizando cadastro" — você é um atendente humano.
3. Se for saudação (oi, olá, bom dia, boa tarde): responda com calor e pergunte como pode ajudar de forma NATURAL. Jamais liste menus ou opções numeradas.
4. Se for dúvida técnica (fibra, modem, velocidade, etc.): explique de forma simples e didática.
5. Se for pergunta sobre planos ou preços: diga que temos planos de fibra óptica e que um atendente pode passar os valores atualizados.
6. Seja SEMPRE conciso: máximo 3 linhas por resposta.
7. Se o cliente mencionar pagamento ou fatura, responda de forma humana e empática — NÃO diga que vai verificar no sistema.
8. Jamais use listas numeradas ou bullet points — pareça humano de verdade.
9. Se a mensagem atual for "sim" ou "ok" e houver contexto da última mensagem, responda de acordo com esse contexto — não pergunte de novo.
10. Nunca repita o que você acabou de dizer ou pergunte a mesma coisa duas vezes.

Mensagem atual do cliente: "${mensagem}"`;

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

  // Proativo: avisar que está consultando antes de chamar a API
  await enviarMensagem(telefone, respostaHumana('aguarde', nome));

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

  // Proativo: avisar que está verificando ANTES de chamar a API (evita silêncio)
  await enviarMensagem(telefone, respostaHumana('verificando_equip', nome));

  // Usar endpoint /verificar-acesso — retorna status: 1=online, 2=offline
  const acesso = await verificarAcesso(idCliente, telefone);
  const statusAcesso = acesso?.status; // 1=online, 2=offline, undefined=erro
  const equipOnline  = statusAcesso === 1;
  const equipOffline = statusAcesso === 2;
  console.log('[EQUIP] idCliente:', idCliente, '| status:', statusAcesso, '| msg:', acesso?.msg, '| online:', equipOnline);

  // Montar descrição do problema para a OS
  let tipoProblema = 'Sem internet';
  if (luzVermelha)   tipoProblema = 'Luz vermelha no equipamento — possível falha na fibra';
  else if (equipOffline) tipoProblema = 'Equipamento offline — sem sinal';
  else if (equipOnline)  tipoProblema = 'Equipamento online mas cliente sem internet — instabilidade';
  const descricaoOS = `${tipoProblema}. Mensagem do cliente: "${mensagem.substring(0, 150)}"`;

  // 🔴 Luz vermelha = fibra com problema = chamado direto, sem pedir reinício
  if (luzVermelha) {
    const chamadoLv = await abrirChamado(idCliente, telefone, descricaoOS);
    const protocoloLv = chamadoLv.protocolo || chamadoLv.idSuporte || 'gerado';
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'chamado_aberto' });
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte_campo', mensagem, 'chamado_aberto', false);
    await enviarMensagem(telefone, `*${nome}*, luz vermelha indica um problema na fibra que precisamos verificar presencialmente. 🔴

Já abri um chamado técnico para visita! Nossa equipe entrará em contato em breve.

📋 *Protocolo: ${protocoloLv}*

Guarde esse número para acompanhar seu atendimento.`);
    await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `⚠️ Luz vermelha — falha na fibra!
📋 Protocolo: ${protocoloLv}`);
    return;
  }

  // 🟡/🔴 Online ou offline sem luz vermelha → pede reinício ANTES de abrir chamado
  if (equipOnline) {
    await enviarMensagem(telefone, `*${nome}*, seu equipamento aparece *online* no nosso sistema, mas pode estar com instabilidade. 🔄

Pode *desligar o roteador da tomada por 30 segundos* e ligar novamente? Me avisa quando fizer 😊`);
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_reinicio' });
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'em_andamento', false);
    return;
  }

  if (equipOffline) {
    await enviarMensagem(telefone, `*${nome}*, seu equipamento está *offline* no nosso sistema. 📡

Vamos tentar resolver rapidinho! Pode *desligar o roteador da tomada por 30 segundos* e ligar novamente? Me avisa quando fizer 😊`);
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_reinicio' });
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'em_andamento', false);
    return;
  }

  // Status desconhecido → pede reinício também (melhor tentar antes de abrir chamado)
  await enviarMensagem(telefone, `*${nome}*, vamos tentar resolver isso! Pode *desligar o roteador da tomada por 30 segundos* e ligar novamente? Me avisa quando fizer 😊`);
  await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'aguardando_reinicio' });
  await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'em_andamento', false);
}

async function handlePagou(cliente, telefone, nome, nomeCompleto, idCliente) {
  const cpf = cliente.cpf_cnpj ? cliente.cpf_cnpj.replace(/\D/g, '') : null;
  console.log('[PAGOU] Iniciando | nome:', nomeCompleto, '| cpf:', cpf?.substring(0,6), '| idCliente:', idCliente);
  const dados = cpf ? await buscarClientePorCpf(cpf) : await buscarClientePorId(idCliente);
  console.log('[PAGOU] Resposta API | success:', dados?.success, '| _error:', dados?._error, '| status:', dados?._status);
  const contrato = dados.success
    ? (Array.isArray(dados.contratos) ? dados.contratos[0] : dados.contratos)
    : null;
  
  // Se a API falhou (erro de conexão, timeout) — resposta humana sem expor o problema
  if (dados._error || (!dados.success && !contrato)) {
    console.log('[PAGOU] API indisponível ou CPF não encontrado — alertando Rafa');
    await enviarMensagem(telefone,
      `*${nome}*, recebi sua informação sobre o pagamento! 👍\n\n` +
      `Nossa equipe vai conferir e, caso ainda não tenha compensado, libera sua conexão manualmente. ⏳\n\n` +
      `Se tiver o comprovante, pode enviar aqui pra agilizar! 😊`
    );
    await alertarRafa('💰', 'CLIENTE DISSE QUE PAGOU', nomeCompleto, telefone,
      `Cliente diz que pagou mas não foi possível verificar automaticamente.\nVerifique manualmente no Receitanet!`
    );
    await registrarAtendimento(telefone, nomeCompleto, idCliente, 'pagamento', 'Cliente disse que pagou', 'encaminhado_atendente', false);
    return;
  }

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

// Endpoint para receber novo token da automação Base44
app.post('/update-token', (req, res) => {
  const { token, secret } = req.body || {};
  if (secret !== (process.env.UPDATE_TOKEN_SECRET || 'psiu2024')) {
    return res.status(403).json({ error: 'unauthorized' });
  }
  if (!token) return res.status(400).json({ error: 'token required' });
  _cachedToken = token;
  _tokenExpAt  = _parseTokenExp(token);
  console.log('[TOKEN] Atualizado via /update-token! Expira em:', Math.round((_tokenExpAt - Date.now()/1000)/60), 'min');
  res.json({ ok: true, exp: _tokenExpAt });
});
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
