const express = require('express');
const FormData = require('form-data');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RECEITANET_CHATBOT_TOKEN = process.env.RECEITANET_CHATBOT_TOKEN || '';
const RECEITANET_BASE = 'https://sistema.receitanet.net/api/novo/chatbot';
const BASE44_APP_ID = '69d55fd1a341508858f11d46';

const ZAPI_INSTANCE = '3F15DC3330DCC11BF2A3BE4FDF68D33E';
const ZAPI_TOKEN = '0BD8484CB7BFF2DAD22E99B5';
const ZAPI_CLIENT_TOKEN = 'Fe4e0f41827564db0813cd79b7c5f6e96S';
const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;
const RAFA_PHONE = '5519999619605';

const BASE44_API = `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities`;

// ── DB helpers ────────────────────────────────────────────────────────────────
async function dbFilter(entity, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.append(k, v);
  const url = `${BASE44_API}/${entity}?${params.toString()}`;
  console.log('[DB] GET', url.substring(0, 120));
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN || ''}`, 'Content-Type': 'application/json' }
  });
  return await res.json();
}

async function dbCreate(entity, data) {
  const res = await fetch(`${BASE44_API}/${entity}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function dbUpdate(entity, id, data) {
  const res = await fetch(`${BASE44_API}/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${process.env.BASE44_SERVICE_TOKEN || ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

// ── Receitanet helpers ────────────────────────────────────────────────────────
async function buscarClientePorTelefone(phone) {
  const res = await fetch(`${RECEITANET_BASE}/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', phone })
  });
  return await res.json();
}

async function buscarClientePorCpf(cpfcnpj) {
  const cpf = cpfcnpj.replace(/\D/g, '');
  const res = await fetch(`${RECEITANET_BASE}/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', cpfcnpj: cpf })
  });
  return await res.json();
}

async function buscarBoletos(idCliente, contato) {
  const res = await fetch(`${RECEITANET_BASE}/boletos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', idCliente, contato, tipo: 'sms' })
  });
  return await res.json();
}

async function verificarEquipamento(idCliente) {
  const res = await fetch(`${RECEITANET_BASE}/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', idCliente })
  });
  return await res.json();
}

async function abrirChamado(idCliente, contato) {
  const res = await fetch(`${RECEITANET_BASE}/abertura-chamado`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', idCliente, contato, ocorrenciatipo: 1, motivoos: 1 })
  });
  return await res.json();
}

// ── Z-API ─────────────────────────────────────────────────────────────────────
async function enviarMensagem(telefone, mensagem) {
  let numero = telefone.replace(/\D/g, '');
  if (!numero.startsWith('55')) numero = '55' + numero;
  const res = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numero, message: mensagem })
  });
  const data = await res.json();
  console.log('Z-API envio:', JSON.stringify(data).substring(0, 150));
  return data;
}

// ── Transcrição de áudio via Groq ────────────────────────────────────────────
async function transcreverAudio(audioUrl) {
  try {
    console.log('[GROQ] Baixando áudio:', audioUrl);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Erro ao baixar áudio: ' + audioRes.status);
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    console.log('[GROQ] Áudio baixado, tamanho:', buffer.length, 'bytes');
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
    console.error('[GROQ] Erro transcrição:', e.message);
    return null;
  }
}

// ── Extrair dados do webhook ──────────────────────────────────────────────────
function extrairDados(body) {
  if (body.isGroupMsg === true || body.fromMe === true) return { telefone: '', mensagem: '', audioUrl: null };
  let phone = String(body.phone || body.from || '').replace(/\D/g, '').replace(/@.*$/, '');
  if (phone.length === 11) phone = '55' + phone;
  if (phone.length === 10) phone = '55' + phone;
  let mensagem = '';
  if (body.text && typeof body.text === 'object') mensagem = String(body.text.message || '');
  else mensagem = String(body.message || body.content || body.body || '');
  let audioUrl = null;
  // Z-API pode mandar áudio em body.audio, body.audioUrl, ou como type=AudioMessage
  if (body.audio) audioUrl = body.audio.audioUrl || body.audio.url || null;
  if (!audioUrl && body.audioUrl) audioUrl = body.audioUrl;
  if (!audioUrl && body.type === 'AudioMessage' && body.audio) audioUrl = body.audio;
  // Log completo quando áudio detectado
  if (audioUrl) console.log('[AUDIO] URL detectada:', audioUrl);
  if (!audioUrl && mensagem === '' && body.type === 'ReceivedCallback') {
    // Tentar extrair URL de qualquer campo que contenha 'audio' ou 'media'
    const bodyStr = JSON.stringify(body);
    const audioMatch = bodyStr.match(/"(https?:[^"]*\.(?:ogg|mp3|mp4|wav|opus|m4a|aac)[^"]*)"/i);
    if (audioMatch) { audioUrl = audioMatch[1]; console.log('[AUDIO] URL extraída do body:', audioUrl); }
  }
  console.log('[EXTRACT]', { phone, mensagem: mensagem.substring(0,50), audioUrl: audioUrl ? 'SIM' : 'NAO', type: body.type });
  return { telefone: phone, mensagem, audioUrl };
}

// ── Classificação de intenção por linguagem natural ───────────────────────────
function classificarIntencao(msg) {
  const m = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (m.match(/boleto|fatura|pagar|pagamento|pix|segunda via|vencimento|debito|cobranca|conta/)) return 'boleto';
  if (m.match(/sem internet|sem sinal|caiu|lento|travando|sem conexao|fibra|rompimento|nao funciona|parou|reinici|modem|roteador|luz vermelha|luz piscando|vermelho|offline|caiu a net|net caiu|sem net|sem wifi|wifi|signal/)) return 'suporte';
  if (m.match(/cancelar|cancelamento|quero cancelar|desistir|nao quero mais/)) return 'cancelamento';
  if (m.match(/falar com|atendente|humano|pessoa|responsavel|gerente|contrato|plano|instalar|instalacao|mudanca|mudei|novo cliente|quero assinar|quero contratar/)) return 'atendente';
  return 'outro';
}

// ── Verificar horário do atendente ────────────────────────────────────────────
function atendenteDisponivel() {
  const horaBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dia = horaBR.getDay(); // 0=dom, 6=sab
  const hora = horaBR.getHours();
  return dia >= 1 && dia <= 5 && hora >= 9 && hora < 20;
}

function horaAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

// ── Alerta para o Rafa ────────────────────────────────────────────────────────
async function alertarRafa(emoji, titulo, nome, telefone, extra) {
  const hora = horaAtual();
  await enviarMensagem(RAFA_PHONE, `${emoji} *${titulo}*\n\n⏰ ${hora}\n👤 Cliente: *${nome}*\n📞 Fone: ${telefone.replace('55', '')}\n${extra}`);
}

// ── Webhook principal ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('PSIU TELECOM Webhook - OK'));
app.get('/webhook', (req, res) => res.send('PSIU TELECOM Webhook - OK'));

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook:', JSON.stringify(body).substring(0, 2000));

    const { telefone, mensagem: mensagemTexto, audioUrl } = extrairDados(body);

    // Transcrever áudio
    let mensagemRecebida = mensagemTexto;
    if (audioUrl && !mensagemTexto) {
      const transcricao = await transcreverAudio(audioUrl);
      if (transcricao) {
        mensagemRecebida = transcricao;
        console.log('Transcrição:', transcricao);
      } else {
        if (telefone) await enviarMensagem(telefone, `Recebi seu áudio mas não consegui entender. Pode digitar sua mensagem? 😊`);
        return res.json({ ok: true });
      }
    }

    if (!telefone || !mensagemRecebida) return res.json({ ok: true });

    console.log('[WEBHOOK]', { telefone, msg: mensagemRecebida.substring(0, 100) });

    // Buscar cliente no banco
    let clientesLocal = await dbFilter('ClienteWhatsapp', { telefone });
    if (!Array.isArray(clientesLocal) || clientesLocal.length === 0) {
      const telSem55 = telefone.startsWith('55') ? telefone.slice(2) : telefone;
      clientesLocal = await dbFilter('ClienteWhatsapp', { telefone: telSem55 });
      if (Array.isArray(clientesLocal) && clientesLocal.length > 0) {
        await dbUpdate('ClienteWhatsapp', clientesLocal[0].id, { telefone });
      }
    }
    let clienteLocal = Array.isArray(clientesLocal) && clientesLocal.length > 0 ? clientesLocal[0] : null;

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCO 1 — CLIENTE NÃO IDENTIFICADO
    // ═══════════════════════════════════════════════════════════════════════════
    if (!clienteLocal || !clienteLocal.identificado) {

      // Tentar identificar pelo telefone automaticamente
      const resultadoBusca = await buscarClientePorTelefone(telefone);
      if (resultadoBusca.success && resultadoBusca.contratos && resultadoBusca.contratos.idCliente) {
        // Encontrou — salvar e continuar para o fluxo principal
        const dadosCliente = {
          telefone,
          id_cliente_receitanet: String(resultadoBusca.contratos.idCliente),
          nome: resultadoBusca.contratos.razaoSocial || '',
          cpf_cnpj: resultadoBusca.contratos.cpfCnpj || '',
          identificado: true,
          ultimo_contato: new Date().toISOString(),
          estado_conversa: 'identificado'
        };
        if (clienteLocal) {
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
        } else {
          clienteLocal = await dbCreate('ClienteWhatsapp', dadosCliente);
        }
        // Vai direto para o processamento natural abaixo
      } else {
        // Não encontrou pelo telefone — verificar estado da conversa
        const estado = clienteLocal ? clienteLocal.estado_conversa : null;

        // Estado: aguardando resposta se é cliente (sim/nao)
        if (estado === 'aguardando_eh_cliente') {
          const resp = mensagemRecebida.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const ehSim = resp.match(/^(sim|s|yes|sou|ja|já|cliente|sou cliente|claro|confirmo)/);
          const ehNao = resp.match(/^(nao|n|no|não|novo|quero ser|quero contratar|me tornar)/);

          if (ehSim) {
            // É cliente — pedir CPF
            await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_cpf' });
            await enviarMensagem(telefone, `Tudo bem! Me informa seu *CPF ou CNPJ* pra eu localizar seu cadastro 😊`);
          } else if (ehNao) {
            // Novo cliente — encaminhar para atendente
            await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'atendente_novo_cliente' });
            await dbCreate('Atendimento', { telefone, nome_cliente: 'Novo Cliente', motivo: 'novo_cliente', mensagem_original: mensagemRecebida, estado_final: 'encaminhado_atendente', data_atendimento: new Date().toISOString(), resolvido: false });
            if (atendenteDisponivel()) {
              await enviarMensagem(telefone, `Que ótimo, seja bem-vindo(a)! 🎉\n\nVou te conectar com nosso time de vendas agora. Um atendente entrará em contato em breve!`);
            } else {
              await enviarMensagem(telefone, `Que ótimo, seja bem-vindo(a)! 🎉\n\nNosso horário de atendimento é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, um atendente entrará em contato para te apresentar nossos planos! 😊`);
            }
            await alertarRafa('🆕', 'NOVO CLIENTE INTERESSADO', 'Novo Cliente', telefone, `📲 Quer contratar a PSIU! Entre em contato.`);
          } else {
            // Resposta não entendida
            await enviarMensagem(telefone, `Desculpe, não entendi. Você já é *cliente da PSIU*?\n\nResponda *sim* ou *não* 😊`);
          }
          return res.json({ ok: true });
        }

        // Estado: aguardando CPF
        if (estado === 'aguardando_cpf') {
          const cpfLimpo = mensagemRecebida.replace(/\D/g, '');
          if (cpfLimpo.length >= 11) {
            const resultadoCpf = await buscarClientePorCpf(cpfLimpo);
            if (resultadoCpf.success && resultadoCpf.contratos && resultadoCpf.contratos.idCliente) {
              const dadosCpf = {
                telefone,
                id_cliente_receitanet: String(resultadoCpf.contratos.idCliente),
                nome: resultadoCpf.contratos.razaoSocial || '',
                cpf_cnpj: cpfLimpo,
                identificado: true,
                ultimo_contato: new Date().toISOString(),
                estado_conversa: 'identificado'
              };
              await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCpf);
              clienteLocal = { ...clienteLocal, ...dadosCpf };
              // Vai direto para processamento
            } else {
              await enviarMensagem(telefone, `Hmm, não encontrei nenhum cadastro com esse CPF. 😕\n\nVerifica se digitou certo ou fala com nosso time: *(19) 3167-2161*`);
              return res.json({ ok: true });
            }
          } else {
            await enviarMensagem(telefone, `Me passa o *CPF ou CNPJ* (só os números) pra eu localizar seu cadastro 😊`);
            return res.json({ ok: true });
          }
        } else {
          // Primeiro contato — perguntar se já é cliente
          let registro = clienteLocal;
          if (!registro) {
            registro = await dbCreate('ClienteWhatsapp', {
              telefone, identificado: false, ultimo_contato: new Date().toISOString(), estado_conversa: 'aguardando_eh_cliente'
            });
          } else {
            await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'aguardando_eh_cliente', ultimo_contato: new Date().toISOString() });
          }
          await enviarMensagem(telefone, `Olá! 👋 Bem-vindo(a) à *PSIU TELECOM*!\n\nVocê já é nosso cliente?`);
          return res.json({ ok: true });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCO 2 — CLIENTE IDENTIFICADO — PROCESSAMENTO NATURAL
    // ═══════════════════════════════════════════════════════════════════════════
    await dbUpdate('ClienteWhatsapp', clienteLocal.id, { ultimo_contato: new Date().toISOString() });

    const idCliente = clienteLocal.id_cliente_receitanet;
    const nome = (clienteLocal.nome || 'cliente').split(' ')[0];
    const nomeCompleto = clienteLocal.nome || 'cliente';
    const intencao = classificarIntencao(mensagemRecebida);

    console.log('[INTENCAO]', intencao, '| estado:', clienteLocal.estado_conversa);

    // ── Detectar massiva (múltiplos chamados de suporte em pouco tempo) ───────
    if (intencao === 'suporte') {
      const trintaMinAtras = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const chamadosRecentes = await dbFilter('Atendimento', { motivo: 'suporte' });
      const qtd = Array.isArray(chamadosRecentes) ? chamadosRecentes.filter(c => c.data_atendimento > trintaMinAtras).length : 0;
      if (qtd >= 3) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'massiva' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'massiva', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `Oi, *${nome}*! 😔 Identificamos uma instabilidade na rede que pode estar afetando sua região.\n\nNossa equipe já foi acionada e está trabalhando na resolução.\n\n⏱️ *Previsão: até 5 horas* — te avisamos assim que normalizar. Pedimos desculpas! 🙏`);
        if (qtd === 3) await alertarRafa('🚨🚨🚨', 'MASSIVA DETECTADA!', nomeCompleto, telefone, `👥 Clientes afetados: *${qtd + 1}*\n\nVários clientes estão sem internet! Verifique o roteador/fibra com URGÊNCIA.\n⚡ Clientes já sendo avisados automaticamente.`);
        return res.json({ ok: true });
      }
    }

    // ── BOLETO ────────────────────────────────────────────────────────────────
    if (intencao === 'boleto') {
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'identificado' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'boleto', mensagem_original: mensagemRecebida, estado_final: 'resolvido', data_atendimento: new Date().toISOString(), resolvido: true });

      // Buscar dados atualizados do cliente via API (já inclui faturasEmAberto)
      const cpfCliente = clienteLocal.cpf_cnpj ? clienteLocal.cpf_cnpj.replace(/\D/g, '') : null;
      const dadosCliente = cpfCliente
        ? await buscarClientePorCpf(cpfCliente)
        : await buscarClientePorTelefone(telefone);

      console.log('[BOLETO] Dados cliente:', JSON.stringify(dadosCliente).substring(0, 400));

      const faturas = dadosCliente?.contratos?.faturasEmAberto;
      if (dadosCliente.success && faturas && faturas.length > 0) {
        let msg = `Olá, *${nome}*! Aqui estão suas faturas em aberto:\n\n`;
        for (const f of faturas.slice(0, 3)) {
          const dataVenc = f.vencimento ? new Date(f.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
          msg += `📅 *Vencimento:* ${dataVenc}\n💰 *Valor:* R$ ${parseFloat(f.valor).toFixed(2).replace('.', ',')}\n`;
          if (f.url) msg += `\n🔗 *Link do Boleto:*\n${f.url}\n`;
          if (f.urlPixCopiaCola) msg += `\n💳 *PIX Copia e Cola:*\n${f.urlPixCopiaCola}\n`;
          if (f.urlBoletoCopiaCola) msg += `\n🔢 *Linha Digitável:*\n${f.urlBoletoCopiaCola}\n`;
          msg += '\n';
        }
        await enviarMensagem(telefone, msg.trim());
      } else if (dadosCliente.success) {
        await enviarMensagem(telefone, `Boa notícia, *${nome}*! ✅ Não há nenhuma fatura em aberto na sua conta. Tudo em dia!`);
      } else {
        await enviarMensagem(telefone, `*${nome}*, não consegui carregar sua fatura agora. Tenta novamente em alguns minutos ou fala com nosso time: *(19) 3167-2161* 😊`);
      }
      return res.json({ ok: true });
    }

    // ── SUPORTE TÉCNICO ───────────────────────────────────────────────────────
    if (intencao === 'suporte') {
      // Verificar equipamento
      const dadosEquip = await verificarEquipamento(idCliente);
      const equipOnline = dadosEquip.success && dadosEquip.contratos && !dadosEquip.contratos.servidor?.isManutencao;
      const luzVermelha = mensagemRecebida.toLowerCase().match(/luz vermelha|vermelho|piscando/);

      if (luzVermelha) {
        // Falha física na fibra
        const chamado = await abrirChamado(idCliente, telefone);
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'chamado_aberto' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'suporte_campo', mensagem_original: mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `*${nome}*, luz vermelha indica um problema na fibra que precisamos verificar presencialmente. 🔴\n\nJá abri um chamado técnico para visita! Nossa equipe entrará em contato em breve para agendar.\n\n📋 Protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}`);
        await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `⚠️ Luz vermelha piscando — falha na fibra!\n📋 Protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}`);
      } else if (equipOnline) {
        // Equipamento online mas cliente sem internet
        const chamado = await abrirChamado(idCliente, telefone);
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'chamado_aberto' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `*${nome}*, verifiquei aqui e seu equipamento aparece online no nosso sistema. Pode ser uma instabilidade momentânea. 🔄\n\nTenta reiniciar o roteador: *desliga da tomada por 30 segundos e liga novamente.*\n\nSe não resolver, já abri um chamado técnico (protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}). Nossa equipe vai verificar remotamente! 🔧`);
        await alertarRafa('🟡', 'CHAMADO TÉCNICO', nomeCompleto, telefone, `Equipamento aparece *online* mas cliente sem internet.\n📋 Protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}`);
      } else {
        // Equipamento offline
        const chamado = await abrirChamado(idCliente, telefone);
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'chamado_aberto' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `*${nome}*, verifiquei e seu equipamento está aparecendo *offline* no nosso sistema. 📡\n\nPrimeiro, tenta reiniciar: *desliga o roteador da tomada por 30 segundos e liga de novo.*\n\nJá abri um chamado técnico (protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}). Se não resolver após reiniciar, nossa equipe entra em contato! 🔧`);
        await alertarRafa('🔴', 'CHAMADO DE CAMPO', nomeCompleto, telefone, `Equipamento *offline*.\n📋 Protocolo: ${chamado.protocolo || chamado.idSuporte || 'gerado'}`);
      }
      return res.json({ ok: true });
    }

    // ── CANCELAMENTO ──────────────────────────────────────────────────────────
    if (intencao === 'cancelamento' && clienteLocal.estado_conversa !== 'cancelamento_retencao') {
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'cancelamento_retencao' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'cancelamento', mensagem_original: mensagemRecebida, estado_final: 'em_andamento', data_atendimento: new Date().toISOString(), resolvido: false });
      await enviarMensagem(telefone, `*${nome}*, ficamos tristes em saber disso. 😔\n\nAntes de tomar essa decisão, qual o motivo? Às vezes conseguimos resolver!\n\n💰 Valor\n🔧 Problema técnico\n📦 Mudança de endereço\n💬 Outro motivo\n\nMe conta que vejo o que posso fazer por você 😊`);
      await alertarRafa('⚠️', 'SOLICITAÇÃO DE CANCELAMENTO', nomeCompleto, telefone, `O bot está tentando reter. Acompanhe!`);
      return res.json({ ok: true });
    }

    if (clienteLocal.estado_conversa === 'cancelamento_retencao') {
      const msg = mensagemRecebida.toLowerCase();
      let msgRetencao = '';
      if (msg.match(/valor|caro|preco|preço|dinheiro|financeiro/)) {
        msgRetencao = `Entendo, *${nome}*! 💙 Temos algumas opções:\n\n🎁 *Carência especial* — pausar sua conta por até 30 dias\n💳 *Renegociação* — parcelar débitos\n📦 *Ajuste de plano* — planos mais acessíveis\n\nUm atendente vai entrar em contato para te apresentar as opções. Aguarda? 😊`;
      } else if (msg.match(/tecnico|internet|sinal|lento|problema|nao funciona/)) {
        msgRetencao = `*${nome}*, se o motivo é técnico, a gente quer resolver! 🔧\n\nAbri um chamado prioritário para nossa equipe entrar em contato hoje. Não precisa cancelar por isso!\n\nAguarda que um técnico vai te chamar em breve 😊`;
      } else if (msg.match(/mudanca|mudança|mudei|endereço|endereco|outra cidade/)) {
        msgRetencao = `*${nome}*, dependendo do novo endereço conseguimos levar a PSIU até você! 🏠\n\nUm atendente vai verificar se temos cobertura na nova região e te contata. Tudo bem? 😊`;
      } else {
        msgRetencao = `Entendido, *${nome}*! Vou passar para um atendente que pode conversar melhor sobre sua situação.\n\nAguarda, alguém entra em contato em breve! 🙏`;
      }
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'atendente' });
      await enviarMensagem(telefone, msgRetencao);
      return res.json({ ok: true });
    }

    // ── ATENDENTE ─────────────────────────────────────────────────────────────
    if (intencao === 'atendente') {
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'atendente' });
      await dbCreate('Atendimento', { telefone, nome_cliente: nomeCompleto, id_cliente_receitanet: idCliente, motivo: 'atendente', mensagem_original: mensagemRecebida, estado_final: 'encaminhado_atendente', data_atendimento: new Date().toISOString(), resolvido: false });
      if (atendenteDisponivel()) {
        await enviarMensagem(telefone, `*${nome}*, vou te transferir para um atendente agora! 👤\n\nAguarda um momento que alguém entra em contato em breve 😊`);
      } else {
        await enviarMensagem(telefone, `*${nome}*, registrei sua solicitação! 📋\n\nNosso horário de atendimento humano é *seg-sex das 9h às 20h*. Assim que nossa equipe chegar, entraremos em contato com você 😊`);
      }
      await alertarRafa('👤', 'CLIENTE QUER ATENDENTE', nomeCompleto, telefone, `Solicitou atendimento humano.`);
      return res.json({ ok: true });
    }

    // ── Estado: aguardando resposta do suporte (reiniciou?) ───────────────────
    if (clienteLocal.estado_conversa === 'chamado_aberto') {
      const msg = mensagemRecebida.toLowerCase();
      if (msg.match(/funcionou|resolveu|voltou|ta ok|tá ok|ok|certo|funcionando|obrigad/)) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'identificado' });
        await enviarMensagem(telefone, `Ótimo, *${nome}*! Fico feliz que resolveu! 😄\n\nSe precisar de mais alguma coisa, é só falar. Estou aqui! 🙌`);
      } else {
        await enviarMensagem(telefone, `Entendi, *${nome}*. Nossa equipe técnica já está ciente e vai entrar em contato em breve! 🔧\n\nSe quiser falar com um atendente agora, é só me dizer 😊`);
      }
      return res.json({ ok: true });
    }

    // ── Resposta padrão / saudação ────────────────────────────────────────────
    await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'identificado' });
    await enviarMensagem(telefone, `Oi, *${nome}*! 😊 Como posso te ajudar hoje?\n\nPode me dizer o que precisa — *boleto*, *problema com internet*, ou qualquer outra dúvida!`);
    return res.json({ ok: true });

  } catch (err) {
    console.error('ERRO no webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PSIU Webhook rodando na porta ${PORT}`));
