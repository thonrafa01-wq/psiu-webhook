const express = require('express');
const FormData = require('form-data');
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
const BASE44_API = `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities`;

async function dbFilter(entity, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.append(k, v);
  const url = `${BASE44_API}/${entity}?${params.toString()}`;
  console.log('[DB] GET', url, '| token:', BASE44_SERVICE_TOKEN ? BASE44_SERVICE_TOKEN.substring(0,20)+'...' : 'VAZIO');
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  console.log('[DB] GET result:', JSON.stringify(data).substring(0,200));
  return data;
}

async function dbCreate(entity, data) {
  const url = `${BASE44_API}/${entity}`;
  console.log('[DB] POST', url, JSON.stringify(data).substring(0,100));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BASE44_SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  console.log('[DB] POST result:', JSON.stringify(result).substring(0,200));
  return result;
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
  const res = await fetch(`${RECEITANET_BASE}/clientes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', phone })
  });
  return await res.json();
}

async function buscarClientePorCpf(cpfcnpj) {
  const cpf = cpfcnpj.replace(/\D/g, '');
  const res = await fetch(`${RECEITANET_BASE}/clientes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', cpfcnpj: cpf })
  });
  return await res.json();
}

async function buscarBoletos(idCliente, contato) {
  const res = await fetch(`${RECEITANET_BASE}/boletos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', idCliente, contato, tipo: 'whatsapp' })
  });
  return await res.json();
}

async function abrirChamado(idCliente, contato) {
  const res = await fetch(`${RECEITANET_BASE}/abertura-chamado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RECEITANET_CHATBOT_TOKEN, app: 'chatbot', idCliente, contato, ocorrenciatipo: 1, motivoos: 1 })
  });
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

async function transcreverAudio(audioUrl) {
  try {
    console.log('Baixando áudio:', audioUrl);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Erro ao baixar áudio: ' + audioRes.status);
    const audioBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(audioBuffer);

    const form = new FormData();
    form.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });
    const whisperData = await whisperRes.json();
    console.log('Whisper resposta:', JSON.stringify(whisperData).substring(0, 200));
    return whisperData.text || null;
  } catch (e) {
    console.error('Erro transcrição áudio:', e.message);
    return null;
  }
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
  // Detectar mensagem de áudio
  let audioUrl = null;
  if (body.type === 'ReceivedCallback' && body.audio) {
    audioUrl = body.audio.audioUrl || body.audio.url || null;
  } else if (body.audio && (body.audio.audioUrl || body.audio.url)) {
    audioUrl = body.audio.audioUrl || body.audio.url || null;
  }

  return { telefone: phone, mensagem, audioUrl };
}

// ── Webhook principal ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('PSIU TELECOM Webhook - OK'));
app.get('/webhook', (req, res) => res.send('PSIU TELECOM Webhook - OK'));

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook recebido:', JSON.stringify(body).substring(0, 500));

    const { telefone, mensagem: mensagemTexto, audioUrl } = extrairDados(body);

    // Transcrever áudio se necessário
    let mensagemRecebida = mensagemTexto;
    if (audioUrl && !mensagemTexto) {
      console.log('Áudio detectado, transcrevendo...');
      const transcricao = await transcreverAudio(audioUrl);
      if (transcricao) {
        mensagemRecebida = transcricao;
        console.log('Transcrição:', transcricao);
      } else {
        // Não conseguiu transcrever
        if (telefone) {
          const clientes = await dbFilter('ClienteWhatsapp', { telefone });
          const nome = clientes && clientes[0] && clientes[0].nome ? clientes[0].nome.split(' ')[0] : 'cliente';
          await enviarMensagem(telefone, `Oi, ${nome}! 😊 Recebi seu áudio mas tive dificuldade em entender. Pode digitar sua mensagem? Assim consigo te ajudar melhor!`);
        }
        return res.json({ ok: true, msg: 'audio nao transcrito' });
      }
    }

    if (!telefone || !mensagemRecebida) {
      return res.json({ ok: true, msg: 'sem dados relevantes' });
    }

    // Buscar cliente local no Base44
    const clientesLocal = await dbFilter('ClienteWhatsapp', { telefone });
    let clienteLocal = Array.isArray(clientesLocal) && clientesLocal.length > 0 ? clientesLocal[0] : null;

    // ── Cliente não identificado ──────────────────────────────────────────────
    if (!clienteLocal || !clienteLocal.identificado) {
      const resultadoBusca = await buscarClientePorTelefone(telefone);

      if (resultadoBusca.success && resultadoBusca.contratos && resultadoBusca.contratos.idCliente) {
        const dadosCliente = {
          telefone, id_cliente_receitanet: String(resultadoBusca.contratos.idCliente),
          nome: resultadoBusca.contratos.razaoSocial || '', cpf_cnpj: resultadoBusca.contratos.cpfCnpj || '',
          identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'menu'
        };
        if (clienteLocal) { await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente); clienteLocal = { ...clienteLocal, ...dadosCliente }; }
        else { clienteLocal = await dbCreate('ClienteWhatsapp', dadosCliente); }
        await dbCreate('Atendimento', { telefone, nome_cliente: resultadoBusca.contratos.razaoSocial || '', id_cliente_receitanet: String(resultadoBusca.contratos.idCliente), motivo: 'menu', mensagem_original: mensagemRecebida, estado_final: 'em_andamento', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `Olá, *${resultadoBusca.contratos.razaoSocial}*! 👋\n\nSou o assistente virtual da *PSIU TELECOM*. Como posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente\n\nDigite o número da opção ou descreva o que precisa.`);
        return res.json({ ok: true });
      }

      if (clienteLocal?.estado_conversa === 'aguardando_cpf') {
        const resultadoCpf = await buscarClientePorCpf(mensagemRecebida);
        if (resultadoCpf.success && resultadoCpf.contratos && resultadoCpf.contratos.idCliente) {
          const dadosCliente = { telefone, id_cliente_receitanet: String(resultadoCpf.contratos.idCliente), nome: resultadoCpf.contratos.razaoSocial || '', cpf_cnpj: resultadoCpf.contratos.cpfCnpj || '', identificado: true, ultimo_contato: new Date().toISOString(), estado_conversa: 'menu' };
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, dadosCliente);
          clienteLocal = { ...clienteLocal, ...dadosCliente };
          await enviarMensagem(telefone, `Ótimo, *${resultadoCpf.contratos.razaoSocial}*! ✅\n\nComo posso te ajudar?\n\n1️⃣ Segunda via de boleto/PIX\n2️⃣ Suporte técnico (sem internet)\n3️⃣ Falar com atendente`);
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
      // Verificar se é massiva (muitos chamados abertos recentemente)
      const agora = new Date();
      const cincoMinAtras = new Date(agora.getTime() - 5 * 60 * 1000).toISOString();
      const chamadosRecentes = await dbFilter('Atendimento', { motivo: 'suporte', estado_final: 'chamado_aberto' });
      const massiva = Array.isArray(chamadosRecentes) && chamadosRecentes.filter(c => c.data_atendimento >= cincoMinAtras).length >= 3;

      if (massiva) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'massiva', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `Oi, *${nome}*! 😔\n\nIdentificamos que estamos passando por uma instabilidade na rede que pode estar afetando sua região. Nossa equipe já foi acionada e está trabalhando na resolução.\n\n⏱️ *Previsão de normalização: até 5 horas* (podendo haver alterações conforme o andamento dos reparos).\n\nAssim que tudo for normalizado, você receberá uma mensagem aqui. Pedimos desculpas pelo transtorno! 🙏`);
        return res.json({ ok: true });
      }

      // Buscar dados atualizados do cliente pra verificar status do equipamento
      const dadosAtualizados = await buscarClientePorCpf(clienteLocal.cpf_cnpj || '');
      const ipOnline = dadosAtualizados.success && dadosAtualizados.contratos && dadosAtualizados.contratos.servidor && dadosAtualizados.contratos.servidor.ip;
      const emManutencao = dadosAtualizados.success && dadosAtualizados.contratos && dadosAtualizados.contratos.servidor && dadosAtualizados.contratos.servidor.isManutencao;

      if (emManutencao) {
        const msgManutencao = dadosAtualizados.contratos.servidor.mensagemManutencao || 'Estamos realizando uma manutenção programada na sua região.';
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'manutencao', data_atendimento: new Date().toISOString(), resolvido: false });
        await enviarMensagem(telefone, `Oi, *${nome}*! 🔧\n\n${msgManutencao}\n\nNossa equipe está trabalhando para concluir o mais rápido possível. Assim que normalizar, você será avisado por aqui. Obrigado pela paciência! 🙏`);
        return res.json({ ok: true });
      }

      if (ipOnline) {
        // Equipamento ONLINE — orientar reset antes de abrir chamado
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'suporte_aguardando_reset', ultimo_contato: new Date().toISOString() });
        await enviarMensagem(telefone, `Oi, *${nome}*! Verifiquei aqui e seu equipamento está aparecendo *online* nos nossos sistemas. 🟢\n\nMuitas vezes isso é resolvido com um simples reinício. Por favor, tente o seguinte:\n\n👉 *Desligue o equipamento da tomada, aguarde 2 minutinhos e ligue novamente.*\n\nApós religar, espera uns 3 minutinhos para a conexão estabilizar e me avisa se voltou! 😊`);
        return res.json({ ok: true });
      }

      // Equipamento OFFLINE — pedir verificação das luzes
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'suporte_verificando_luzes', ultimo_contato: new Date().toISOString() });
      await enviarMensagem(telefone, `Oi, *${nome}*! Verifiquei aqui e seu equipamento está aparecendo *offline* nos nossos sistemas. 🔴\n\nPreciso da sua ajuda pra entender melhor o que está acontecendo. Pode verificar as luzes do equipamento (roteador/ONU) pra mim?\n\n👀 *Está com alguma luz acesa?* Se sim, tem alguma *luz vermelha piscando*?\n\nMe conta o que você está vendo! 😊`);
      return res.json({ ok: true });
    }

    // Resposta pós-reset (cliente avisou se voltou ou não)
    if (clienteLocal.estado_conversa === 'suporte_aguardando_reset') {
      const voltou = mensagemRecebida.toLowerCase().match(/sim|voltou|funcionou|ok|tá|ta|funcionando|resolveu/);
      const naovoltou = mensagemRecebida.toLowerCase().match(/não|nao|continua|ainda|mesmo|problema|sem/);

      if (voltou) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
        await enviarMensagem(telefone, `Ótimo, *${nome}*! 🎉 Fico feliz que tenha resolvido!\n\nQualquer outra coisa é só me chamar. Tenha um ótimo dia! 😊`);
        return res.json({ ok: true });
      }

      if (naovoltou) {
        // Buscar status atualizado
        const dadosAgora = await buscarClientePorCpf(clienteLocal.cpf_cnpj || '');
        const aindaOnline = dadosAgora.success && dadosAgora.contratos && dadosAgora.contratos.servidor && dadosAgora.contratos.servidor.ip;
        if (aindaOnline) {
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
          await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
          const chamado2 = await abrirChamado(idCliente, telefone);
          await enviarMensagem(telefone, `Entendido, *${nome}*! 🔧 Mesmo com o equipamento aparecendo online daqui, algo pode estar instável. Abri um chamado pra nossa equipe verificar com mais cuidado.\n\n📋 *Protocolo: ${chamado2.protocolo || chamado2.idSuporte || 'gerado'}*\n\nEm breve um técnico entrará em contato. Qualquer dúvida é só chamar! 🙏`);
        } else {
          await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'suporte_verificando_luzes' });
          await enviarMensagem(telefone, `Tudo bem, *${nome}*! Agora o equipamento está aparecendo *offline* aqui. 🔴\n\nPode verificar as luzes do equipamento pra mim? Tem alguma *luz vermelha piscando*? Me conta o que você está vendo! 😊`);
        }
        return res.json({ ok: true });
      }

      // Resposta ambígua — repetir pergunta
      await enviarMensagem(telefone, `Conseguiu religar o equipamento, *${nome}*? A internet voltou? 😊`);
      return res.json({ ok: true });
    }

    // Resposta sobre as luzes do equipamento
    if (clienteLocal.estado_conversa === 'suporte_verificando_luzes') {
      const temLuzVermelha = mensagemRecebida.toLowerCase().match(/vermelh|piscan|red|alarm/);
      const semLuz = mensagemRecebida.toLowerCase().match(/apagad|sem luz|desligad|nenhuma|não tem|nao tem/);

      if (semLuz) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
        await enviarMensagem(telefone, `Entendido, *${nome}*! Se o equipamento está sem nenhuma luz, provavelmente está sem energia.\n\n👉 Verifique se o cabo de energia está bem encaixado na tomada e no equipamento.\n\nSe mesmo assim não ligar, entre em contato novamente que acionamos um técnico para verificar! 🔧`);
        return res.json({ ok: true });
      }

      if (temLuzVermelha) {
        await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'menu' });
        await dbCreate('Atendimento', { telefone, nome_cliente: nome, id_cliente_receitanet: idCliente, motivo: 'suporte', mensagem_original: 'Equipamento offline com luz vermelha piscando - ' + mensagemRecebida, estado_final: 'chamado_aberto', data_atendimento: new Date().toISOString(), resolvido: false });
        const chamado3 = await abrirChamado(idCliente, telefone);
        await enviarMensagem(telefone, `Entendido, *${nome}*! A luz vermelha piscando indica uma falha na fibra óptica — isso precisa de uma visita técnica. 🔧\n\nJá passei o chamado para a nossa *equipe de campo* com o relato do que você me descreveu.\n\n📋 *Protocolo: ${chamado3.protocolo || chamado3.idSuporte || 'gerado'}*\n\nVamos entrar em contato em breve para *agendar a visita*. Pedimos desculpas pelo inconveniente e obrigado pela paciência! 🙏`);
        return res.json({ ok: true });
      }

      // Luzes acesas mas sem vermelha — tentar reset
      await dbUpdate('ClienteWhatsapp', clienteLocal.id, { estado_conversa: 'suporte_aguardando_reset' });
      await enviarMensagem(telefone, `Certo, *${nome}*! As luzes estão acesas mas sem luz vermelha. Pode ser uma instabilidade temporária.\n\n👉 Tente *desligar o equipamento da tomada por 2 minutinhos* e depois ligar novamente.\n\nDepois me avisa se a internet voltou! 😊`);
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
