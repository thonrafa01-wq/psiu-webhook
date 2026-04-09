'use strict';
const express = require('express');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — permite chamadas do painel Base44
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-service-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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
- "boleto": cliente quer segunda via, boleto, fatura ou PIX
- "pagou": cliente diz que já pagou, efetuou pagamento, realizou pagamento, fez o pix, pagou hoje
- "suporte": cliente relata problema ATUAL com internet, sem sinal, lento, caiu, equipamento, luz vermelha
- "resolvido": cliente diz que o problema foi resolvido, voltou, funcionou, conexão voltou, está ok agora
- "verificar_conexao": cliente quer saber o status da conexão, pede pra verificar se está online
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
  if (m.match(/boleto|fatura|pix|segunda via|vencimento|debito|cobranca|conta/)) return 'boleto';
  if (m.match(/j[aá] paguei|j[aá] pago|efetuei|realizei|fiz o pix|paguei hoje|paguei ontem|efetuou|realizou|confirmei pagamento/)) return 'pagou';
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

  // Delay humanizado: ~40 chars/segundo de "digitação", entre 2 e 12 segundos
  const chars = mensagem.replace(/\s+/g, '').length;
  const delaySegundos = Math.min(12, Math.max(2, Math.round(chars / 40)));

  const res = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numero, message: mensagem, delay: delaySegundos })
  });
  const data = await res.json();
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

  if (audioUrl) console.log('[AUDIO] URL detectada:', audioUrl);
  console.log('[EXTRACT]', { phone, mensagem: mensagem.substring(0, 50), audioUrl: !!audioUrl, type: body.type });

  return { telefone: phone, mensagem, audioUrl, fromMe: isFromMe || false };
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
    const { telefone, mensagem: mensagemTexto, audioUrl, fromMe } = extrairDados(req.body);

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
      // Telefone ainda não bate — ir para identificação por CPF
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
      estado_conversa: 'aguardando_cpf'
    });
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

  // ── MODO SILÊNCIO: cliente em atendimento humano — bot não interfere ────────
  if (estado === 'atendente' || estado === 'atendente_novo_cliente') {
    console.log('[SILENCIO] Cliente em atendimento humano — bot silenciado para', telefone);
    return;
  }

  // Classificar intenção via Groq
  const intencao = await classificarIntencao(mensagem);
  console.log('[INTENCAO]', intencao, '| estado:', estado);

  // ── Detecção de massiva ───────────────────────────────────────────────────
  if (intencao === 'suporte') {
    const trintaMinAtras = new Date(Date.now() - 120 * 60 * 1000).toISOString(); // janela de 2 horas
    const todosChamados  = await dbFilter('Atendimento', { motivo: 'suporte' });
    // Contar apenas CLIENTES DIFERENTES (excluindo o próprio) nos últimos 30min
    // Excluir o próprio cliente E o número do Rafa do contador de massiva
    const clientesRecentes = Array.isArray(todosChamados)
      ? [...new Set(
          todosChamados
            .filter(c => c.data_atendimento > trintaMinAtras
                      && c.telefone !== telefone
                      && c.telefone !== RAFA_PHONE
                      && c.telefone !== RAFA_PHONE.replace('55',''))
            .map(c => c.telefone)
        )]
      : [];
    const totalClientesDiferentes = clientesRecentes.length;

    console.log('[MASSIVA] Clientes diferentes nos últimos 30min (excluindo o atual):', totalClientesDiferentes);

    if (totalClientesDiferentes >= 3) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'massiva' });
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'massiva', false);
      await enviarMensagem(telefone, `Oi, *${nome}*! 😔 Identificamos uma instabilidade na rede que pode estar afetando sua região.\n\nNossa equipe já foi acionada e está trabalhando na resolução.\n\n⏱️ *Previsão: até 5 horas* — te avisamos assim que normalizar. Pedimos desculpas! 🙏`);
      if (totalClientesDiferentes === 3) {
        await alertarRafa('🚨🚨🚨', 'MASSIVA DETECTADA!', nomeCompleto, telefone, `👥 Clientes afetados: *${totalClientesDiferentes + 1}*\n\nVários clientes estão sem internet! Verifique com URGÊNCIA.\n⚡ Clientes já sendo avisados automaticamente.`);
      }
      return;
    }
  }

  // ── Estado: chamado aberto — aguardando feedback ──────────────────────────
  if (estado === 'chamado_aberto' && intencao !== 'boleto') {
    const m = mensagem.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const foiResolvido = intencao === 'resolvido' || m.match(/funcionou|resolveu|voltou|ta ok|tudo ok|tudo certo|ok|certo|funcionando|obrigad|resolvido|voltou a conexao|conexao voltou|aqui voltou|voltou aqui|ja voltou|internet voltou/);
    const querVerificar = intencao === 'verificar_conexao' || m.match(/verifica|verificar|conexao|online|offline|status|sinal|internet|minha net|minha conexao/);

    if (foiResolvido) {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
      await registrarAtendimento(telefone, nomeCompleto, idCliente, 'suporte', mensagem, 'resolvido', true);
      await enviarMensagem(telefone, `Que ótimo, *${nome}*! Fico feliz que voltou! 😄\n\nSe precisar de mais alguma coisa, é só falar! 🙌`);
    } else if (querVerificar) {
      const acesso = await verificarAcesso(idCliente, telefone);
      const statusAcesso = acesso?.status;
      if (statusAcesso === 1) {
        await enviarMensagem(telefone, `*${nome}*, verifiquei agora: seu equipamento está *online* ✅\n\nSe ainda estiver com instabilidade, tenta reiniciar o roteador: desliga da tomada por 30 segundos e liga novamente. Nossa equipe também está acompanhando! 🔧`);
      } else if (statusAcesso === 2) {
        await enviarMensagem(telefone, `*${nome}*, seu equipamento ainda aparece *offline* no nosso sistema. 📡\n\nNossa equipe técnica já foi acionada e vai entrar em contato em breve! Se quiser falar com um atendente agora, é só dizer.`);
      } else {
        await enviarMensagem(telefone, `*${nome}*, não consegui verificar o status agora. Nossa equipe já está ciente e vai te contatar em breve! 🔧`);
      }
    } else if (intencao === 'suporte') {
      // Novo relato de problema com chamado já aberto — informar que já tem chamado aberto
      await enviarMensagem(telefone, `Entendi, *${nome}*. Já temos um chamado aberto para você e nossa equipe técnica está trabalhando nisso! 🔧\n\nSe quiser falar com um atendente, é só dizer.`);
    } else {
      await enviarMensagem(telefone, `Entendi, *${nome}*. Nossa equipe técnica já está ciente e vai entrar em contato em breve! 🔧\n\nSe quiser falar com um atendente, é só dizer.`);
    }
    return;
  }

  // ── Estado: aguardando confirmação de liberação em confiança ──────────────
  if (estado === 'aguardando_liberacao') {
    const m = mensagem.toLowerCase();
    if (m.match(/sim|quero|pode|libera|confirmo|s[iì]m|yes|ok|certo/)) {
      return handleLiberacaoConfirmada(cliente, telefone, nome, nomeCompleto, idCliente);
    } else {
      await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
      await enviarMensagem(telefone, `Tudo bem, *${nome}*! Quando o pagamento compensar no sistema, sua conexão será liberada automaticamente. Se precisar de mais alguma coisa, é só chamar 😊`);
      return;
    }
  }

  // ── Estado: retenção de cancelamento ─────────────────────────────────────
  if (estado === 'cancelamento_retencao' && intencao !== 'boleto' && intencao !== 'suporte') {
    return handleRetencao(cliente, telefone, mensagem, nome);
  }

  // ── Intenções principais ──────────────────────────────────────────────────
  if (intencao === 'boleto')       return handleBoleto(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'pagou')        return handlePagou(cliente, telefone, nome, nomeCompleto, idCliente);
  if (intencao === 'suporte')      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'cancelamento') return handleCancelamento(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
  if (intencao === 'atendente')    return handleAtendente(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);

  if (intencao === 'verificar_conexao') {
    const acesso = await verificarAcesso(idCliente, telefone);
    const statusAcesso = acesso?.status;
    if (statusAcesso === 1) {
      await enviarMensagem(telefone, `*${nome}*, verifiquei agora: seu equipamento está *online* ✅\n\nSe estiver com alguma instabilidade, tenta reiniciar o roteador: desliga da tomada por 30 segundos e liga novamente. Se persistir, é só falar que abro um chamado! 🔧`);
    } else if (statusAcesso === 2) {
      return handleSuporte(cliente, telefone, mensagem, nome, nomeCompleto, idCliente);
    } else {
      await enviarMensagem(telefone, `*${nome}*, não consegui verificar o status agora. Se estiver com problema de internet, me diga e abro um chamado técnico! 🔧`);
    }
    return;
  }

  if (intencao === 'resolvido') {
    await dbUpdate('ClienteWhatsapp', cliente.id, { estado_conversa: 'identificado' });
    await enviarMensagem(telefone, `Que ótimo, *${nome}*! 😄 Se precisar de mais alguma coisa, é só falar! 🙌`);
    return;
  }

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
app.get('/dashboard-data', async (req, res) => {
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

app.post('/encerrar', async (req, res) => {
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
// START
// ═════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
