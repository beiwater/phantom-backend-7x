# Sales Buildings & Encyclopedia API Contract Map

## 1. 销售建筑 API 清单 (Sales Buildings APIs)

### 1.1 通用零售队列接口
* **`GET /api/v2/companies/buildings/:id/queue/`**
  * **用途**：拉取建筑当前进行中的销售/生产任务
  * **响应字段**：`Array<{ id, buildingId, resourceId, amount, price, quality, durationSeconds, busyUntil, startedAt }>`
  * **状态变更**：更新 Redux `buildings.queues[buildingId]`
* **`POST /api/v2/companies/buildings/:id/queue/`**
  * **用途**：发起零售订单
  * **请求体**：`{ kind: number, amount: number, price: number, quality: number }`
  * **响应**：最新全量队列列表
  * **副作用**：扣减仓库库存 `warehouse.resources`，扣减金钱/加成计算
* **`DELETE /api/v2/companies/buildings/:id/queue/:taskId/`**
  * **用途**：取消零售排产
  * **副作用**：剩余未售出物料返还仓库，释放建筑占用

### 1.2 销售办公室专属接口
* **`GET /api/v2/companies/buildings/:id/sales-orders/`**
  * **用途**：获取当前等待履约的客户订单
  * **响应字段**：`Array<{ id, resourceId, resourceName, amount, price, quality, delivered, createdAt }>`
* **`POST /api/v2/companies/buildings/:id/sales-orders/`**
  * **用途**：搜索新客户
  * **响应**：新生成的订单对象
* **`PUT /api/v2/companies/buildings/:id/sales-orders/:orderId/`**
  * **用途**：履约交付订单
  * **请求体**：`{ lowestQualityFirst: boolean }`
  * **响应字段**：`{ money: number, resourceTransactions: Array<{ dbLetter, quality, amount }> }`
  * **状态变更**：`user.money += data.money`，仓库物料出库
* **`DELETE /api/v2/companies/buildings/:id/sales-orders/:orderId/`**
  * **用途**：拒绝/丢弃不需要的客户订单

### 1.3 餐厅专属接口
* **`GET /api/v2/companies/buildings/:id/restaurant-properties/`**
  * **用途**：获取餐厅经营参数
  * **响应字段**：`{ buildingId, rating, menu, staffLevel, seatingCapacity, isOpen }`
* **`POST /api/v2/companies/buildings/:id/restaurant-runs/`**
  * **用途**：触发营业轮次结算（开关店）
  * **请求体**：`{ open: boolean }`
  * **响应字段**：`{ id, startedAt, endedAt, revenue, cost, profit, customersServed, ratingDelta }`

---

## 2. 百科全书关联 API 清单 (Encyclopedia APIs)

* **`GET /api/v4/:realm/resources-retail-info/`**
  * **用途**：提供全服零售商品的实时饱和度与指导基准价
  * **响应格式**：`Record<resourceId, { saturation, averagePrice, demandMultiplier }>`
  * **消费方**：`constants.resourceRetail` 切片，用于计算商品零售销售时长
* **`GET /api/v4/:realm/:lang/encyclopedia/resources/:id/:quality/`**
  * **用途**：特定品质等级的资源详细指标
  * **响应字段**：`{ dbLetter, name, recipes, productionCost, marketPrice, saturation }`
* **`GET /api/v4/:realm/:lang/encyclopedia/existing-resource-quality/`**
  * **用途**：各物料全服最高已产出品质档位
* **`GET /api/v3/market-ticker/:realm/`**
  * **用途**：全物料最新市场现价，供百科全书测算原料成本与毛利
* **`GET /api/v2/companies/me/administration-overhead/`**
  * **用途**：获取玩家当前的管理费用率，供成本公式精确分摊工人工资
