#!/usr/bin/env bash
# ==============================================================================
# SimCompanies Private Server - 9-Era Realm Phase Switcher
# 切换与配置游戏运行时代 (第一阶段 农业 ~ 第九阶段 餐饮全经济)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT:-3100}}"
ENV_FILE="$ROOT_DIR/.env"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}    SimCompanies 私服时代切换工具 (9-Era Realm Progression)     ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}"

TARGET_PRESET="${1:-}"

if [[ -z "$TARGET_PRESET" ]]; then
  echo -e "${YELLOW}请选择要切换的目标时代阶段 (输入数字 1-9):${NC}\n"
  echo -e "  ${BOLD}1)${NC} ${GREEN}第一阶段: 农业 (Phase 1: Agriculture)${NC}"
  echo -e "     - 建筑: 种植园、水库、发电厂、生鲜商店、农场、五金店、屠宰场、磨坊"
  echo -e "     - 规则: Q0研究上限，关闭债券、政府订单、高管、机器人与休闲建筑\n"

  echo -e "  ${BOLD}2)${NC} ${GREEN}第二阶段: 时尚与研究 (Phase 2: Fashion & Research)${NC}"
  echo -e "     - 建筑: 新增油井、炼油厂、服装厂、时装店、6大科研实验室"
  echo -e "     - 规则: 研究上限提升至 Q2，开启作物/物理/化学等研发\n"

  echo -e "  ${BOLD}3)${NC} ${GREEN}第三阶段: 能源、债券和政府订单 (Phase 3: Energy, Bonds & GO)${NC}"
  echo -e "     - 建筑: 新增货运站、加油站、饮料厂、采石场、混凝土厂、食品厂"
  echo -e "     - 规则: 研究上限 Q4，正式启用【公司债券】(利率0.5-2%) 与【政府订单】\n"

  echo -e "  ${BOLD}4)${NC} ${GREEN}第四阶段: 采矿和电子 (Phase 4: Mining & Electronics)${NC}"
  echo -e "     - 建筑: 新增矿井、建材厂、材料加工厂、电子厂、电子店、软件研发"
  echo -e "     - 规则: 研究上限提升至 Q6，开放高阶消费电子零售\n"

  echo -e "  ${BOLD}5)${NC} ${GREEN}第五阶段: 汽车零部件与总承包 (Phase 5: Luxury Fashion & Car Parts)${NC}"
  echo -e "     - 建筑: 新增总承包商建筑，推出金矿、金条、玻璃、珠宝与奢侈品"
  echo -e "     - 规则: 研究上限提升至 Q8\n"

  echo -e "  ${BOLD}6)${NC} ${GREEN}第六阶段: 高管团队与休闲银行业 (Phase 6: Executives, Recreation & Banking)${NC}"
  echo -e "     - 建筑: 新增银行、高管培训学院、城堡、公园、湖泊"
  echo -e "     - 规则: 研究上限 Q10，正式启用【高管猎头/聘用】与【休闲设施开销减免】\n"

  echo -e "  ${BOLD}7)${NC} ${GREEN}第七阶段: 汽车整车与机器人 (Phase 7: Automotive & Robotics)${NC}"
  echo -e "     - 建筑: 新增汽车厂、车行、赛车场与推进器工厂"
  echo -e "     - 规则: 研究上限达到满级 Q12，启用【机器人安装】与【展示柜收藏品】\n"

  echo -e "  ${BOLD}8)${NC} ${GREEN}第八阶段: 航空航天 (Phase 8: Aerospace)${NC}"
  echo -e "     - 建筑: 新增发射台、航天电子厂、航天厂、垂直/水平整合设施、销售办公室"
  echo -e "     - 规则: 解锁火箭发射、航天器材与商业客机直销\n"

  echo -e "  ${BOLD}9)${NC} ${GREEN}第九阶段: 完整全功能时代 (Phase 9: Full Unlocked)${NC}"
  echo -e "     - 建筑: 解锁烘焙厂、中央厨房、餐馆等所有9个时代完整建筑与全部经济模块"
  echo -e "     - 规则: 所有系统 100% 全功能开放\n"

  echo -ne "${BOLD}${YELLOW}请输入序号 [1-9] (默认 1 - 第一阶段 农业): ${NC}"
  read -r CHOICE || CHOICE="1"
  CHOICE="${CHOICE:-1}"

  case "$CHOICE" in
    1) TARGET_PRESET="phase_1" ;;
    2) TARGET_PRESET="phase_2" ;;
    3) TARGET_PRESET="phase_3" ;;
    4) TARGET_PRESET="phase_4" ;;
    5) TARGET_PRESET="phase_5" ;;
    6) TARGET_PRESET="phase_6" ;;
    7) TARGET_PRESET="phase_7" ;;
    8) TARGET_PRESET="phase_8" ;;
    9) TARGET_PRESET="full" ;;
    *) TARGET_PRESET="$CHOICE" ;;
  esac
fi

echo -e "\n${BLUE}--> 正在切换时代至: ${BOLD}${TARGET_PRESET}${NC}"

# 1. Update .env file
if [[ -f "$ENV_FILE" ]]; then
  if grep -q "^REALM_PHASE_PRESET=" "$ENV_FILE"; then
    sed -i '' "s/^REALM_PHASE_PRESET=.*/REALM_PHASE_PRESET=$TARGET_PRESET/" "$ENV_FILE" 2>/dev/null || sed -i "s/^REALM_PHASE_PRESET=.*/REALM_PHASE_PRESET=$TARGET_PRESET/" "$ENV_FILE"
  else
    echo "REALM_PHASE_PRESET=$TARGET_PRESET" >> "$ENV_FILE"
  fi
else
  printf 'REALM_PHASE_PRESET=%s\n' "$TARGET_PRESET" > "$ENV_FILE"
fi
echo -e "${GREEN}[OK] 已保存至配置文件: .env (REALM_PHASE_PRESET=$TARGET_PRESET)${NC}"

# 2. Call running server debug API if server is alive
if curl -s -f "$BASE_URL/api/v2/debug/realm-phase/" >/dev/null 2>&1; then
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/v2/debug/realm-phase/" \
    -H "Content-Type: application/json" \
    -d "{\"preset\":\"$TARGET_PRESET\"}")

  NAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d':' -f2 | tr -d '"')
  PHASE=$(echo "$RESPONSE" | grep -o '"phase":[0-9]*' | head -1 | cut -d':' -f2)
  RLIMIT=$(echo "$RESPONSE" | grep -o '"researchLimit":[0-9]*' | head -1 | cut -d':' -f2)
  BONDS=$(echo "$RESPONSE" | grep -o '"bonds":[a-z]*' | head -1 | cut -d':' -f2)
  GOV=$(echo "$RESPONSE" | grep -o '"govOrders":[a-z]*' | head -1 | cut -d':' -f2)
  EXECS=$(echo "$RESPONSE" | grep -o '"executives":[a-z]*' | head -1 | cut -d':' -f2)
  ROBOTS=$(echo "$RESPONSE" | grep -o '"robots":[a-z]*' | head -1 | cut -d':' -f2)

  echo -e "${GREEN}[OK] 运行中服务器已实时生效!${NC}"
  echo -e "----------------------------------------------------------------"
  echo -e " 时代名称: ${BOLD}${CYAN}$NAME${NC}"
  echo -e " 阶段序号: ${BOLD}Phase $PHASE (Era $((PHASE + 1)))${NC}"
  echo -e " 科研上限: ${BOLD}Q${RLIMIT} 品质${NC}"
  echo -e " 债券系统: ${BOLD}$BONDS${NC} | 政府订单: ${BOLD}$GOV${NC}"
  echo -e " 高管团队: ${BOLD}$EXECS${NC} | 机器人: ${BOLD}$ROBOTS${NC}"
  echo -e "----------------------------------------------------------------"
else
  echo -e "${YELLOW}[提示] 后端服务未在 $BASE_URL 运行，配置已写入 .env，下次启动时生效。${NC}"
fi

echo -e "\n${BOLD}${GREEN}时代设置完成！所有连接的客户端在刷新页面或进入游戏后将同步此时代限制。${NC}\n"
