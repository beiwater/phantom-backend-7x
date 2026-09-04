# SimCompanies Routing System & URL Registry

## 1. 路由体系概述

前端使用统一的集中式路由表对象 `Wcr`（英文基准路由）与 `Ycr`（多语言镜像路由），位于 `index-cgzgptQ8.js` 偏移 `660840` 至 `718000`。

* **总路由函数项**：**1026 个**。
* **API 请求路由**：**594 个**（含 297 个多语言镜像）。
* **前端页面路由**：**432 个**。

## 2. 销售建筑关键路由

| 路由标识 | URL 模板 | 类型 | 对应组件 / 业务 |
| :--- | :--- | :--- | :--- |
| `building` | `/b/${id}/` | UI 页面 | 建筑总控页，根据建筑类型挂载销售/生产组件 |
| `building_production` | `/b/${id}/production/${tab}/` | UI 页面 | 建筑排产/零售子标签页 |
| `api_v2_companies_buildings_queue` | `/api/v2/companies/buildings/${id}/queue/` | API (GET/POST) | 通用零售队列拉取与启动零售任务 |
| `api_v2_companies_buildings_queue_get` | `/api/v2/companies/buildings/${id}/queue/${taskId}/` | API (DELETE) | 零售排产任务取消与库存释放 |
| `api_v2_companies_buildings_sales_orders` | `/api/v2/companies/buildings/${id}/sales-orders/` | API (GET/POST) | 销售办公室获取客户订单 / 寻找新客户 |
| `api_v2_companies_buildings_sales_orders_get` | `/api/v2/companies/buildings/${id}/sales-orders/${orderId}/` | API (PUT/DELETE) | 销售办公室交付合同（履约）/ 拒绝合同 |
| `api_v1_rush` | `/api/v1/rush/${token}/` | API (POST) | SimBoosts 加速寻找销售办公室订单 |
| `api_v2_companies_buildings_restaurant_properties` | `/api/v2/companies/buildings/${id}/restaurant-properties/` | API (GET/POST) | 餐厅属性配置（菜单、员工、座位、定价） |
| `api_v2_companies_buildings_restaurant_runs` | `/api/v2/companies/buildings/${id}/restaurant-runs/` | API (GET/POST) | 餐厅营业班次历史查询与开关店触发 |

## 3. 百科全书关键路由

| 路由标识 | URL 模板 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `encyklopedy_base` | `/encyclopedia/${realm}/` | UI 页面 | 百科全书大厅主页 |
| `encyklopedy_resources` | `/encyclopedia/${realm}/resources/` | UI 页面 | 全量 151 种资源检索目录 |
| `encyklopedy` | `/encyclopedia/${realm}/resource/${resourceId}/` | UI 页面 | 资源详情页（配方、时产、成本拆解、零售收益） |
| `encyklopedy_buildings` | `/encyclopedia/${realm}/buildings/` | UI 页面 | 全量 54 种建筑检索目录 |
| `encyklopedy_building` | `/encyclopedia/${realm}/building/${buildingKind}/` | UI 页面 | 建筑详情页（建造成本、工资、产线列表） |
| `encyklopedy_seasons` | `/encyclopedia/${realm}/seasons/` | UI 页面 | 季节周期活动大厅 |
| `encyklopedy_retail_season` | `/encyclopedia/${realm}/retail-seasons/${season}/` | UI 页面 | 零售季节饱和度折线图与商品明细 |
| `api_v4_encyclopedia_resources_retail_info` | `/api/v4/${realm}/resources-retail-info/` | API (GET) | 全分服零售商品饱和度与基准行情 |
| `api_v4_encyclopedia_resources` | `/api/v4/${realm}/${lang}/encyclopedia/resources/${id}/${quality}/` | API (GET) | 指定品质等级的资源百科深度参数 |
| `api_v4_encyclopedia_existing_resource_quality` | `/api/v4/${realm}/${lang}/encyclopedia/existing-resource-quality/` | API (GET) | 市场上存在的最高品质上限查询 |
| `api_v4_encyclopedia_ranking` | `/api/v4/encyclopedia/ranking/${realm}/${date}/` | API (GET) | 历史排行榜归档查询 |
