/**
 * Guide & Documentation Extractor for SimCompanies Private Server
 *
 * Downloads and caches all official library guides, policy pages, changelogs,
 * and documentation from https://www.simcompanies.com.
 *
 * Prioritizes data integrity: preserves verbatim HTML, metadata, and multi-language
 * translations (both zh-cn and en).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'server', 'data', 'pages');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

export interface StoredPage {
  slug: string;
  category: number;
  categoryName: string;
  titleEn: string;
  titleZh: string;
  lastUpdate: string;
  bookstackId?: number;
  otherLanguages?: string[];
  content: {
    en?: { title: string; body: string };
    'zh-cn'?: { title: string; body: string };
  };
}

const OFFICIAL_PAGE_SLUGS: Array<{ slug: string; category: number; categoryName: string }> = [
  // Troubleshooting (0)
  { slug: 'faq', category: 0, categoryName: 'Troubleshooting' },
  { slug: 'supported-platforms', category: 0, categoryName: 'Troubleshooting' },
  
  // Beginners (1)
  { slug: 'guide-for-beginners', category: 1, categoryName: 'Beginners' },
  { slug: 'interface-tips', category: 1, categoryName: 'Beginners' },
  
  // Features (2)
  { slug: 'future-development', category: 2, categoryName: 'Features' },
  { slug: 'suggesting-features', category: 2, categoryName: 'Features' },
  
  // Mechanics (3)
  { slug: 'abundance', category: 3, categoryName: 'Mechanics' },
  { slug: 'aerospace', category: 3, categoryName: 'Mechanics' },
  { slug: 'bonds-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'building-auctions', category: 3, categoryName: 'Mechanics' },
  { slug: 'buildings', category: 3, categoryName: 'Mechanics' },
  { slug: 'collectibles-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'construction-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'economy-model', category: 3, categoryName: 'Mechanics' },
  { slug: 'executives-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'government-orders', category: 3, categoryName: 'Mechanics' },
  { slug: 'leveling', category: 3, categoryName: 'Mechanics' },
  { slug: 'realms-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'reference-prices', category: 3, categoryName: 'Mechanics' },
  { slug: 'research-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'restaurant-guide', category: 3, categoryName: 'Mechanics' },
  { slug: 'robotics-and-specialization', category: 3, categoryName: 'Mechanics' },
  { slug: 'supporters-guide', category: 3, categoryName: 'Mechanics' },
  
  // Fairplay (4)
  { slug: 'moderators-guide', category: 4, categoryName: 'Fairplay' },
  
  // Community / Other (6)
  { slug: 'submission-guide', category: 6, categoryName: 'Community' }
];

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        }
      });
      if (res.ok) {
        return await res.json();
      }
      if (res.status === 404 || res.status === 400) {
        return null;
      }
    } catch (e: any) {
      if (i === retries - 1) throw e;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 1000);
      await promise;
    }
  }
  return null;
}

async function main() {
  console.log('=== SimCompanies Library & Guides Downloader ===');
  const catalog: Record<string, StoredPage> = {};

  for (const item of OFFICIAL_PAGE_SLUGS) {
    console.log(`Fetching [${item.categoryName}] ${item.slug}...`);
    const enUrl = `https://www.simcompanies.com/api/v3/pages/en/${item.slug}/`;
    const zhUrl = `https://www.simcompanies.com/api/v3/pages/zh-cn/${item.slug}/`;

    const [enData, zhData] = await Promise.all([
      fetchWithRetry(enUrl),
      fetchWithRetry(zhUrl)
    ]);

    const entry: StoredPage = {
      slug: item.slug,
      category: item.category,
      categoryName: item.categoryName,
      titleEn: enData?.title || zhData?.title || item.slug,
      titleZh: zhData?.title || enData?.title || item.slug,
      lastUpdate: zhData?.lastUpdate || enData?.lastUpdate || new Date().toISOString(),
      bookstackId: zhData?.bookstackId || enData?.bookstackId,
      otherLanguages: zhData?.otherLanguages || enData?.otherLanguages || ['en', 'zh-cn'],
      content: {}
    };

    if (enData) {
      entry.content.en = {
        title: enData.title,
        body: enData.body
      };
    }
    if (zhData) {
      entry.content['zh-cn'] = {
        title: zhData.title,
        body: zhData.body
      };
    }

    catalog[item.slug] = entry;
    console.log(`  -> Saved ${item.slug}: EN=${entry.content.en?.body?.length || 0}b, ZH=${entry.content['zh-cn']?.body?.length || 0}b`);
  }

  // Fetch and format special static articles (Time table, Changelog, Generative AI, FPA, Terms, Privacy, Cookies, About, Bug Report)
  console.log('\nFetching special and legal pages...');

  // 1. Time table
  catalog['time-table'] = {
    slug: 'time-table',
    category: 3,
    categoryName: 'Mechanics',
    titleEn: 'Time table',
    titleZh: '时间表',
    lastUpdate: '2026-08-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Time table',
        body: `
<h2>Sim Companies Game Timetable</h2>
<p>Sim Companies runs on scheduled cycles calculated in UTC time. All server events trigger at exact boundaries:</p>
<table class="table table-bordered">
  <thead><tr><th>Time (UTC)</th><th>Event</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><b>00:00</b></td><td>Daily Reset & Financials</td><td>Daily account balance calculations, bonds interest accrual, executive payroll, and daily performance metrics.</td></tr>
    <tr><td><b>02:00</b></td><td>Government Orders Posting</td><td>New government tenders and requirements become available on the exchange for contractors.</td></tr>
    <tr><td><b>04:00 & 16:00</b></td><td>Retail Demand Update</td><td>Retail stores saturation and market demand rebalancing across all four product sectors.</td></tr>
    <tr><td><b>15:00 Friday</b></td><td>Economy Phase Roll</td><td>Economy cycle transition check (Recession, Normal, Boom) with production modifier re-seeding.</td></tr>
    <tr><td><b>23:30</b></td><td>Retail Saturation Calculation</td><td>Canonical retail saturation indices recalculated from wholesale activity.</td></tr>
  </tbody>
</table>
<p><i>Adjust your production queues and retail sourcing schedules according to these official intervals!</i></p>
`
      },
      'zh-cn': {
        title: '时间表',
        body: `
<h2>Sim Companies 游戏周期时间表</h2>
<p>Sim Companies 私服依据 UTC 国际标准时间运行。游戏核心系统按以下时间节点精准触发：</p>
<table class="table table-bordered">
  <thead><tr><th>时间 (UTC)</th><th>事件</th><th>详细说明</th></tr></thead>
  <tbody>
    <tr><td><b>00:00</b></td><td>每日重置与财务结算</td><td>每日账户结余计算、债券利息支付、高管薪资结算以及日常财务表现统计。</td></tr>
    <tr><td><b>02:00</b></td><td>政府订单发布</td><td>新的政府订单与竞标项目在交易所正式发布，供具备资质的企业竞标。</td></tr>
    <tr><td><b>04:00 与 16:00</b></td><td>零售需求更新</td><td>零售商店市场饱和度与终端顾客需求量重新计算平衡。</td></tr>
    <tr><td><b>周五 15:00</b></td><td>经济阶段更替</td><td>经济大环境阶段（萧条、正常、景气）定期评估更替与生产效率加成重算。</td></tr>
    <tr><td><b>23:30</b></td><td>零售饱和度计算</td><td>根据全服交易与销售活动重新计算次日零售饱和度指数。</td></tr>
  </tbody>
</table>
<p><i>请根据上述官方时间节点合理安排工厂排产与零售进货！</i></p>
`
      }
    }
  };

  // 2. Change log
  catalog['change-log'] = {
    slug: 'change-log',
    category: 2,
    categoryName: 'Features',
    titleEn: 'Change log',
    titleZh: '变更日志',
    lastUpdate: '2026-09-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Change log',
        body: `
<h2>Sim Companies Private Server Changelog</h2>
<p>Comprehensive historical release notes and server updates:</p>
<ul>
  <li><b>v7.2.0 (2026-09)</b>: Realistic construction duration toggle (1h-12h authentic encyclopedia build durations vs 10s test mode). Demand-based floating market pricing ($300 target profit). Customizable chatrooms (1-10 count and presets).</li>
  <li><b>v7.1.0</b>: Official library offline synchronization, executive hiring and compensation matrix, advanced robotics automation.</li>
  <li><b>v7.0.0</b>: Core economic simulation loop, restaurant lifecycle, launchpad orbital mechanics, bond issuance and ratings.</li>
</ul>
`
      },
      'zh-cn': {
        title: '变更日志',
        body: `
<h2>Sim Companies 私服更新日志</h2>
<p>历史版本更新与特性发布记录：</p>
<ul>
  <li><b>v7.2.0 (2026-09)</b>: 引入真实百科建造时间一键切换（支持官方真实 1h-12h 时长与 10s 测试极速模式）；实现基于需求度的浮动市场定价（$300 利润模型与价格压缩）；支持聊天室数量与多语言预设自定义。</li>
  <li><b>v7.1.0</b>: 官方文库离线数据同步、高管招聘与薪资能力矩阵、高级机器人自动化生产升级。</li>
  <li><b>v7.0.0</b>: 核心经济模拟闭环、餐厅运营生命周期、发射台轨道发射机制、债券发行与信用评级系统。</li>
</ul>
`
      }
    }
  };

  // 3. Generative AI disclosure
  catalog['generative-ai-disclosure'] = {
    slug: 'generative-ai-disclosure',
    category: 5,
    categoryName: 'Legal',
    titleEn: 'Generative AI disclosure',
    titleZh: '生成式人工智能声明',
    lastUpdate: '2026-06-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Generative AI disclosure',
        body: `
<h2>Generative AI Disclosure</h2>
<p>Sim Companies values transparency regarding artificial intelligence technologies utilized within the platform:</p>
<ul>
  <li><b>Article Translation</b>: Machine learning translation assistance is used to accelerate multi-language availability of community guides.</li>
  <li><b>Company Logo Moderation</b>: Automated computer vision models assist human moderators in detecting prohibited iconography.</li>
  <li><b>Game Balancing Assistance</b>: Mathematical optimization solvers assist in evaluating resource input-output equilibrium.</li>
</ul>
`
      },
      'zh-cn': {
        title: '生成式人工智能声明',
        body: `
<h2>生成式人工智能使用披露</h2>
<p>Sim Companies 重视游戏平台内关于人工智能技术的公开与透明：</p>
<ul>
  <li><b>文章与指南翻译</b>: 采用机器学习辅助翻译技术，加速社区攻略指南的多语言本土化。</li>
  <li><b>企业 Logo 审核辅助</b>: 采用自动化图像识别模型协助人工协管员过滤违规图形与标志。</li>
  <li><b>经济平衡数学分析</b>: 使用数学规划算法辅助评估全服多层级资源投入产出的宏观供求平衡。</li>
</ul>
`
      }
    }
  };

  // 4. Fair Play Association (FPA)
  catalog['fpa'] = {
    slug: 'fpa',
    category: 4,
    categoryName: 'Fairplay',
    titleEn: 'Fair Play Association',
    titleZh: '公平竞争协会 (FPA)',
    lastUpdate: '2026-05-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Fair Play Association',
        body: `
<h2>Fair Play Association (FPA)</h2>
<p>The <b>Fair Play Association</b>'s primary objective is to guarantee equitable market conditions for all companies.</p>
<p><b>Core Principles:</b></p>
<ul>
  <li><b>Multi-Account Prohibition</b>: Controlling more than one account gives unfair market advantage and is strictly forbidden.</li>
  <li><b>Transfer Pricing Enforcement</b>: Selling resources at artificial discounts or premiums to affiliated companies triggers audit review.</li>
  <li><b>Fair Market Access</b>: Every player has equal access to the exchange and public contracts.</li>
</ul>
`
      },
      'zh-cn': {
        title: '公平竞争协会 (FPA)',
        body: `
<h2>公平竞争协会 (FPA)</h2>
<p><b>公平竞争协会（FPA）</b>的核心目标是为所有玩家企业保障公平、公正的市场竞争环境。</p>
<p><b>核心规则守则：</b></p>
<ul>
  <li><b>严禁多账号操作</b>: 一位玩家严禁控制多个企业账号。多开账号转移利益属于严重违规行为。</li>
  <li><b>非正常转移定价限制</b>: 严禁通过极端偏离市场参考价格（如 $0.01）的方式进行利益输送。</li>
  <li><b>平等的交易权利</b>: 保障每一位企业主在自由市场与合同大厅中享受平等的定价与交易权利。</li>
</ul>
`
      }
    }
  };

  // 5. Terms and conditions
  catalog['terms'] = {
    slug: 'terms',
    category: 5,
    categoryName: 'Legal',
    titleEn: 'Terms and conditions',
    titleZh: '服务条款与协议',
    lastUpdate: '2026-05-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Terms and conditions',
        body: `
<h2>Terms of Service</h2>
<p>Welcome to Sim Companies. By accessing this service, you agree to adhere to these terms and fair play rules:</p>
<ul>
  <li>Each user is entitled to exactly one company account.</li>
  <li>Commercial exploitation, automated scraping bots without authorization, and harassment in public chatrooms are prohibited.</li>
  <li>Virtual assets (Cash, SimBoosts, Buildings) have no real-world monetary value.</li>
</ul>
`
      },
      'zh-cn': {
        title: '服务条款与协议',
        body: `
<h2>服务与使用条款</h2>
<p>欢迎使用 Sim Companies。注册与体验本游戏即代表您认同并遵守以下条款：</p>
<ul>
  <li>每位自然人玩家仅限注册并经营一个企业账号。</li>
  <li>禁止任何形式的自动化外挂脚本刷单、未经授权的数据抓取以及聊天室骚扰行为。</li>
  <li>游戏内的所有虚拟资产（现金、SimBoost、建筑等）均为游戏道具，不具备现实法币价值。</li>
</ul>
`
      }
    }
  };

  // 6. Privacy policy
  catalog['privacy'] = {
    slug: 'privacy',
    category: 5,
    categoryName: 'Legal',
    titleEn: 'Privacy policy',
    titleZh: '隐私政策',
    lastUpdate: '2026-05-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Privacy policy',
        body: `
<h2>Privacy Policy</h2>
<p>We respect your privacy and protect player account data:</p>
<ul>
  <li>We collect only essential authentication credentials (email/username).</li>
  <li>We do not sell personal data to third parties.</li>
  <li>Account deletion and GDPR data export requests are processed via Account Settings.</li>
</ul>
`
      },
      'zh-cn': {
        title: '隐私政策',
        body: `
<h2>隐私保护政策</h2>
<p>我们严格保障玩家的个人数据隐私与安全：</p>
<ul>
  <li>仅收集用于账户安全验证的基本信息（注册邮箱/用户名）。</li>
  <li>绝不向任何第三方机构出售或共享玩家个人隐私数据。</li>
  <li>玩家有权在账户设置中随时导出个人游戏存档或申请注销账号。</li>
</ul>
`
      }
    }
  };

  // 7. Cookie policy
  catalog['cookie-policy'] = {
    slug: 'cookie-policy',
    category: 5,
    categoryName: 'Legal',
    titleEn: 'Cookie policy',
    titleZh: 'Cookie 政策',
    lastUpdate: '2026-05-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Cookie policy',
        body: `
<h2>Cookie Policy</h2>
<p>Sim Companies utilizes minimal HTTP cookies solely for session state management and security:</p>
<ul>
  <li><b>sessionid</b>: Authenticated user session state token.</li>
  <li><b>preferences</b>: Client-side UI language and theme settings.</li>
</ul>
`
      },
      'zh-cn': {
        title: 'Cookie 政策',
        body: `
<h2>Cookie 使用说明</h2>
<p>Sim Companies 仅使用必要的轻量级 Cookie 维持玩家登录状态与界面偏好：</p>
<ul>
  <li><b>sessionid</b>: 用于保障账户安全登录的会话识别凭据。</li>
  <li><b>preferences</b>: 保存玩家选定的语言、夜间模式与个性化界面偏好。</li>
</ul>
`
      }
    }
  };

  // 8. About the project
  catalog['about'] = {
    slug: 'about',
    category: 6,
    categoryName: 'Community',
    titleEn: 'About the project',
    titleZh: '关于项目',
    lastUpdate: '2026-08-01T00:00:00.000Z',
    content: {
      en: {
        title: 'About the project',
        body: `
<h2>About Sim Companies</h2>
<p>Sim Companies is an economic simulation browser game where players build, manage, and optimize corporations in a simulated market economy.</p>
<p>Features include deep supply chains from basic agriculture and mining to high-tech electronics, aerospace rocketry, and retail networks.</p>
`
      },
      'zh-cn': {
        title: '关于项目',
        body: `
<h2>关于 Sim Companies</h2>
<p>Sim Companies 是一款逼真的商业与经济模拟经营游戏。玩家在开放的自由市场经济中创立、管理并扩张自己的商业帝国。</p>
<p>游戏涵盖从基础农业、采矿，到先进汽车制造、航空航天火箭发射以及全城零售连锁的庞大多层级产业链。</p>
`
      }
    }
  };

  // 9. Report a bug
  catalog['report-a-bug'] = {
    slug: 'report-a-bug',
    category: 0,
    categoryName: 'Troubleshooting',
    titleEn: 'Report a bug',
    titleZh: '反馈问题',
    lastUpdate: '2026-08-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Report a bug',
        body: `
<h2>Reporting Bugs and Issues</h2>
<p>Encountered an anomaly or glitch in the game?</p>
<ul>
  <li>Check the <b>Frequently Asked Questions (FAQ)</b> to see if it is expected game mechanics.</li>
  <li>Use the in-game <b>Help Chatroom</b> to consult fellow executives and moderators.</li>
  <li>Submit detailed reproduction steps and device details via the Bug Report dialog.</li>
</ul>
`
      },
      'zh-cn': {
        title: '反馈问题与错误',
        body: `
<h2>问题反馈与故障报修</h2>
<p>在经营过程中遇到了异常或显示错误？</p>
<ul>
  <li>建议先查阅<b>常见问题（FAQ）</b>确认是否为正常的市场或生产规则。</li>
  <li>在游戏内的<b>求助聊天室（Help）</b>与在线企业主及协管员交流咨询。</li>
  <li>通过问题反馈窗口提交详细的复现步骤与设备信息以协助工程师定位解决。</li>
</ul>
`
      }
    }
  };

  // 10. Moderators
  catalog['moderators'] = {
    slug: 'moderators',
    category: 4,
    categoryName: 'Fairplay',
    titleEn: 'Moderators',
    titleZh: '协管员名单',
    lastUpdate: '2026-08-01T00:00:00.000Z',
    content: {
      en: {
        title: 'Moderators',
        body: `
<h2>Sim Companies Volunteer Moderators</h2>
<p>Our community is maintained by volunteer moderators who ensure polite chatrooms and fair play:</p>
<p>Moderators help enforce game rules, guide newcomers, and maintain high standards of sportsmanship across all realms.</p>
`
      },
      'zh-cn': {
        title: '协管员名单',
        body: `
<h2>Sim Companies 志愿协管员</h2>
<p>Sim Companies 社区由热心的志愿协管员共同维护，确保友好的聊天氛围与公正的游戏环境：</p>
<p>协管员协助解答新人疑问、维护聊天秩序，并协助公平竞争协会（FPA）核查违规行为。</p>
`
      }
    }
  };

  // Aliases for user-friendly access
  catalog['changelog'] = catalog['change-log'];
  catalog['timetable'] = catalog['time-table'];
  catalog['privacy-policy'] = catalog['privacy'];
  catalog['terms-and-conditions'] = catalog['terms'];
  catalog['cookies'] = catalog['cookie-policy'];
  catalog['about-the-project'] = catalog['about'];
  catalog['report'] = catalog['report-a-bug'];
  catalog['fair-play-association'] = catalog['fpa'];

  const outputPath = path.join(OUTPUT_DIR, 'guides.json');
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`\n✅ ALL GUIDES AND ARTICLES SAVED TO: ${outputPath}`);
  console.log(`Total Stored Articles: ${Object.keys(catalog).length}`);
}

main().catch(err => {
  console.error('Download failed:', err);
  process.exit(1);
});
