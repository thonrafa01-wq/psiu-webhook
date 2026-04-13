#!/bin/bash
# Renova o BASE44_SERVICE_TOKEN no Render
# Chamado pela automação a cada 2 horas

source /app/.agents/.env

echo "[TOKEN] Buscando token atual..."

TOKEN="$BASE44_SERVICE_TOKEN"

if [ -z "$TOKEN" ]; then
  echo "[ERRO] BASE44_SERVICE_TOKEN não encontrado no ambiente"
  exit 1
fi

# Verificar expiração
EXP=$(echo "$TOKEN" | cut -d'.' -f2 | python3 -c "
import sys, base64, json
payload = sys.stdin.read().strip()
payload += '=' * (4 - len(payload) % 4)
try:
    decoded = json.loads(base64.b64decode(payload).decode())
    print(decoded.get('exp', 0))
except:
    print(0)
")

NOW=$(date +%s)
DIFF=$((EXP - NOW))

echo "[TOKEN] Expira em: ${DIFF}s ($(( DIFF / 60 )) minutos)"

# Atualizar no Render — incluir TODAS as envvars para não perder nenhuma
RESULT=$(curl -s -X PUT "https://api.render.com/v1/services/srv-d7bgm3p17lss73aitb30/env-vars" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "[
    {\"key\": \"BASE44_SERVICE_TOKEN\", \"value\": \"$TOKEN\"},
    {\"key\": \"RECEITANET_CHATBOT_TOKEN\", \"value\": \"4761052b-1c8c-494a-a4a9-ae60b6b15b2d\"},
    {\"key\": \"RECEITANET_TOKEN\", \"value\": \"4761052b-1c8c-494a-a4a9-ae60b6b15b2d\"},
    {\"key\": \"GROQ_API_KEY\", \"value\": \"$GROQ_API_KEY\"}
  ]")

echo "[RENDER] Resposta: $(echo $RESULT | head -c 100)"

# Forçar redeploy sempre para garantir que o novo token está ativo no servidor
echo "[RENDER] Forçando redeploy para atualizar token..."
DEPLOY=$(curl -s -X POST "https://api.render.com/v1/services/srv-d7bgm3p17lss73aitb30/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"clearCache\": \"do_not_clear\"}")
DEPLOY_STATUS=$(echo $DEPLOY | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('deploy',{}).get('status','?'))" 2>/dev/null)
echo "[RENDER] Deploy: $DEPLOY_STATUS"

echo "[TOKEN] Concluído"
