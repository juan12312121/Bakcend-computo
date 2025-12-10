#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Cargar .env sin el problema de EMAIL_FROM
source <(grep -v '^#' .env | grep -v 'EMAIL_FROM' | sed 's/^/export /')

echo -e "${CYAN}========================================"
echo -e "🔍 PROBANDO TODOS LOS MODELOS"
echo -e "========================================${NC}\n"
echo -e "${GREEN}🔑 API Key: ${GEMINI_API_KEY:0:10}...${NC}\n"

modelos=(
    "gemini-1.5-flash-001"
    "gemini-1.5-flash-002"
    "gemini-1.5-flash-8b"
    "gemini-1.5-pro-001"
    "gemini-1.5-pro-002"
    "gemini-1.0-pro"
    "gemini-1.0-pro-001"
    "gemini-1.0-pro-vision-latest"
    "text-bison-001"
)

funcionando=()

for modelo in "${modelos[@]}"; do
    echo -n "Probando: $modelo ... "
    
    response=$(curl -s -w "\n%{http_code}" \
        -H "Content-Type: application/json" \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -d '{"contents":[{"parts":[{"text":"test"}]}],"generationConfig":{"maxOutputTokens":5}}' \
        "https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent" 2>/dev/null)
    
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" == "200" ]; then
        echo -e "${GREEN}✅ FUNCIONA${NC}"
        funcionando+=("$modelo")
    elif [ "$http_code" == "429" ]; then
        echo -e "${YELLOW}⚠️  CUOTA AGOTADA${NC}"
    elif [ "$http_code" == "404" ]; then
        echo -e "${RED}❌ NO EXISTE${NC}"
    else
        echo -e "${RED}❌ ERROR $http_code${NC}"
    fi
    
    sleep 0.5
done

echo -e "\n${CYAN}========================================${NC}"

if [ ${#funcionando[@]} -gt 0 ]; then
    echo -e "${GREEN}✅ MODELOS DISPONIBLES:${NC}"
    for m in "${funcionando[@]}"; do
        echo -e "   → $m"
    done
    echo -e "\n${GREEN}💡 USA ESTE EN config/gemini.js:${NC}"
    echo -e "${CYAN}const MODELOS = {${NC}"
    echo -e "${CYAN}  FLASH: '${funcionando[0]}',${NC}"
    echo -e "${CYAN}  PRO: '${funcionando[0]}',${NC}"
    echo -e "${CYAN}  VISION: '${funcionando[0]}',${NC}"
    echo -e "${CYAN}};${NC}"
else
    echo -e "${RED}❌ NO HAY MODELOS DISPONIBLES${NC}"
    echo -e "\n${YELLOW}Opciones:${NC}"
    echo -e "1. Crear nueva cuenta Gmail"
    echo -e "2. Esperar 24 horas"
    echo -e "3. Verificar en: https://ai.google.dev/gemini-api/docs/models/gemini"
fi

echo -e "\n${CYAN}========================================${NC}"
