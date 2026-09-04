# Sim Companies Historical Frontend Archeology & Golden Versions

本目录沉淀了对 Sim Companies（2015 ~ 2026）全网历史前端资产的深度考古挖掘成果，包含各关键时代的“绝唱”未混淆/弱混淆黄金版本代码，以及对官方底层核心算法的取证成果。

---

## 一、核心技术结论与全网 Source Map 判定

经过对 **Wayback Machine（2015~2026）、Common Crawl、URLScan.io、archive.today (archive.ph)、公共 S3 存储桶与 Android APK** 的全面安全资产测绘与探测：

1. **官方从未在公网暴露过真实的 `.map` 实体文件**：
   - **2016~2019（AngularJS 时代）**：Django-compressor 仅做代码合并与简单去空格（rjsmin），未配置生成 Source Map。
   - **2020~2022（CRA / Webpack 时代）**：客户端代码中虽然遗留了 CRA 默认的 `//# sourceMappingURL=...` 注释，但部署脚本已将 `.map` 物理剔除，请求均返回 404。
   - **监控探针实锤**：在 2022 年代码中截获官方接入的 **Rollbar** 错误监控初始化配置，官方显式硬编码了：
     ```javascript
     payload: { client: { javascript: { source_map_enabled: false } } }
     ```
   - **2023~2026（Vite / Rollup 时代）**：构建彻底禁用了 Source Map，且全量压缩进单大文件。

2. **为什么无需 Source Map 依然能完美逆向？**
   - 2019 年的原型与 2022 年末的最终版 Webpack 代码，**保留了完整的数学公式、Redux Action 常量、API 路由契约与清晰的代码作用域**。

---

## 二、归档黄金版本资产清单 (`golden-versions/`)

### 1. `2019-angular-django/`（早期黄金版本，数学算法金矿）
* **`reactjs.2ebf9ff0e2ef.early-react.js` (1.31 MB)**：
  - 最早期的 React 混编原型，**未经过深度变量压平混淆**。
  - **直接提取出了全套底层核心公式（一字未差原版代码）**：
    ```javascript
    // 零售销售速度与品质抗饱和公式
    var timeModeling = function timeModeling(retailModeling, saturation, amount, price) {
      return eval(retailModeling);
    };

    var unitsSoldAnHour = function(salesModifier, price, quality, marketSaturation, retailModeling) {
      var a = Math.max(marketSaturation - 0.24 * quality, 0.1);
      var i = timeModeling(retailModeling, a, 100, price);
      return 360000 / (i - i * salesModifier / 100);
    };

    // 零售单件利润与行政管理损耗计算
    var profitPerUnit = function(price, administrationOverhead, size, storeBaseSalary, unitsAnHour) {
      return price - (size * (storeBaseSalary * administrationOverhead)) / unitsAnHour;
    };
    ```
  - **核心常数证实**：品质抗饱和系数固定为 **0.24**，市场有效饱和度下限为 **0.1**。
* **`c7d6940adb66.controllers.js` (272 KB)**：AngularJS 核心控制器层。
* **`ab21d84ce107.services.js` (192 KB)**：AngularJS 游戏核心 Service 服务层。
* **`9bd8e37e35b7.directives.js` (104 KB)**：基础指令与数值格式化组件。
* **`352d5bf03e9a.angular-core.js` (153 KB)**：Angular 核心运行时。
* **`679799dff47b.vendors.js` (259 KB)**：第三方基础依赖库。

---

### 2. `2022-cra-react-final-dec2022/`（Webpack 4 时代的绝唱版本，现代业务最全）
* **时间戳**：`20221202001840`（2022 年 12 月 02 日，官方切入 Vite 混淆单大包前一周的最终 Webpack 版本）
* **`main.17916b1c.final-cra.js` (1.80 MB)**：
  - **完整保留 61 个 Redux Action Types（明文常量）**：
    - `ADD_BUILDING`, `ADD_BUILDINGS_CONSTANTS`, `CLEAR_BUILDING_BUSY`
    - `AEROSPACE_RESEARCH`, `AUTOMOTIVE_RESEARCH`, `BREEDING_RESEARCH`, `CHEMISTRY_RESEARCH`
    - `ADD_EXECUTIVE`, `DISMISS_EXECUTIVE`, `ADD_EXTRA_EXECUTIVE_SLOT`
    - `ADD_RESTAURANT`, `ADD_MARKET_ORDER`, `ADD_MARKET_TICKS`
  - 覆盖航空航天（Aerospace）、高管猎头（Executive）、机器人制造（Robots）、餐厅零售（Restaurant）等完整现代业务。
* **`2.01ba7ff4.final-vendor.js` (6.02 MB)**：完整依赖运行时库。
* **`runtime-main.e8c016a7.final-runtime.js` (1.59 KB)**：Webpack Jsonp 运行时引导器。
* **`zh.jsreverse.js` (6 KB)**：Django 全量后端 URL 命名空间与路径反向生成表。
* **`17aba23664d9.cache5.js` (33 KB)**：Django 模板基础工具包。

---

### 3. `2023-vite-rollup/`（Vite 迁移对照版本）
* **`index.83a06fd4.js` (5.88 MB)**：
  - 官方 2023 年 6 月切至 Vite/Rollup 后的基线包，用于与 2022 绝唱版对照验证现代变量映射。

---

### 4. `apk/`（官方 Android 安装包）
* **`sim-companies-2-0.apk` (5.09 MB)**：
  - 从官方内部 S3 存储桶（`landia-app-releases.s3.us-west-2.amazonaws.com`）直接提取的 Android 官方正式安装包。

---

## 三、自动化工具

* **`scripts/archeology/simcompanies_archaeologist.py`**：
  - 支持速率自适应抖动（2.0s~3.5s Jitter）与指数退避（Anti-Ban）的考古抓取脚本。
  - 自动解包与探测 `sourceMappingURL`、内联 Base64 Map、sourcesContent 及架构分类器。
